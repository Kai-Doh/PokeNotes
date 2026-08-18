import { useEffect, useMemo, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { calcDamage, type CalcSide } from "./damageMath";
import { listDamagingMoves, listPokemon } from "./db/queries";
import { NATURES, STATS } from "./constants/gameData";
import { normalizeKey } from "./showdownFormat";
import { PickerModal, TypeBadge } from "./TeamBuilder";
import type { MoveRow, PokemonRow } from "./types/pokedex";
import "./App.css";

function defaultSide(pokemon: PokemonRow | null): { pokemon: PokemonRow | null; level: number; nature: string; evs: Record<string, number> } {
  return {
    pokemon,
    level: 50,
    nature: "Hardy",
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
}

type SideState = ReturnType<typeof defaultSide>;

function SpeciesPickerButton({ pokemon, onClick }: { pokemon: PokemonRow | null; onClick: () => void }) {
  return (
    <button type="button" className="ghost-btn manual-mon-species-btn" onClick={onClick}>
      {pokemon ? (
        <>
          {pokemon.sprite_default && <img src={pokemon.sprite_default} alt="" className="battle-roster-sprite" />}
          {pokemon.display_name}
        </>
      ) : "Select species..."}
    </button>
  );
}

function StatSideEditor({
  title, side, onPickSpecies, onChange,
}: {
  title: string;
  side: SideState;
  onPickSpecies: () => void;
  onChange: (patch: Partial<SideState>) => void;
}) {
  return (
    <div className="calc-side">
      <h4>{title}</h4>
      <SpeciesPickerButton pokemon={side.pokemon} onClick={onPickSpecies} />
      {side.pokemon && (
        <div className="battle-preview-types">
          <TypeBadge type={side.pokemon.type1} />
          {side.pokemon.type2 && <TypeBadge type={side.pokemon.type2} />}
        </div>
      )}
      <div className="battle-log-form-row">
        <label>
          Level
          <input
            type="number" min={1} max={100} value={side.level}
            onChange={(e) => onChange({ level: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
          />
        </label>
        <label>
          Nature
          <select value={side.nature} onChange={(e) => onChange({ nature: e.target.value })}>
            {NATURES.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
          </select>
        </label>
      </div>
      <div className="calc-ev-grid">
        {STATS.map((s) => (
          <label key={s.key} className="calc-ev-field">
            {s.label}
            <input
              type="number" min={0} max={252} step={4}
              value={side.evs[s.key]}
              onChange={(e) => onChange({ evs: { ...side.evs, [s.key]: Math.max(0, Math.min(252, Number(e.target.value) || 0)) } })}
            />
          </label>
        ))}
      </div>
      <p className="settings-hint">Assumes 31 IVs in every stat.</p>
    </div>
  );
}

type PickerTarget = "attacker" | "defender" | "move";

export default function DamageCalc({ db }: { db: Database }) {
  const [attacker, setAttacker] = useState<SideState>(defaultSide(null));
  const [defender, setDefender] = useState<SideState>(defaultSide(null));
  const [move, setMove] = useState<MoveRow | null>(null);
  const [isCrit, setIsCrit] = useState(false);
  const [allPokemon, setAllPokemon] = useState<PokemonRow[]>([]);
  const [allMoves, setAllMoves] = useState<MoveRow[]>([]);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listPokemon(db).then(setAllPokemon);
    listDamagingMoves(db).then(setAllMoves);
  }, [db]);

  const result = useMemo(() => {
    if (!attacker.pokemon || !defender.pokemon || !move) return null;
    return calcDamage(
      { pokemon: attacker.pokemon, level: attacker.level, nature: attacker.nature, evs: attacker.evs } as CalcSide,
      { pokemon: defender.pokemon, level: defender.level, nature: defender.nature, evs: defender.evs } as CalcSide,
      move, isCrit,
    );
  }, [attacker, defender, move, isCrit]);

  const speciesOptions = useMemo(() => {
    const q = normalizeKey(query);
    return allPokemon.filter((p) => !q || normalizeKey(p.display_name).includes(q)).slice(0, 40);
  }, [query, allPokemon]);

  const moveOptions = useMemo(() => {
    const q = normalizeKey(query);
    return allMoves.filter((m) => !q || normalizeKey(m.display_name).includes(q)).slice(0, 40);
  }, [query, allMoves]);

  return (
    <div className="calc-page">
      <h2>Damage Calculator</h2>
      <p className="settings-hint">
        Base formula, STAB, type effectiveness, and the real 16-roll random spread — no items, abilities, weather, or status effects factored in.
      </p>

      <div className="calc-sides">
        <StatSideEditor
          title="Attacker"
          side={attacker}
          onPickSpecies={() => { setQuery(""); setPicker("attacker"); }}
          onChange={(patch) => setAttacker((s) => ({ ...s, ...patch }))}
        />
        <StatSideEditor
          title="Defender"
          side={defender}
          onPickSpecies={() => { setQuery(""); setPicker("defender"); }}
          onChange={(patch) => setDefender((s) => ({ ...s, ...patch }))}
        />
      </div>

      <div className="calc-move-row">
        <label>
          Move
          <button type="button" className="ghost-btn" onClick={() => { setQuery(""); setPicker("move"); }}>
            {move ? move.display_name : "Select move..."}
          </button>
        </label>
        {move && (
          <div className="battle-preview-types">
            <TypeBadge type={move.type} />
            <span className="battle-roster-detail">{move.category} · {move.power} BP</span>
          </div>
        )}
        <label className="calc-crit-toggle">
          <input type="checkbox" checked={isCrit} onChange={(e) => setIsCrit(e.target.checked)} />
          Critical hit
        </label>
      </div>

      {result && (
        <div className="calc-result">
          {result.typeEffectiveness === 0 ? (
            <p className="calc-result-headline">No effect.</p>
          ) : (
            <>
              <p className="calc-result-headline">
                {result.min}–{result.max} damage ({result.minPercent}%–{result.maxPercent}%)
                {result.isStab && " · STAB"}
                {result.typeEffectiveness > 1 && " · Super effective"}
                {result.typeEffectiveness < 1 && " · Not very effective"}
              </p>
              <p className="settings-hint">
                {result.koChanceOf16 === 16
                  ? "Guaranteed OHKO."
                  : result.koChanceOf16 > 0
                    ? `Possible OHKO (${result.koChanceOf16}/16 rolls).`
                    : `Defender's HP: ${result.defenderHp}.`}
              </p>
            </>
          )}
        </div>
      )}

      {picker === "attacker" && (
        <PickerModal
          title="Choose attacker"
          options={speciesOptions}
          query={query}
          onQueryChange={setQuery}
          onPick={(p) => { setAttacker((s) => ({ ...s, pokemon: p })); setPicker(null); }}
          onClose={() => setPicker(null)}
          renderIcon={(p) => (p.sprite_default ? <img src={p.sprite_default} className="dropdown-icon" alt="" /> : null)}
        />
      )}
      {picker === "defender" && (
        <PickerModal
          title="Choose defender"
          options={speciesOptions}
          query={query}
          onQueryChange={setQuery}
          onPick={(p) => { setDefender((s) => ({ ...s, pokemon: p })); setPicker(null); }}
          onClose={() => setPicker(null)}
          renderIcon={(p) => (p.sprite_default ? <img src={p.sprite_default} className="dropdown-icon" alt="" /> : null)}
        />
      )}
      {picker === "move" && (
        <PickerModal
          title="Choose a move"
          options={moveOptions}
          query={query}
          onQueryChange={setQuery}
          onPick={(m) => { setMove(m); setPicker(null); }}
          onClose={() => setPicker(null)}
          renderBadge={(m) => <TypeBadge type={m.type} />}
          renderDescription={(m) => `${m.category} · ${m.power} BP` + (m.short_effect ? ` · ${m.short_effect}` : "")}
        />
      )}
    </div>
  );
}
