export interface Team {
  id: number;
  name: string;
  format_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: number;
  team_id: number;
  slot: number;
  pokemon_id: number;
  nickname: string | null;
  item_id: number | null;
  ability_id: number | null;
  nature: string | null;
  tera_type: string | null;
  level: number;
  move1_id: number | null;
  move2_id: number | null;
  move3_id: number | null;
  move4_id: number | null;
  ev_hp: number; ev_atk: number; ev_def: number; ev_spa: number; ev_spd: number; ev_spe: number;
  iv_hp: number; iv_atk: number; iv_def: number; iv_spa: number; iv_spd: number; iv_spe: number;
}

// Joined view used by the editor: the member row plus enough denormalized
// display data (names) to render without a fetch per field.
export interface TeamMemberDisplay extends TeamMember {
  pokemon_name: string;
  pokemon_form_label: string | null;
  pokemon_sprite: string | null;
  pokemon_showdown_name: string | null;
  type1: string;
  type2: string | null;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_spa: number;
  base_spd: number;
  base_spe: number;
  item_name: string | null;
  item_sprite_x: number | null;
  item_sprite_y: number | null;
  ability_name: string | null;
  move1_name: string | null;
  move2_name: string | null;
  move3_name: string | null;
  move4_name: string | null;
  move1_type: string | null;
  move2_type: string | null;
  move3_type: string | null;
  move4_type: string | null;
}

export const EMPTY_MOVE_SLOTS: (number | null)[] = [null, null, null, null];
