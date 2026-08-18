import type Database from "@tauri-apps/plugin-sql";
import { buildNameLookups, normalizeKey } from "../showdownFormat";
import type { ParsedBattle, Side } from "../replayLog";
import { getTeamMembers } from "./teamQueries";
import type {
  Battle, BattleListEntry, BattleNote, BattlePokemonDisplay, ScoutedSetEntry,
} from "../types/battle";

export function listBattles(db: Database): Promise<BattleListEntry[]> {
  return db.select<BattleListEntry[]>(
    `SELECT b.*, t.name as my_team_name FROM battles b
     LEFT JOIN teams t ON t.id = b.my_team_id
     ORDER BY COALESCE(b.battle_date, b.created_at) DESC`,
  );
}

export function getBattle(db: Database, battleId: number): Promise<Battle | undefined> {
  return db.select<Battle[]>("SELECT * FROM battles WHERE id = ?", [battleId]).then((r) => r[0]);
}

export async function deleteBattle(db: Database, battleId: number): Promise<void> {
  await db.execute("DELETE FROM battles WHERE id = ?", [battleId]);
}

export function getBattleMyPokemon(db: Database, battleId: number): Promise<BattlePokemonDisplay[]> {
  return db.select<BattlePokemonDisplay[]>(
    `SELECT bmp.id, bmp.battle_id, bmp.pokemon_id, p.display_name as pokemon_name, p.sprite_default as pokemon_sprite,
            p.type1, p.type2,
            bmp.item_id, it.display_name as item_name, it.sprite_x as item_sprite_x, it.sprite_y as item_sprite_y,
            bmp.ability_id, ab.display_name as ability_name, bmp.tera_type,
            bmp.move1_id, m1.display_name as move1_name, bmp.move2_id, m2.display_name as move2_name,
            bmp.move3_id, m3.display_name as move3_name, bmp.move4_id, m4.display_name as move4_name
     FROM battle_my_pokemon bmp
     JOIN pokemon p ON p.id = bmp.pokemon_id
     LEFT JOIN items it ON it.id = bmp.item_id
     LEFT JOIN abilities ab ON ab.id = bmp.ability_id
     LEFT JOIN moves m1 ON m1.id = bmp.move1_id
     LEFT JOIN moves m2 ON m2.id = bmp.move2_id
     LEFT JOIN moves m3 ON m3.id = bmp.move3_id
     LEFT JOIN moves m4 ON m4.id = bmp.move4_id
     WHERE bmp.battle_id = ?`,
    [battleId],
  );
}

export function getBattleOpponentPokemon(db: Database, battleId: number): Promise<BattlePokemonDisplay[]> {
  return db.select<BattlePokemonDisplay[]>(
    `SELECT bop.id, bop.battle_id, bop.pokemon_id, p.display_name as pokemon_name, p.sprite_default as pokemon_sprite,
            p.type1, p.type2,
            bop.observed_item_id as item_id, it.display_name as item_name,
            it.sprite_x as item_sprite_x, it.sprite_y as item_sprite_y,
            bop.observed_ability_id as ability_id, ab.display_name as ability_name,
            bop.observed_tera_type as tera_type,
            bop.observed_move1_id as move1_id, m1.display_name as move1_name,
            bop.observed_move2_id as move2_id, m2.display_name as move2_name,
            bop.observed_move3_id as move3_id, m3.display_name as move3_name,
            bop.observed_move4_id as move4_id, m4.display_name as move4_name
     FROM battle_opponent_pokemon bop
     JOIN pokemon p ON p.id = bop.pokemon_id
     LEFT JOIN items it ON it.id = bop.observed_item_id
     LEFT JOIN abilities ab ON ab.id = bop.observed_ability_id
     LEFT JOIN moves m1 ON m1.id = bop.observed_move1_id
     LEFT JOIN moves m2 ON m2.id = bop.observed_move2_id
     LEFT JOIN moves m3 ON m3.id = bop.observed_move3_id
     LEFT JOIN moves m4 ON m4.id = bop.observed_move4_id
     WHERE bop.battle_id = ?`,
    [battleId],
  );
}

/**
 * Edits one scouted opponent Pokémon in place -- unlike "my" side (a frozen
 * snapshot of the team as it was fought with), the opponent's set is a
 * best-effort scouting record that's fine to correct or fill in later as you
 * remember more, or if the auto-fill guessed wrong.
 */
export async function updateOpponentMon(
  db: Database, id: number,
  patch: Partial<{ itemId: number | null; abilityId: number | null; teraType: string | null; moveIds: (number | null)[] }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if ("itemId" in patch) { sets.push("observed_item_id = ?"); values.push(patch.itemId ?? null); }
  if ("abilityId" in patch) { sets.push("observed_ability_id = ?"); values.push(patch.abilityId ?? null); }
  if ("teraType" in patch) { sets.push("observed_tera_type = ?"); values.push(patch.teraType ?? null); }
  if (patch.moveIds) {
    patch.moveIds.slice(0, 4).forEach((mv, i) => { sets.push(`observed_move${i + 1}_id = ?`); values.push(mv); });
  }
  if (sets.length === 0) return;
  values.push(id);
  await db.execute(`UPDATE battle_opponent_pokemon SET ${sets.join(", ")} WHERE id = ?`, values);
}

/** Adds a scouted Pokémon you remember seeing but hadn't logged yet -- starts with no item/ability/moves, filled in the same way as any other card. */
export async function addOpponentMon(db: Database, battleId: number, pokemonId: number): Promise<number> {
  const res = await db.execute(
    "INSERT INTO battle_opponent_pokemon (battle_id, pokemon_id) VALUES (?, ?)",
    [battleId, pokemonId],
  );
  return res.lastInsertId as number;
}

export function listBattleNotes(db: Database, battleId: number): Promise<BattleNote[]> {
  return db.select<BattleNote[]>(
    `SELECT * FROM battle_notes WHERE battle_id = ?
     ORDER BY CASE WHEN turn_number IS NULL THEN 0 ELSE 1 END, turn_number ASC, created_at ASC`,
    [battleId],
  );
}

export async function addBattleNote(
  db: Database, battleId: number, turnNumber: number | null, tag: string | null, body: string,
): Promise<void> {
  await db.execute(
    "INSERT INTO battle_notes (battle_id, turn_number, tag, body) VALUES (?, ?, ?, ?)",
    [battleId, turnNumber, tag, body],
  );
}

export async function deleteBattleNote(db: Database, noteId: number): Promise<void> {
  await db.execute("DELETE FROM battle_notes WHERE id = ?", [noteId]);
}

/** The scouting book: every set revealed for this species across every logged battle, newest first. */
export function searchScoutedSets(db: Database, pokemonId: number): Promise<ScoutedSetEntry[]> {
  return db.select<ScoutedSetEntry[]>(
    `SELECT bop.battle_id, bop.pokemon_id, p.display_name as pokemon_name, p.sprite_default as pokemon_sprite,
            p.type1, p.type2,
            b.opponent_name, b.format_label, b.battle_date, b.replay_url,
            it.display_name as item_name, it.sprite_x as item_sprite_x, it.sprite_y as item_sprite_y,
            ab.display_name as ability_name, bop.observed_tera_type as tera_type,
            m1.display_name as move1_name, m2.display_name as move2_name,
            m3.display_name as move3_name, m4.display_name as move4_name
     FROM battle_opponent_pokemon bop
     JOIN battles b ON b.id = bop.battle_id
     JOIN pokemon p ON p.id = bop.pokemon_id
     LEFT JOIN items it ON it.id = bop.observed_item_id
     LEFT JOIN abilities ab ON ab.id = bop.observed_ability_id
     LEFT JOIN moves m1 ON m1.id = bop.observed_move1_id
     LEFT JOIN moves m2 ON m2.id = bop.observed_move2_id
     LEFT JOIN moves m3 ON m3.id = bop.observed_move3_id
     LEFT JOIN moves m4 ON m4.id = bop.observed_move4_id
     WHERE bop.pokemon_id = ?
     ORDER BY COALESCE(b.battle_date, b.created_at) DESC`,
    [pokemonId],
  );
}

export interface SaveBattleParams {
  parsed: ParsedBattle;
  rawLog: string;
  replayUrl: string;
  uploadtimeSec: number | null;
  ourSide: Side;
  teamId: number | null;
  formatId: number | null;
  result: "win" | "loss" | "tie" | null;
  eventName: string | null;
}

export interface SaveBattleResult {
  battleId: number;
  alreadyLogged: boolean;
}

/** Saves a parsed replay: the battle row, our revealed sets, and the opponent's revealed sets (the scouting book). Idempotent per replay URL. */
export async function saveParsedBattle(db: Database, params: SaveBattleParams): Promise<SaveBattleResult> {
  const existing = await db.select<{ id: number }[]>("SELECT id FROM battles WHERE replay_url = ?", [params.replayUrl]);
  if (existing.length) return { battleId: existing[0].id, alreadyLogged: true };

  const opponentSide: Side = params.ourSide === "p1" ? "p2" : "p1";
  const opponentName = params.parsed.players[opponentSide] || "Unknown";
  const battleDate = params.uploadtimeSec ? new Date(params.uploadtimeSec * 1000).toISOString() : null;

  const insertRes = await db.execute(
    `INSERT INTO battles (source, format_id, format_label, my_team_id, opponent_name, event_name, result, replay_url, raw_log, battle_date)
     VALUES ('showdown', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.formatId, params.parsed.formatLabel, params.teamId, opponentName, params.eventName,
      params.result, params.replayUrl, params.rawLog, battleDate,
    ],
  );
  const battleId = insertRes.lastInsertId as number;

  const { pokemonByKey, itemByKey, abilityByKey, moveByKey } = await buildNameLookups(db);

  for (const mon of params.parsed.revealed[params.ourSide]) {
    const pokemonId = pokemonByKey.get(normalizeKey(mon.species));
    if (!pokemonId) continue;
    const moveIds = mon.moves.slice(0, 4).map((mv) => moveByKey.get(normalizeKey(mv)) ?? null);
    await db.execute(
      `INSERT INTO battle_my_pokemon
         (battle_id, pokemon_id, item_id, ability_id, tera_type, was_brought,
          move1_id, move2_id, move3_id, move4_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        battleId, pokemonId,
        mon.item ? itemByKey.get(normalizeKey(mon.item)) ?? null : null,
        mon.ability ? abilityByKey.get(normalizeKey(mon.ability)) ?? null : null,
        mon.teraType, moveIds[0] ?? null, moveIds[1] ?? null, moveIds[2] ?? null, moveIds[3] ?? null,
      ],
    );
  }

  for (const mon of params.parsed.revealed[opponentSide]) {
    const pokemonId = pokemonByKey.get(normalizeKey(mon.species));
    if (!pokemonId) continue;
    const moveIds = mon.moves.slice(0, 4).map((mv) => moveByKey.get(normalizeKey(mv)) ?? null);
    await db.execute(
      `INSERT INTO battle_opponent_pokemon
         (battle_id, pokemon_id, observed_item_id, observed_ability_id, observed_tera_type,
          observed_move1_id, observed_move2_id, observed_move3_id, observed_move4_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        battleId, pokemonId,
        mon.item ? itemByKey.get(normalizeKey(mon.item)) ?? null : null,
        mon.ability ? abilityByKey.get(normalizeKey(mon.ability)) ?? null : null,
        mon.teraType, moveIds[0] ?? null, moveIds[1] ?? null, moveIds[2] ?? null, moveIds[3] ?? null,
      ],
    );
  }

  return { battleId, alreadyLogged: false };
}

export interface ManualOpponentMon {
  pokemonId: number;
  itemId: number | null;
  abilityId: number | null;
  teraType: string | null;
  moveIds: (number | null)[];
}

export interface SaveManualBattleParams {
  formatId: number | null;
  teamId: number | null;
  opponentName: string;
  eventName: string | null;
  result: "win" | "loss" | "tie" | null;
  battleDate: string | null;
  opponentMons: ManualOpponentMon[];
}

/** Saves a battle with no replay -- e.g. a Pokémon Champions app match. "My" side is copied from the linked team's current roster, since there's no in-battle reveal data to parse. */
export async function saveManualBattle(db: Database, params: SaveManualBattleParams): Promise<number> {
  const insertRes = await db.execute(
    `INSERT INTO battles (source, format_id, my_team_id, opponent_name, event_name, result, battle_date)
     VALUES ('manual', ?, ?, ?, ?, ?, ?)`,
    [params.formatId, params.teamId, params.opponentName, params.eventName, params.result, params.battleDate],
  );
  const battleId = insertRes.lastInsertId as number;

  if (params.teamId) {
    const members = await getTeamMembers(db, params.teamId);
    for (const m of members) {
      await db.execute(
        `INSERT INTO battle_my_pokemon
           (battle_id, pokemon_id, item_id, ability_id, tera_type, was_brought,
            move1_id, move2_id, move3_id, move4_id)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [battleId, m.pokemon_id, m.item_id, m.ability_id, m.tera_type, m.move1_id, m.move2_id, m.move3_id, m.move4_id],
      );
    }
  }

  for (const mon of params.opponentMons) {
    await db.execute(
      `INSERT INTO battle_opponent_pokemon
         (battle_id, pokemon_id, observed_item_id, observed_ability_id, observed_tera_type,
          observed_move1_id, observed_move2_id, observed_move3_id, observed_move4_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        battleId, mon.pokemonId, mon.itemId, mon.abilityId, mon.teraType,
        mon.moveIds[0] ?? null, mon.moveIds[1] ?? null, mon.moveIds[2] ?? null, mon.moveIds[3] ?? null,
      ],
    );
  }

  return battleId;
}
