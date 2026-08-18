import type Database from "@tauri-apps/plugin-sql";
import type { Team, TeamMember, TeamMemberDisplay } from "../types/team";

export function listTeams(db: Database): Promise<(Team & { format_name: string | null })[]> {
  return db.select(
    `SELECT t.*, f.name as format_name FROM teams t
     LEFT JOIN formats f ON f.id = t.format_id
     ORDER BY t.updated_at DESC`,
  );
}

export function getTeam(db: Database, teamId: number): Promise<Team | undefined> {
  return db.select<Team[]>("SELECT * FROM teams WHERE id = ?", [teamId]).then((r) => r[0]);
}

export function getTeamMembers(db: Database, teamId: number): Promise<TeamMemberDisplay[]> {
  return db.select<TeamMemberDisplay[]>(
    `SELECT tm.*,
            p.display_name as pokemon_name, p.form_label as pokemon_form_label, p.sprite_default as pokemon_sprite,
            p.showdown_name as pokemon_showdown_name,
            p.type1, p.type2,
            p.base_hp, p.base_atk, p.base_def, p.base_spa, p.base_spd, p.base_spe,
            it.display_name as item_name, it.sprite_x as item_sprite_x, it.sprite_y as item_sprite_y,
            ab.display_name as ability_name,
            m1.display_name as move1_name, m2.display_name as move2_name,
            m3.display_name as move3_name, m4.display_name as move4_name,
            m1.type as move1_type, m2.type as move2_type, m3.type as move3_type, m4.type as move4_type
     FROM team_members tm
     JOIN pokemon p ON p.id = tm.pokemon_id
     LEFT JOIN items it ON it.id = tm.item_id
     LEFT JOIN abilities ab ON ab.id = tm.ability_id
     LEFT JOIN moves m1 ON m1.id = tm.move1_id
     LEFT JOIN moves m2 ON m2.id = tm.move2_id
     LEFT JOIN moves m3 ON m3.id = tm.move3_id
     LEFT JOIN moves m4 ON m4.id = tm.move4_id
     WHERE tm.team_id = ? ORDER BY tm.slot ASC`,
    [teamId],
  );
}

export async function createTeam(db: Database, name: string, formatId: number | null): Promise<number> {
  const result = await db.execute("INSERT INTO teams (name, format_id) VALUES (?, ?)", [name, formatId]);
  return result.lastInsertId as number;
}

export async function updateTeamMeta(
  db: Database,
  teamId: number,
  fields: { name?: string; format_id?: number | null; notes?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(teamId);
  await db.execute(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteTeam(db: Database, teamId: number): Promise<void> {
  await db.execute("DELETE FROM teams WHERE id = ?", [teamId]);
}

const MEMBER_COLUMNS = [
  "team_id", "slot", "pokemon_id", "nickname", "item_id", "ability_id", "nature", "tera_type", "level",
  "move1_id", "move2_id", "move3_id", "move4_id",
  "ev_hp", "ev_atk", "ev_def", "ev_spa", "ev_spd", "ev_spe",
  "iv_hp", "iv_atk", "iv_def", "iv_spa", "iv_spd", "iv_spe",
];

/** Replaces whatever occupies this team/slot pair with the given member data. */
export async function saveTeamMember(db: Database, member: Omit<TeamMember, "id">): Promise<void> {
  await db.execute("DELETE FROM team_members WHERE team_id = ? AND slot = ?", [member.team_id, member.slot]);
  const values = MEMBER_COLUMNS.map((c) => (member as unknown as Record<string, unknown>)[c] ?? null);
  await db.execute(
    `INSERT INTO team_members (${MEMBER_COLUMNS.join(",")}) VALUES (${MEMBER_COLUMNS.map(() => "?").join(",")})`,
    values,
  );
  await db.execute("UPDATE teams SET updated_at = datetime('now') WHERE id = ?", [member.team_id]);
}

export async function clearTeamSlot(db: Database, teamId: number, slot: number): Promise<void> {
  await db.execute("DELETE FROM team_members WHERE team_id = ? AND slot = ?", [teamId, slot]);
  await db.execute("UPDATE teams SET updated_at = datetime('now') WHERE id = ?", [teamId]);
}

export interface TeamRosterEntry {
  team_id: number;
  slot: number;
  pokemon_name: string;
  pokemon_sprite: string | null;
}

/** Every team's roster sprites in one query, for the team list's preview thumbnails. */
export function getAllTeamRosters(db: Database): Promise<TeamRosterEntry[]> {
  return db.select<TeamRosterEntry[]>(
    `SELECT tm.team_id, tm.slot, p.display_name as pokemon_name, p.sprite_default as pokemon_sprite
     FROM team_members tm JOIN pokemon p ON p.id = tm.pokemon_id
     ORDER BY tm.team_id, tm.slot`,
  );
}

