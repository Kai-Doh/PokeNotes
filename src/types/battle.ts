export interface Battle {
  id: number;
  source: "showdown" | "champions" | "manual";
  format_id: number | null;
  format_label: string | null;
  my_team_id: number | null;
  opponent_name: string | null;
  event_name: string | null;
  result: "win" | "loss" | "tie" | null;
  replay_url: string | null;
  raw_log: string | null;
  battle_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Battle row plus enough denormalized fields for the list view. */
export interface BattleListEntry extends Battle {
  my_team_name: string | null;
}

export interface BattleMyPokemon {
  id: number;
  battle_id: number;
  pokemon_id: number;
  item_id: number | null;
  ability_id: number | null;
  tera_type: string | null;
  was_brought: number;
  notes: string | null;
}

export interface BattleOpponentPokemon {
  id: number;
  battle_id: number;
  pokemon_id: number;
  observed_item_id: number | null;
  observed_ability_id: number | null;
  observed_tera_type: string | null;
  observed_move1_id: number | null;
  observed_move2_id: number | null;
  observed_move3_id: number | null;
  observed_move4_id: number | null;
  notes: string | null;
}

/** battle_(my|opponent)_pokemon joined with pokemon/items/abilities/moves display names -- carries the raw ids too, so the opponent side can be edited in place. */
export interface BattlePokemonDisplay {
  id: number;
  battle_id: number;
  pokemon_id: number;
  pokemon_name: string;
  pokemon_sprite: string | null;
  type1: string;
  type2: string | null;
  item_id: number | null;
  item_name: string | null;
  item_sprite_x: number | null;
  item_sprite_y: number | null;
  ability_id: number | null;
  ability_name: string | null;
  tera_type: string | null;
  move1_id: number | null;
  move1_name: string | null;
  move2_id: number | null;
  move2_name: string | null;
  move3_id: number | null;
  move3_name: string | null;
  move4_id: number | null;
  move4_name: string | null;
}

export interface BattleNote {
  id: number;
  battle_id: number;
  turn_number: number | null;
  tag: string | null;
  body: string;
  created_at: string;
}

/** One row of the scouting book: a species revealed in some past battle, with where/when it was seen. */
export interface ScoutedSetEntry {
  battle_id: number;
  pokemon_id: number;
  pokemon_name: string;
  pokemon_sprite: string | null;
  type1: string;
  type2: string | null;
  opponent_name: string | null;
  format_label: string | null;
  battle_date: string | null;
  replay_url: string | null;
  item_name: string | null;
  item_sprite_x: number | null;
  item_sprite_y: number | null;
  ability_name: string | null;
  tera_type: string | null;
  move1_name: string | null;
  move2_name: string | null;
  move3_name: string | null;
  move4_name: string | null;
}

export const NOTE_TAGS = ["misplay", "good read", "scary set", "highlight"] as const;
