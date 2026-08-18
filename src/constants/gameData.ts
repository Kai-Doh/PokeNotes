// Fixed game mechanics that aren't per-Pokémon data, so they don't live in
// the database -- natures, types (for Tera), and stat keys are the same for
// every Pokémon in every generation this app targets.

export interface Nature {
  name: string;
  boosts: "hp" | "atk" | "def" | "spa" | "spd" | "spe" | null;
  hinders: "hp" | "atk" | "def" | "spa" | "spd" | "spe" | null;
}

export const NATURES: Nature[] = [
  { name: "Hardy", boosts: null, hinders: null },
  { name: "Lonely", boosts: "atk", hinders: "def" },
  { name: "Brave", boosts: "atk", hinders: "spe" },
  { name: "Adamant", boosts: "atk", hinders: "spa" },
  { name: "Naughty", boosts: "atk", hinders: "spd" },
  { name: "Bold", boosts: "def", hinders: "atk" },
  { name: "Docile", boosts: null, hinders: null },
  { name: "Relaxed", boosts: "def", hinders: "spe" },
  { name: "Impish", boosts: "def", hinders: "spa" },
  { name: "Lax", boosts: "def", hinders: "spd" },
  { name: "Timid", boosts: "spe", hinders: "atk" },
  { name: "Hasty", boosts: "spe", hinders: "def" },
  { name: "Serious", boosts: null, hinders: null },
  { name: "Jolly", boosts: "spe", hinders: "spa" },
  { name: "Naive", boosts: "spe", hinders: "spd" },
  { name: "Modest", boosts: "spa", hinders: "atk" },
  { name: "Mild", boosts: "spa", hinders: "def" },
  { name: "Quiet", boosts: "spa", hinders: "spe" },
  { name: "Bashful", boosts: null, hinders: null },
  { name: "Rash", boosts: "spa", hinders: "spd" },
  { name: "Calm", boosts: "spd", hinders: "atk" },
  { name: "Gentle", boosts: "spd", hinders: "def" },
  { name: "Sassy", boosts: "spd", hinders: "spe" },
  { name: "Careful", boosts: "spd", hinders: "spa" },
  { name: "Quirky", boosts: null, hinders: null },
];

export const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
  "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark",
  "steel", "fairy", "stellar",
];

export const STATS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "Atk" },
  { key: "def", label: "Def" },
  { key: "spa", label: "SpA" },
  { key: "spd", label: "SpD" },
  { key: "spe", label: "Spe" },
] as const;

export const MAX_EV_PER_STAT = 252;
export const MAX_EV_TOTAL = 508;
export const MAX_IV_PER_STAT = 31;

/** Standard Gen 3+ stat formula. `natureMod` is 1.1 / 0.9 / 1.0; ignored for HP. */
export function calcStat(base: number, iv: number, ev: number, level: number, isHp: boolean, natureMod: number): number {
  if (isHp) {
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(raw * natureMod);
}

export function natureModFor(nature: Nature | undefined, statKey: string): number {
  if (!nature) return 1;
  if (nature.boosts === statKey) return 1.1;
  if (nature.hinders === statKey) return 0.9;
  return 1;
}

// The 18 real types for effectiveness purposes -- "stellar" is Tera-only and
// has no place in a normal type chart (it just gets a one-time STAB boost),
// so it's excluded here even though it's a valid Tera Type selection above.
export const REAL_TYPES = TYPES.filter((t) => t !== "stellar");

// Standard current-gen (Gen 6+) type chart, keyed by attacking type. Only
// exceptions to 1x are listed; anything not in super/notVery/no is neutral.
const TYPE_CHART: Record<string, { super?: string[]; notVery?: string[]; no?: string[] }> = {
  normal: { notVery: ["rock", "steel"], no: ["ghost"] },
  fire: { super: ["grass", "ice", "bug", "steel"], notVery: ["fire", "water", "rock", "dragon"] },
  water: { super: ["fire", "ground", "rock"], notVery: ["water", "grass", "dragon"] },
  electric: { super: ["water", "flying"], notVery: ["electric", "grass", "dragon"], no: ["ground"] },
  grass: { super: ["water", "ground", "rock"], notVery: ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"] },
  ice: { super: ["grass", "ground", "flying", "dragon"], notVery: ["fire", "water", "ice", "steel"] },
  fighting: { super: ["normal", "ice", "rock", "dark", "steel"], notVery: ["poison", "flying", "psychic", "bug", "fairy"], no: ["ghost"] },
  poison: { super: ["grass", "fairy"], notVery: ["poison", "ground", "rock", "ghost"], no: ["steel"] },
  ground: { super: ["fire", "electric", "poison", "rock", "steel"], notVery: ["grass", "bug"], no: ["flying"] },
  flying: { super: ["grass", "fighting", "bug"], notVery: ["electric", "rock", "steel"] },
  psychic: { super: ["fighting", "poison"], notVery: ["psychic", "steel"], no: ["dark"] },
  bug: { super: ["grass", "psychic", "dark"], notVery: ["fire", "fighting", "poison", "flying", "ghost", "steel", "fairy"] },
  rock: { super: ["fire", "ice", "flying", "bug"], notVery: ["fighting", "ground", "steel"] },
  ghost: { super: ["psychic", "ghost"], notVery: ["dark"], no: ["normal"] },
  dragon: { super: ["dragon"], notVery: ["steel"], no: ["fairy"] },
  dark: { super: ["psychic", "ghost"], notVery: ["fighting", "dark", "fairy"] },
  steel: { super: ["ice", "rock", "fairy"], notVery: ["fire", "water", "electric", "steel"] },
  fairy: { super: ["fighting", "dragon", "dark"], notVery: ["fire", "poison", "steel"] },
};

export function typeEffectiveness(attackType: string, defendType: string): number {
  const chart = TYPE_CHART[attackType];
  if (!chart) return 1;
  if (chart.no?.includes(defendType)) return 0;
  if (chart.super?.includes(defendType)) return 2;
  if (chart.notVery?.includes(defendType)) return 0.5;
  return 1;
}

/** Combined multiplier for a (possibly dual-typed) defender against one attacking type. */
export function dualTypeEffectiveness(attackType: string, defType1: string, defType2?: string | null): number {
  const m1 = typeEffectiveness(attackType, defType1);
  const m2 = defType2 ? typeEffectiveness(attackType, defType2) : 1;
  return m1 * m2;
}
