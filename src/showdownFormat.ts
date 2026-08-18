import type Database from "@tauri-apps/plugin-sql";
import { STATS } from "./constants/gameData";
import { saveTeamMember } from "./db/teamQueries";
import type { TeamMember } from "./types/team";
import type { TeamMemberDisplay } from "./types/team";

const STAT_ABBREV: Record<string, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const STAT_ABBREV_TO_KEY: Record<string, string> = { hp: "hp", atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe" };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Export ----------

export function exportTeamToShowdown(members: TeamMemberDisplay[]): string {
  return members
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map(exportMember)
    .join("\n\n");
}

function exportMember(m: TeamMemberDisplay): string {
  const species = m.pokemon_showdown_name || m.pokemon_name;
  const lines: string[] = [];

  const namePart = m.nickname && m.nickname !== species ? `${m.nickname} (${species})` : species;
  lines.push(m.item_name ? `${namePart} @ ${m.item_name}` : namePart);

  if (m.ability_name) lines.push(`Ability: ${m.ability_name}`);
  if (m.level !== 100) lines.push(`Level: ${m.level}`);
  if (m.tera_type) lines.push(`Tera Type: ${capitalize(m.tera_type)}`);

  const evParts = STATS
    .filter((s) => (m as unknown as Record<string, number>)[`ev_${s.key}`] > 0)
    .map((s) => `${(m as unknown as Record<string, number>)[`ev_${s.key}`]} ${STAT_ABBREV[s.key]}`);
  if (evParts.length) lines.push(`EVs: ${evParts.join(" / ")}`);

  if (m.nature) lines.push(`${m.nature} Nature`);

  const ivParts = STATS
    .filter((s) => (m as unknown as Record<string, number>)[`iv_${s.key}`] !== 31)
    .map((s) => `${(m as unknown as Record<string, number>)[`iv_${s.key}`]} ${STAT_ABBREV[s.key]}`);
  if (ivParts.length) lines.push(`IVs: ${ivParts.join(" / ")}`);

  for (const moveName of [m.move1_name, m.move2_name, m.move3_name, m.move4_name]) {
    if (moveName) lines.push(`- ${moveName}`);
  }

  return lines.join("\n");
}

// ---------- Parse ----------

export interface ParsedShowdownSet {
  nickname: string | null;
  species: string;
  item: string | null;
  ability: string | null;
  level: number;
  teraType: string | null;
  nature: string | null;
  evs: Record<string, number>;
  ivs: Record<string, number>;
  moves: string[];
}

function parseFirstLine(line: string): { nickname: string | null; species: string; item: string | null } {
  let rest = line;
  let item: string | null = null;
  const atIdx = rest.lastIndexOf(" @ ");
  if (atIdx !== -1) {
    item = rest.slice(atIdx + 3).trim();
    rest = rest.slice(0, atIdx).trim();
  }
  // Trailing gender marker, e.g. "Landorus-Therian (M)" -- strip before
  // checking for a "Nickname (Species)" pattern, or it reads as the species.
  rest = rest.replace(/\s*\((M|F)\)\s*$/, "").trim();
  const parenMatch = rest.match(/^(.+?)\s*\((.+?)\)$/);
  if (parenMatch) {
    return { nickname: parenMatch[1].trim(), species: parenMatch[2].trim(), item };
  }
  return { nickname: null, species: rest, item };
}

function parseStatLine(rest: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of rest.split("/")) {
    const m = part.trim().match(/^(\d+)\s+(\w+)$/);
    if (!m) continue;
    const key = STAT_ABBREV_TO_KEY[m[2].toLowerCase()];
    if (key) out[key] = Number(m[1]);
  }
  return out;
}

function parseBlock(block: string): ParsedShowdownSet {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const { nickname, species, item } = parseFirstLine(lines[0]);
  const set: ParsedShowdownSet = {
    nickname, species, item, ability: null, level: 100, teraType: null,
    nature: null, evs: {}, ivs: {}, moves: [],
  };
  for (const line of lines.slice(1)) {
    if (line.startsWith("Ability:")) set.ability = line.slice(8).trim();
    else if (line.startsWith("Level:")) set.level = Number(line.slice(6).trim()) || 100;
    else if (line.startsWith("Tera Type:")) set.teraType = line.slice(10).trim();
    else if (line.startsWith("EVs:")) set.evs = parseStatLine(line.slice(4));
    else if (line.startsWith("IVs:")) set.ivs = parseStatLine(line.slice(4));
    else if (/ Nature$/.test(line)) set.nature = line.replace(/ Nature$/, "").trim();
    else if (line.startsWith("-") || line.startsWith("~")) {
      const move = line.slice(1).trim();
      if (move) set.moves.push(move);
    }
    // Anything else (Shiny:, Happiness:, comments) is silently ignored.
  }
  return set;
}

export function parseShowdownTeam(text: string): ParsedShowdownSet[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(parseBlock);
}

// ---------- Resolve + save ----------

export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface NameLookups {
  pokemonByKey: Map<string, number>;
  itemByKey: Map<string, number>;
  abilityByKey: Map<string, number>;
  moveByKey: Map<string, number>;
}

/** Builds normalized-name -> id lookup maps for resolving Showdown text (team exports, replay logs) against our catalog. */
export async function buildNameLookups(db: Database): Promise<NameLookups> {
  const [allPokemon, allItems, allAbilities, allMoves] = await Promise.all([
    db.select<{ id: number; showdown_name: string | null; display_name: string }[]>(
      "SELECT id, showdown_name, display_name FROM pokemon",
    ),
    db.select<{ id: number; display_name: string }[]>("SELECT id, display_name FROM items"),
    db.select<{ id: number; display_name: string }[]>("SELECT id, display_name FROM abilities"),
    db.select<{ id: number; display_name: string }[]>("SELECT id, display_name FROM moves"),
  ]);

  const pokemonByKey = new Map<string, number>();
  for (const p of allPokemon) {
    // Prefer the exact Showdown name; display_name is a fallback for forms
    // that don't have one, and for species typed in plain form.
    if (!pokemonByKey.has(normalizeKey(p.display_name))) pokemonByKey.set(normalizeKey(p.display_name), p.id);
    if (p.showdown_name) pokemonByKey.set(normalizeKey(p.showdown_name), p.id);
  }
  const itemByKey = new Map(allItems.map((i) => [normalizeKey(i.display_name), i.id]));
  const abilityByKey = new Map(allAbilities.map((a) => [normalizeKey(a.display_name), a.id]));
  const moveByKey = new Map(allMoves.map((m) => [normalizeKey(m.display_name), m.id]));

  return { pokemonByKey, itemByKey, abilityByKey, moveByKey };
}

export interface ImportResult {
  imported: number;
  warnings: string[];
}

/** Replaces the team's entire roster (slots 1-6) with the parsed Showdown text. */
export async function importShowdownTeam(db: Database, teamId: number, text: string): Promise<ImportResult> {
  const parsedSets = parseShowdownTeam(text).slice(0, 6);
  const warnings: string[] = [];
  if (parsedSets.length === 0) return { imported: 0, warnings: ["No Pokémon found in the pasted text."] };

  const { pokemonByKey, itemByKey, abilityByKey, moveByKey } = await buildNameLookups(db);

  for (let slot = 1; slot <= 6; slot++) {
    await db.execute("DELETE FROM team_members WHERE team_id = ? AND slot = ?", [teamId, slot]);
  }

  let imported = 0;
  for (let i = 0; i < parsedSets.length; i++) {
    const slot = i + 1;
    const parsed = parsedSets[i];
    const pokemonId = pokemonByKey.get(normalizeKey(parsed.species));
    if (!pokemonId) {
      warnings.push(`Couldn't find species "${parsed.species}" — skipped.`);
      continue;
    }
    const itemId = parsed.item ? itemByKey.get(normalizeKey(parsed.item)) ?? null : null;
    if (parsed.item && !itemId) warnings.push(`Couldn't find item "${parsed.item}" for ${parsed.species} — left blank.`);
    const abilityId = parsed.ability ? abilityByKey.get(normalizeKey(parsed.ability)) ?? null : null;
    if (parsed.ability && !abilityId) warnings.push(`Couldn't find ability "${parsed.ability}" for ${parsed.species} — left blank.`);
    const moveIds = parsed.moves.slice(0, 4).map((mv) => moveByKey.get(normalizeKey(mv)) ?? null);
    parsed.moves.forEach((mv, idx) => {
      if (mv && !moveIds[idx]) warnings.push(`Couldn't find move "${mv}" for ${parsed.species} — left blank.`);
    });

    const member: Omit<TeamMember, "id"> = {
      team_id: teamId,
      slot,
      pokemon_id: pokemonId,
      nickname: parsed.nickname,
      item_id: itemId,
      ability_id: abilityId,
      nature: parsed.nature,
      tera_type: parsed.teraType ? parsed.teraType.toLowerCase() : null,
      level: parsed.level,
      move1_id: moveIds[0] ?? null,
      move2_id: moveIds[1] ?? null,
      move3_id: moveIds[2] ?? null,
      move4_id: moveIds[3] ?? null,
      ev_hp: parsed.evs.hp ?? 0, ev_atk: parsed.evs.atk ?? 0, ev_def: parsed.evs.def ?? 0,
      ev_spa: parsed.evs.spa ?? 0, ev_spd: parsed.evs.spd ?? 0, ev_spe: parsed.evs.spe ?? 0,
      iv_hp: parsed.ivs.hp ?? 31, iv_atk: parsed.ivs.atk ?? 31, iv_def: parsed.ivs.def ?? 31,
      iv_spa: parsed.ivs.spa ?? 31, iv_spd: parsed.ivs.spd ?? 31, iv_spe: parsed.ivs.spe ?? 31,
    };
    await saveTeamMember(db, member);
    imported++;
  }

  return { imported, warnings };
}
