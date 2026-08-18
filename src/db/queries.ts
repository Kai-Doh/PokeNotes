import type Database from "@tauri-apps/plugin-sql";
import type {
  AbilityRef,
  FormatLegalityEntry,
  LearnsetMove,
  PokemonRow,
} from "../types/pokedex";

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
