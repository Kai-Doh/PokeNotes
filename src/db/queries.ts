import type Database from "@tauri-apps/plugin-sql";
import type {
  AbilityRef,
  FormatLegalityEntry,
  LearnsetMove,
  PokemonRow,
} from "../types/pokedex";

export interface FormatRow {
  id: number;
  code: string;
  name: string;
  source: string;
  generation: number | null;
  is_doubles: number;
  ruleset: string | null; // JSON: { tera_allowed, clauses, banlist }
}

export interface FormatRuleset {
  tera_allowed?: boolean;
  clauses?: string[];
  banlist?: string[];
  note?: string;
}

export function parseFormatRuleset(ruleset: string | null): FormatRuleset {
  if (!ruleset) return {};
  try {
    return JSON.parse(ruleset);
  } catch {
    return {};
  }
}

export interface ItemRow {
  id: number;
  name: string;
  display_name: string;
  category: string | null;
  is_battle_item: number;
  short_effect: string | null;
  sprite: string | null;
}

// Battle-only forms (mega/gmax/and one-off alt formes like Necrozma-Dusk-Mane
// or Urshifu styles) are surfaced as tabs on their base Pokémon instead of
// separate list entries. Regional forms (Alolan/Galarian/Hisuian/Paldean) are
// distinct enough (different dex behavior, evolutions) to stay in the list.
const BATTLE_FORM_CATEGORIES = ["mega", "gmax", "other"];

export function listPokemon(db: Database): Promise<PokemonRow[]> {
  return db.select<PokemonRow[]>(
    `SELECT * FROM pokemon
     WHERE form_category IS NULL OR form_category NOT IN (${BATTLE_FORM_CATEGORIES.map(() => "?").join(",")})
     ORDER BY national_dex_number ASC, is_default_form DESC, id ASC`,
    BATTLE_FORM_CATEGORIES,
  );
}

export function getBattleFormVariants(db: Database, speciesId: number): Promise<PokemonRow[]> {
  return db.select<PokemonRow[]>(
    `SELECT * FROM pokemon
     WHERE species_id = ? AND form_category IN (${BATTLE_FORM_CATEGORIES.map(() => "?").join(",")})
     ORDER BY form_category ASC, id ASC`,
    [speciesId, ...BATTLE_FORM_CATEGORIES],
  );
}

export function getAbilitiesFor(db: Database, pokemonId: number): Promise<AbilityRef[]> {
  return db.select<AbilityRef[]>(
    `SELECT a.id, a.name, a.display_name, a.short_effect, pa.is_hidden
     FROM pokemon_abilities pa JOIN abilities a ON a.id = pa.ability_id
     WHERE pa.pokemon_id = ? ORDER BY pa.is_hidden ASC, pa.slot ASC`,
    [pokemonId],
  );
}

export function getLearnsetFor(db: Database, pokemonId: number): Promise<LearnsetMove[]> {
  return db.select<LearnsetMove[]>(
    `SELECT m.id, m.name, m.display_name, m.type, m.category, m.power, m.accuracy, m.pp,
            m.short_effect, l.method, l.level
     FROM learnsets l JOIN moves m ON m.id = l.move_id
     WHERE l.pokemon_id = ?
     ORDER BY (l.method = 'level-up') DESC, l.level ASC, m.display_name ASC`,
    [pokemonId],
  );
}

export function getFormatLegalityFor(db: Database, pokemonId: number): Promise<FormatLegalityEntry[]> {
  return db.select<FormatLegalityEntry[]>(
    `SELECT fl.format_id, f.code, f.name, fl.status, fl.tier
     FROM format_legality fl JOIN formats f ON f.id = fl.format_id
     WHERE fl.pokemon_id = ? ORDER BY f.source ASC, f.id ASC`,
    [pokemonId],
  );
}

export function getFormats(db: Database): Promise<FormatRow[]> {
  return db.select<FormatRow[]>(
    "SELECT id, code, name, source, generation, is_doubles, ruleset FROM formats ORDER BY source ASC, id ASC",
  );
}

// Team building shows every legal form as its own pick (incl. Mega/Gmax --
// e.g. National Dex lets you pick "Charizard-Mega-X" directly, holding its
// Mega Stone), unlike the Pokédex browser which folds those into tabs.
export function getLegalPokemonForFormat(
  db: Database,
  formatId: number,
): Promise<(PokemonRow & { legality_status: string; tier: string | null })[]> {
  return db.select(
    `SELECT p.*, fl.status as legality_status, fl.tier
     FROM pokemon p JOIN format_legality fl ON fl.pokemon_id = p.id
     WHERE fl.format_id = ? AND fl.status IN ('allowed', 'restricted')
     ORDER BY p.national_dex_number ASC, p.is_default_form DESC, p.id ASC`,
    [formatId],
  );
}

// Battle-only forms (Gmax in particular) often have no learnset rows of
// their own in the source data -- in real games you learn moves as the base
// species and the form change happens in-battle, so the movepool is
// identical. Fall back to the species' default form when a form has none.
export async function getAvailableMovesFor(db: Database, pokemon: PokemonRow): Promise<LearnsetMove[]> {
  const own = await getLearnsetFor(db, pokemon.id);
  if (own.length > 0 || pokemon.is_default_form) return own;
  const [defaultForm] = await db.select<{ id: number }[]>(
    "SELECT id FROM pokemon WHERE species_id = ? AND is_default_form = 1 LIMIT 1",
    [pokemon.species_id],
  );
  return defaultForm ? getLearnsetFor(db, defaultForm.id) : own;
}

// Real tournament usage % (scraped from LimitlessVGC) for the given official
// format -- surfaced in the Team Builder's pickers alongside legality, so
// "what's legal" and "what's actually being played" are both visible.
export interface PokemonUsageRow {
  pokemon_id: number;
  rank: number | null;
  usage_pct: number;
}

export function getPokemonUsageForFormat(db: Database, formatId: number): Promise<PokemonUsageRow[]> {
  return db.select<PokemonUsageRow[]>(
    "SELECT pokemon_id, rank, usage_pct FROM pokemon_usage WHERE format_id = ?",
    [formatId],
  );
}

export interface ItemUsageRow {
  item_id: number;
  usage_pct: number;
}

export function getItemUsageFor(db: Database, formatId: number, pokemonId: number): Promise<ItemUsageRow[]> {
  return db.select<ItemUsageRow[]>(
    "SELECT item_id, usage_pct FROM item_usage WHERE format_id = ? AND pokemon_id = ?",
    [formatId, pokemonId],
  );
}

export interface AbilityUsageRow {
  ability_id: number;
  usage_pct: number;
}

export function getAbilityUsageFor(db: Database, formatId: number, pokemonId: number): Promise<AbilityUsageRow[]> {
  return db.select<AbilityUsageRow[]>(
    "SELECT ability_id, usage_pct FROM ability_usage WHERE format_id = ? AND pokemon_id = ?",
    [formatId, pokemonId],
  );
}

// Loaded once and filtered client-side (same pattern as moves), rather than
// a fresh query per keystroke -- avoids a race where a fast keystroke's
// query resolves after a later one and clobbers it with stale results.
// Battle-relevant items only (held-items, choice, berries, plates, mega
// stones, z-crystals, etc.) -- the full item catalog also has Poke Balls,
// key items, TMs, mail, vitamins, and other things nobody holds in battle.
export function getAllItems(db: Database): Promise<ItemRow[]> {
  return db.select<ItemRow[]>(
    "SELECT id, name, display_name, category, is_battle_item, short_effect, sprite FROM items WHERE is_battle_item = 1 ORDER BY display_name ASC",
  );
}
