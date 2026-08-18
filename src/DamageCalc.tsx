import { useEffect, useMemo, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { calcDamage, type CalcSide } from "./damageMath";
import { getFormats, getLegalPokemonForFormat, listDamagingMoves, listPokemon, type FormatRow } from "./db/queries";
import { calcStat, NATURES, STATS } from "./constants/gameData";
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

function SpeedTiersView({ db }: { db: Database }) {
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [formatId, setFormatId] = useState<number | null>(null);
  const [legal, setLegal] = useState<(PokemonRow & { legality_status: string })[]>([]);
  const [query, setQuery] = useState("");
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    getFormats(db).then((f) => {
      setFormats(f);
      setFormatId((cur) => cur ?? f[0]?.id ?? null);
    });
  }, [db]);

  useEffect(() => {
    if (formatId == null) { setLegal([]); return; }
    getLegalPokemonForFormat(db, formatId).then(setLegal);
    setCompareIds(new Set());
  }, [db, formatId]);

  // Always level 50 -- the standard speed-tier benchmark regardless of the
  // format's own singles/doubles level convention (unlike the damage calc
  // and team builder, which do follow that split).
  const level = 50;

  const allRows = useMemo(() => {
    return legal
      // "Restricted" legendaries (VGC's box-legend cap) are still pickable in
      // the Team Builder, but here they'd just clutter a quick speed lookup
      // -- and the current legality data flags *every* legendary restricted,
      // not just the real box-art ones, so leaving them in would be actively
      // misleading (see build-pokedex.mjs's officialFormats legality note).
      .filter((p) => p.legality_status !== "restricted")
      .map((p) => ({
        pokemon: p,
        // Max: 252 EVs, 31 IV, a +Speed nature -- the standard "how fast can this get" benchmark.
        maxSpeed: calcStat(p.base_spe, 31, 252, level, false, 1.1),
        // Base: 0 EVs, neutral nature -- what it outspeeds with zero investment.
        baseSpeed: calcStat(p.base_spe, 31, 0, level, false, 1.0),
      }))
      .sort((a, b) => b.maxSpeed - a.maxSpeed);
  }, [legal, level]);

  const rows = useMemo(() => {
    const q = normalizeKey(query);
    return allRows.filter((r) => !q || normalizeKey(r.pokemon.display_name).includes(q));
  }, [allRows, query]);

  const compareRows = useMemo(
    () => allRows.filter((r) => compareIds.has(r.pokemon.id)),
    [allRows, compareIds],
  );

  const toggleCompare = (id: number) => {
    setCompareIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="speed-tier-page">
      <h2>Speed Tiers</h2>
      <p className="settings-hint">
        Max = 252 EVs, 31 IV, +Speed nature at level {level}. Base = 0 EVs, neutral nature. Sorted by Max speed.
        Check Pokémon to pin them into the comparison panel below.
      </p>

      <div className="speed-tier-controls">
        <select value={formatId ?? ""} onChange={(e) => setFormatId(Number(e.target.value))}>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          type="text"
          placeholder="Filter species..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {compareRows.length > 0 && (
        <div className="speed-tier-compare">
          <div className="speed-tier-compare-header">
            <h3>Comparing {compareRows.length}</h3>
            <button type="button" className="ghost-btn" onClick={() => setCompareIds(new Set())}>Clear</button>
          </div>
          <div className="speed-tier-compare-cards">
            {compareRows.map((r, i) => {
              const prev = compareRows[i - 1];
              const gap = prev ? r.maxSpeed - prev.maxSpeed : null;
              const fastest = compareRows[0].maxSpeed;
              const barPct = fastest > 0 ? Math.max(6, Math.round((r.maxSpeed / fastest) * 100)) : 0;
              return (
                <div key={r.pokemon.id} className="speed-tier-card">
                  <button
                    type="button"
                    className="speed-tier-card-remove"
                    onClick={() => toggleCompare(r.pokemon.id)}
                    aria-label={`Remove ${r.pokemon.display_name} from comparison`}
                  >
                    ×
                  </button>
                  <span className="speed-tier-card-rank">#{i + 1}</span>
                  {r.pokemon.sprite_default && <img src={r.pokemon.sprite_default} alt="" className="speed-tier-card-sprite" />}
                  <span className="speed-tier-card-name">{r.pokemon.display_name}</span>
                  <span className="battle-preview-types">
                    <TypeBadge type={r.pokemon.type1} />
                    {r.pokemon.type2 && <TypeBadge type={r.pokemon.type2} />}
                  </span>
                  <span className="speed-tier-card-max">{r.maxSpeed}</span>
                  <div className="speed-tier-card-bar-track">
                    <div className="speed-tier-card-bar-fill" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="speed-tier-card-base">{r.baseSpeed} base</span>
                  {gap != null && (
                    <span className="speed-tier-card-gap">{gap === 0 ? "Tied" : `−${gap} vs #${i}`}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="speed-tier-scroll">
        <div className="speed-tier-list">
          {rows.map((r) => (
            <div
              key={r.pokemon.id}
              className={"speed-tier-row" + (compareIds.has(r.pokemon.id) ? " speed-tier-row--pinned" : "")}
            >
              <input
                type="checkbox"
                checked={compareIds.has(r.pokemon.id)}
                onChange={() => toggleCompare(r.pokemon.id)}
                aria-label={`Compare ${r.pokemon.display_name}`}
              />
              {r.pokemon.sprite_default && <img src={r.pokemon.sprite_default} alt="" className="speed-tier-sprite" />}
              <span className="speed-tier-name">{r.pokemon.display_name}</span>
              <span className="battle-preview-types">
                <TypeBadge type={r.pokemon.type1} />
                {r.pokemon.type2 && <TypeBadge type={r.pokemon.type2} />}
              </span>
              <span className="speed-tier-max">{r.maxSpeed}</span>
              <span className="speed-tier-base">{r.baseSpeed} base</span>
            </div>
          ))}
          {rows.length === 0 && <p className="settings-hint">No Pokémon match.</p>}
        </div>
      </div>
    </div>
  );
}

export default function DamageCalc({ db }: { db: Database }) {
  const [mode, setMode] = useState<"calc" | "speed">("calc");
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

  const modeTabs = (
    <div className="calc-mode-tabs">
      <button className={mode === "calc" ? "active" : ""} onClick={() => setMode("calc")}>Damage Calc</button>
      <button className={mode === "speed" ? "active" : ""} onClick={() => setMode("speed")}>Speed Tiers</button>
    </div>
  );

  if (mode === "speed") {
    return (
      <div className="calc-page calc-page--speed">
        {modeTabs}
        <SpeedTiersView db={db} />
      </div>
    );
  }

  return (
    <div className="calc-page">
      {modeTabs}
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
