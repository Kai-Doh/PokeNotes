import { calcStat, dualTypeEffectiveness, natureModFor, NATURES } from "./constants/gameData";
import type { MoveRow, PokemonRow } from "./types/pokedex";

export interface CalcSide {
  pokemon: PokemonRow;
  level: number;
  nature: string;
  evs: Record<string, number>;
}

export interface CalcResult {
  rolls: number[]; // 16 damage values, ascending (the 85%-100% random spread)
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  defenderHp: number;
  koChanceOf16: number;
  typeEffectiveness: number;
  isStab: boolean;
}

function statFor(side: CalcSide, key: string): number {
  const nature = NATURES.find((n) => n.name === side.nature);
  const base = (side.pokemon as unknown as Record<string, number>)[`base_${key}`];
  return calcStat(base, 31, side.evs[key] ?? 0, side.level, key === "hp", natureModFor(nature, key));
}

/**
 * A deliberately simple damage calc: base formula, STAB, type effectiveness,
 * and the real 16-roll random spread (85%-100%), assuming max (31) IVs and a
 * neutral weather/terrain/field state. No items, abilities, status, or
 * multi-hit modifiers -- those would need per-move/per-ability special-casing
 * well beyond what's worth building for a "quick sanity check" tool.
 */
export function calcDamage(attacker: CalcSide, defender: CalcSide, move: MoveRow, isCrit: boolean): CalcResult | null {
  if (!move.power) return null;

  const offenseKey = move.category === "physical" ? "atk" : "spa";
  const defenseKey = move.category === "physical" ? "def" : "spd";
  const atkStat = statFor(attacker, offenseKey);
  const defStat = statFor(defender, defenseKey);
  const defenderHp = statFor(defender, "hp");

  const isStab = attacker.pokemon.type1 === move.type || attacker.pokemon.type2 === move.type;
  const typeEff = dualTypeEffectiveness(move.type, defender.pokemon.type1, defender.pokemon.type2);

  const baseDamage = Math.floor(Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * move.power * atkStat / defStat) / 50) + 2;
  const stabMult = isStab ? 1.5 : 1;
  const critMult = isCrit ? 1.5 : 1;

  const rolls: number[] = [];
  for (let r = 85; r <= 100; r++) {
    rolls.push(Math.max(typeEff === 0 ? 0 : 1, Math.floor(baseDamage * stabMult * typeEff * critMult * (r / 100))));
  }
  if (typeEff === 0) rolls.fill(0);

  const min = rolls[0];
  const max = rolls[rolls.length - 1];
  const koChanceOf16 = rolls.filter((d) => d >= defenderHp).length;

  return {
    rolls, min, max,
    minPercent: Math.min(100, Math.round((min / defenderHp) * 1000) / 10),
    maxPercent: Math.min(100, Math.round((max / defenderHp) * 1000) / 10),
    defenderHp, koChanceOf16, typeEffectiveness: typeEff, isStab,
  };
}
