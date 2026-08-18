export interface PokemonRow {
  id: number;
  species_id: number;
  national_dex_number: number | null;
  name: string;
  display_name: string;
  form_label: string | null;
  is_default_form: number;
  form_category: string | null;
  generation: number | null;
  type1: string;
  type2: string | null;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_spa: number;
  base_spd: number;
  base_spe: number;
  sprite_default: string | null;
  sprite_official_art: string | null;
  sprite_home: string | null;
  is_mega: number;
  is_gmax: number;
  is_legendary: number;
  is_mythical: number;
  showdown_id: string;
}

export interface AbilityRef {
  id: number;
  name: string;
  display_name: string;
  short_effect: string | null;
  is_hidden: number;
}

export interface MoveRow {
  id: number;
  name: string;
  display_name: string;
  type: string;
  category: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  short_effect: string | null;
}

export interface LearnsetMove extends MoveRow {
  method: string;
  level: number | null;
}

export interface FormatLegalityEntry {
  format_id: number;
  code: string;
  name: string;
  status: string;
  tier: string | null;
}
