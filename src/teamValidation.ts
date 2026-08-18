import { MAX_EV_PER_STAT, MAX_EV_TOTAL, STATS } from "./constants/gameData";
import type { FormatRow, FormatRuleset } from "./db/queries";
import { normalizeKey } from "./showdownFormat";
import type { TeamMemberDisplay } from "./types/team";

export interface ValidationIssue {
  severity: "error" | "warning";
  slot: number | null;
  message: string;
}

const EV_KEYS = STATS.map((s) => `ev_${s.key}` as const);

/**
 * DB-rules-driven legality check -- reuses the format_legality/item_legality
 * tables already computed at build time (via Showdown's TeamValidator) plus
 * each format's stored ruleset (clauses, banlist, tera_allowed) rather than
 * re-running a validator at runtime. Move/ability bans are only as complete
 * as what's present in that stored banlist, since we don't have a dedicated
 * per-format move/ability ban table -- good enough to catch the common cases
 * (banned abilities like Moody, banned moves like Baton Pass) without needing
 * new build-pipeline data.
 */
export function validateTeam(
  members: TeamMemberDisplay[],
  format: FormatRow,
  ruleset: FormatRuleset,
  legalityByPokemon: Map<number, { status: string; tier: string | null }>,
  bannedItemIds: Set<number>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (members.length === 0) {
    return [{ severity: "warning", slot: null, message: "This team has no Pokémon yet." }];
  }
  if (members.length < 6) {
    issues.push({ severity: "warning", slot: null, message: `Only ${members.length} of 6 slots filled.` });
  }

  const clauses = new Set((ruleset.clauses ?? []).map((c) => c.toLowerCase()));
  const banlist = new Set((ruleset.banlist ?? []).map((b) => normalizeKey(b)));

  // Species Clause: same pokemon_id twice. Doesn't catch same-species
  // different-form combos (e.g. two Rotom forms), a rare enough edge case
  // to skip rather than plumb species_id through the display query for.
  const speciesSeen = new Set<number>();
  for (const m of members) {
    if (speciesSeen.has(m.pokemon_id)) {
      issues.push({ severity: "error", slot: m.slot, message: `Species Clause: ${m.pokemon_name} appears more than once on this team.` });
    }
    speciesSeen.add(m.pokemon_id);
  }

  // Item Clause, when the format's ruleset actually carries it.
  if (clauses.has("item clause")) {
    const itemCounts = new Map<number, number>();
    for (const m of members) if (m.item_id) itemCounts.set(m.item_id, (itemCounts.get(m.item_id) ?? 0) + 1);
    for (const m of members) {
      if (m.item_id && (itemCounts.get(m.item_id) ?? 0) > 1) {
        issues.push({ severity: "error", slot: m.slot, message: `Item Clause: ${m.item_name} is held by more than one Pokémon.` });
      }
    }
  }

  for (const m of members) {
    const legality = legalityByPokemon.get(m.pokemon_id);
    if (!legality || legality.status === "banned") {
      issues.push({ severity: "error", slot: m.slot, message: `${m.pokemon_name} isn't legal in ${format.name}.` });
    } else if (legality.status === "restricted") {
      issues.push({ severity: "warning", slot: m.slot, message: `${m.pokemon_name} is a restricted Pokémon — check it against your event's restricted-legendary limit.` });
    }

    if (m.item_id && bannedItemIds.has(m.item_id)) {
      issues.push({ severity: "error", slot: m.slot, message: `${m.item_name} is banned in ${format.name}.` });
    }

    if (m.ability_name && banlist.has(normalizeKey(m.ability_name))) {
      issues.push({ severity: "error", slot: m.slot, message: `${m.pokemon_name}'s ability (${m.ability_name}) is banned in ${format.name}.` });
    }

    for (const moveName of [m.move1_name, m.move2_name, m.move3_name, m.move4_name]) {
      if (moveName && banlist.has(normalizeKey(moveName))) {
        issues.push({ severity: "error", slot: m.slot, message: `${m.pokemon_name}'s move ${moveName} is banned in ${format.name}.` });
      }
    }

    if (ruleset.tera_allowed === false && m.tera_type) {
      issues.push({ severity: "error", slot: m.slot, message: `Terastallization isn't allowed in ${format.name}, but ${m.pokemon_name} has a Tera type set.` });
    }

    const evTotal = EV_KEYS.reduce((sum, key) => sum + (m as unknown as Record<string, number>)[key], 0);
    if (evTotal > MAX_EV_TOTAL) {
      issues.push({ severity: "error", slot: m.slot, message: `${m.pokemon_name}'s EVs total ${evTotal}, over the ${MAX_EV_TOTAL} limit.` });
    }
    for (const s of STATS) {
      const ev = (m as unknown as Record<string, number>)[`ev_${s.key}`];
      if (ev > MAX_EV_PER_STAT) {
        issues.push({ severity: "error", slot: m.slot, message: `${m.pokemon_name}'s ${s.label} EVs (${ev}) exceed the per-stat max of ${MAX_EV_PER_STAT}.` });
      }
    }
  }

  return issues;
}
