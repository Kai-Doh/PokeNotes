import { fetch } from "@tauri-apps/plugin-http";

export interface ReplayJson {
  id: string;
  format: string;
  formatid?: string;
  players: string[];
  log: string;
  uploadtime: number;
}

/** Accepts a full replay URL, a bare replay id, or a URL with a trailing `.json`/query string. */
export function parseReplayId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const noQuery = trimmed.split(/[?#]/)[0];
  const afterHost = noQuery.replace(/^https?:\/\/(replay\.)?pokemonshowdown\.com\//i, "");
  const id = afterHost.replace(/\.json$/i, "").replace(/\/+$/, "").trim();
  return id || null;
}

export async function fetchReplay(replayId: string): Promise<ReplayJson> {
  const res = await fetch(`https://replay.pokemonshowdown.com/${encodeURIComponent(replayId)}.json`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Replay not found — check the link, or the replay may have been deleted / made private."
        : `Failed to fetch replay (HTTP ${res.status}).`,
    );
  }
  return (await res.json()) as ReplayJson;
}

/**
 * Parses a locally-saved replay HTML file. Showdown produces two different
 * shapes depending on how it was saved:
 *
 *  - A plain save of a replay.pokemonshowdown.com page: log and metadata
 *    (id, format, players, uploadtime) sit in two separate <script> tags.
 *  - The in-client "Download replay" button (from a battle in the play.
 *    pokemonshowdown.com client itself): a self-contained page with just the
 *    log, JSON-string-escaped, in a `battle-log-data` script tag and no
 *    metadata blob — format/players are recovered from the log's own
 *    `|tier|`/`|player|` lines, and the id from a hidden `replayid` input.
 *
 * Either way this reads a local file, so it works offline and for replays
 * Showdown's server has since deleted.
 */
export function parseReplayHtml(html: string): ReplayJson {
  const logMatchA = html.match(/<script type="text\/plain" class="log"[^>]*>([\s\S]*?)<\/script>/);
  const dataMatchA = html.match(/<script type="application\/json" class="data"[^>]*>([\s\S]*?)<\/script>/);
  if (logMatchA && dataMatchA) {
    let meta: Omit<ReplayJson, "log">;
    try {
      meta = JSON.parse(dataMatchA[1].trim());
    } catch {
      throw new Error("This file's replay data looks corrupted or incomplete.");
    }
    return { ...meta, log: logMatchA[1].trim() };
  }

  const logMatchB = html.match(/<script type="text\/plain" class="battle-log-data">([\s\S]*?)<\/script>/);
  if (logMatchB) {
    const idMatch = html.match(/name="replayid"\s+value="([^"]+)"/);
    if (!idMatch) {
      throw new Error("Couldn't find this replay's id in the file — it may be from an unsupported export format.");
    }
    const log = logMatchB[1].trim().replace(/\\\//g, "/");
    const firstTimestamp = log.match(/\|t:\|(\d+)/);
    return {
      id: idMatch[1],
      format: "",
      players: [],
      log,
      uploadtime: firstTimestamp ? Number(firstTimestamp[1]) : 0,
    };
  }

  throw new Error("Couldn't find replay data in this file — make sure it's a Showdown replay page saved as HTML, or a file from Showdown's \"Download replay\" button.");
}

// ---------- Log parsing ----------

export type Side = "p1" | "p2";

export interface RevealedMon {
  species: string;
  nickname: string;
  item: string | null;
  ability: string | null;
  teraType: string | null;
  moves: string[];
}

export type BattleEventType =
  | "switch" | "move" | "damage" | "heal" | "status" | "curestatus"
  | "boost" | "unboost" | "item" | "ability" | "tera" | "faint" | "win" | "tie";

export interface BattleEvent {
  type: BattleEventType;
  side: Side | null;
  pokemon: string | null;
  detail: string;
}

export interface ParsedTurn {
  number: number;
  events: BattleEvent[];
}

export interface ParsedBattle {
  gen: number | null;
  formatLabel: string;
  players: { p1: string; p2: string };
  turns: ParsedTurn[];
  revealed: Record<Side, RevealedMon[]>;
  /** All 6 species from team preview (`|poke|` lines), in preview order -- present even for the 2 that never got picked. */
  previewTeam: Record<Side, string[]>;
  /** Species that actually got switched into the battle (VGC "bring 4 of 6"), as opposed to just previewed. */
  brought: Record<Side, string[]>;
  winner: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  brn: "burned", par: "paralyzed", slp: "asleep", frz: "frozen", psn: "poisoned", tox: "badly poisoned",
};

function splitPositionRef(ref: string): { posKey: string; side: Side; nickname: string } | null {
  const idx = ref.indexOf(": ");
  if (idx === -1) return null;
  const posKey = ref.slice(0, idx).trim();
  const nickname = ref.slice(idx + 2).trim();
  const side = posKey.slice(0, 2);
  if (side !== "p1" && side !== "p2") return null;
  return { posKey, side, nickname };
}

function speciesFromDetails(details: string): string {
  return details.split(",")[0].trim();
}

// Mega Evolution (and similar in-battle-only transformations) changes the
// species string Showdown reports for a position -- if that Pokémon later
// switches out and back in, the log calls it e.g. "Swampert-Mega" instead of
// "Swampert", which would otherwise be tracked as a second, separate mon.
const IN_BATTLE_FORM_SUFFIXES = ["-Mega-X", "-Mega-Y", "-Mega", "-Primal", "-Gmax"];
function baseSpeciesKey(species: string): string {
  for (const suffix of IN_BATTLE_FORM_SUFFIXES) {
    if (species.endsWith(suffix)) return species.slice(0, -suffix.length);
  }
  return species;
}

/** Parses a raw Showdown battle log (the `log` field of a replay JSON) into a turn timeline plus revealed-set summaries per side. */
export function parseBattleLog(logText: string, formatFallback: string): ParsedBattle {
  const players: { p1: string; p2: string } = { p1: "", p2: "" };
  const revealed: Record<Side, Map<string, RevealedMon>> = { p1: new Map(), p2: new Map() };
  const previewTeam: Record<Side, string[]> = { p1: [], p2: [] };
  const brought: Record<Side, Set<string>> = { p1: new Set(), p2: new Set() };
  // Tracks which species currently occupies each battle position (p1a, p1b, p2a, p2b, ...)
  // so events that only reference a position (not a species) can be attributed.
  const position: Map<string, { species: string; side: Side }> = new Map();
  const turns: ParsedTurn[] = [];
  let currentTurn: ParsedTurn = { number: 0, events: [] };
  turns.push(currentTurn);
  let gen: number | null = null;
  let tier: string | null = null;
  let winner: string | null = null;

  function getMon(posKey: string): { species: string; side: Side } | null {
    return position.get(posKey) ?? null;
  }

  function ensureRevealed(side: Side, species: string, nickname: string): RevealedMon {
    const key = baseSpeciesKey(species);
    let mon = revealed[side].get(key);
    if (!mon) {
      mon = { species: key, nickname, item: null, ability: null, teraType: null, moves: [] };
      revealed[side].set(key, mon);
    }
    return mon;
  }

  function push(event: BattleEvent) {
    currentTurn.events.push(event);
  }

  for (const rawLine of logText.split("\n")) {
    if (!rawLine.startsWith("|")) continue;
    const parts = rawLine.slice(1).split("|");
    const cmd = parts[0];

    // Many message types beyond -item/-ability carry a "[from] ability: X" or
    // "[from] item: X" tag revealing a set detail as a side effect (weather
    // setters, Intimidate, Leftovers recovery, etc), usually attributed via
    // an explicit "[of] p1a: Name" rather than the line's own first field.
    const fromAbility = rawLine.match(/\[from\] ability: ([^|\]]+)/);
    const fromItem = rawLine.match(/\[from\] item: ([^|\]]+)/);
    if (fromAbility || fromItem) {
      const ofMatch = rawLine.match(/\[of\] (p[12][a-z]+): ([^|\]]+)/);
      const targetRef = ofMatch
        ? { posKey: ofMatch[1], nickname: ofMatch[2].trim() }
        : splitPositionRef(parts[1] ?? "");
      const mon = targetRef ? getMon(targetRef.posKey) : null;
      if (mon) {
        const revealedMon = ensureRevealed(mon.side, mon.species, targetRef!.nickname);
        if (fromAbility && !revealedMon.ability) revealedMon.ability = fromAbility[1].trim();
        if (fromItem && !revealedMon.item) revealedMon.item = fromItem[1].trim();
      }
    }

    switch (cmd) {
      case "player": {
        const slot = parts[1] as Side;
        const name = parts[2];
        if ((slot === "p1" || slot === "p2") && name) players[slot] = name;
        break;
      }
      case "gen":
        gen = Number(parts[1]) || null;
        break;
      case "tier":
        tier = parts[1] || null;
        break;
      case "showteam": {
        // Open Team Sheets: a full packed-team dump for one side, far more
        // complete than anything reconstructable from combat events alone
        // (every Pokémon's item/ability/all 4 moves, not just what got used).
        const side = parts[1] as Side;
        if (side !== "p1" && side !== "p2") break;
        // The packed-team payload contains its own "|" separators, so it was
        // fragmented by the line-wide split above -- reassemble it first.
        const payload = parts.slice(2).join("|");
        for (const raw of payload.split("]")) {
          const fields = raw.split("|");
          const name = fields[0] ?? "";
          const species = fields[1] || name;
          if (!species) continue;
          const revealedMon = ensureRevealed(side, species, name);
          const item = fields[2] ?? "";
          const ability = fields[3] ?? "";
          const moves = (fields[4] ?? "").split(",").filter(Boolean);
          if (item && !revealedMon.item) revealedMon.item = item;
          if (ability && !revealedMon.ability) revealedMon.ability = ability;
          for (const mv of moves) {
            if (!revealedMon.moves.some((m) => m.toLowerCase() === mv.toLowerCase()) && revealedMon.moves.length < 4) {
              revealedMon.moves.push(mv);
            }
          }
        }
        break;
      }
      case "poke": {
        const side = parts[1] as Side;
        if (side !== "p1" && side !== "p2") break;
        const species = speciesFromDetails(parts[2] ?? "");
        if (species) previewTeam[side].push(species);
        break;
      }
      case "switch":
      case "drag": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const species = baseSpeciesKey(speciesFromDetails(parts[2] ?? ""));
        position.set(ref.posKey, { species, side: ref.side });
        ensureRevealed(ref.side, species, ref.nickname);
        brought[ref.side].add(species);
        push({ type: "switch", side: ref.side, pokemon: ref.nickname, detail: `sent out ${species}` });
        break;
      }
      case "move": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const mon = getMon(ref.posKey);
        const moveName = parts[2] ?? "";
        if (mon) {
          const revealedMon = ensureRevealed(mon.side, mon.species, ref.nickname);
          if (moveName && !revealedMon.moves.some((m) => m.toLowerCase() === moveName.toLowerCase()) && revealedMon.moves.length < 4) {
            revealedMon.moves.push(moveName);
          }
        }
        push({ type: "move", side: ref.side, pokemon: ref.nickname, detail: `used ${moveName}` });
        break;
      }
      case "-damage":
      case "-heal": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const hp = parts[2] ?? "";
        push({
          type: cmd === "-damage" ? "damage" : "heal",
          side: ref.side,
          pokemon: ref.nickname,
          detail: `${cmd === "-damage" ? "took damage" : "healed"} (${hp})`,
        });
        break;
      }
      case "-status": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const status = parts[2] ?? "";
        push({ type: "status", side: ref.side, pokemon: ref.nickname, detail: `was ${STATUS_LABELS[status] ?? status}` });
        break;
      }
      case "-curestatus": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        push({ type: "curestatus", side: ref.side, pokemon: ref.nickname, detail: "recovered from its status" });
        break;
      }
      case "-boost":
      case "-unboost": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const stat = (parts[2] ?? "").toUpperCase();
        const amount = parts[3] ?? "";
        push({
          type: cmd === "-boost" ? "boost" : "unboost",
          side: ref.side,
          pokemon: ref.nickname,
          detail: `${stat} ${cmd === "-boost" ? "rose" : "fell"} (${amount} stage${amount === "1" ? "" : "s"})`,
        });
        break;
      }
      case "-item":
      case "-enditem": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const mon = getMon(ref.posKey);
        const itemName = parts[2] ?? "";
        if (mon && itemName) {
          const revealedMon = ensureRevealed(mon.side, mon.species, ref.nickname);
          if (!revealedMon.item) revealedMon.item = itemName;
        }
        push({
          type: "item",
          side: ref.side,
          pokemon: ref.nickname,
          detail: cmd === "-item" ? `revealed item: ${itemName}` : `used its item: ${itemName}`,
        });
        break;
      }
      case "-ability": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const mon = getMon(ref.posKey);
        const abilityName = parts[2] ?? "";
        if (mon && abilityName) ensureRevealed(mon.side, mon.species, ref.nickname).ability = abilityName;
        push({ type: "ability", side: ref.side, pokemon: ref.nickname, detail: `ability: ${abilityName}` });
        break;
      }
      case "-terastallize": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const mon = getMon(ref.posKey);
        const teraType = parts[2] ?? "";
        if (mon) ensureRevealed(mon.side, mon.species, ref.nickname).teraType = teraType;
        push({ type: "tera", side: ref.side, pokemon: ref.nickname, detail: `Terastallized into ${teraType}` });
        break;
      }
      case "-mega":
      case "-primal": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        const mon = getMon(ref.posKey);
        const item = parts[3] ?? "";
        if (mon && item) ensureRevealed(mon.side, mon.species, ref.nickname).item = item;
        push({ type: "item", side: ref.side, pokemon: ref.nickname, detail: `Mega Evolved using ${item}` });
        break;
      }
      case "faint": {
        const ref = splitPositionRef(parts[1]);
        if (!ref) break;
        push({ type: "faint", side: ref.side, pokemon: ref.nickname, detail: "fainted" });
        break;
      }
      case "turn": {
        currentTurn = { number: Number(parts[1]) || turns.length, events: [] };
        turns.push(currentTurn);
        break;
      }
      case "win": {
        winner = parts[1] || null;
        push({ type: "win", side: null, pokemon: null, detail: `${winner} won the battle` });
        break;
      }
      case "tie": {
        push({ type: "tie", side: null, pokemon: null, detail: "The battle ended in a tie" });
        break;
      }
      default:
        break;
    }
  }

  return {
    gen,
    formatLabel: formatFallback || tier || "Unknown format",
    players,
    turns: turns.filter((t) => t.events.length > 0),
    revealed: { p1: Array.from(revealed.p1.values()), p2: Array.from(revealed.p2.values()) },
    previewTeam: {
      p1: previewTeam.p1.length ? previewTeam.p1 : Array.from(revealed.p1.keys()),
      p2: previewTeam.p2.length ? previewTeam.p2 : Array.from(revealed.p2.keys()),
    },
    brought: { p1: Array.from(brought.p1), p2: Array.from(brought.p2) },
    winner,
  };
}
