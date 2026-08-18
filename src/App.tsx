import { useEffect, useMemo, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "./db/client";
import { getPokedexUpdatedAt, refreshPokedexData, seedDatabaseIfNeeded, type SeedProgress } from "./db/pokedex-data";
import { getAbilitiesFor, getBattleFormVariants, getFormatLegalityFor, getLearnsetFor, listPokemon } from "./db/queries";
import type { AbilityRef, FormatLegalityEntry, LearnsetMove, PokemonRow } from "./types/pokedex";
import "./App.css";

function useDatabase() {
  const [db, setDb] = useState<Database | null>(null);
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        console.log("[pokenotes] connecting to db...");
        const database = await getDb();
        console.log("[pokenotes] db connected, checking seed status...");
        await seedDatabaseIfNeeded(database, (p) => {
          console.log(`[pokenotes] seed progress: ${p.step} ${p.done}/${p.total}`);
          if (!cancelled) setProgress(p);
        });
        console.log("[pokenotes] seed complete");
        if (!cancelled) setDb(database);
      } catch (e) {
        console.error("[pokenotes] db init failed:", e);
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { db, progress, error };
}

function TypeBadge({ type }: { type: string }) {
  return <span className={`type-badge type-${type}`}>{type}</span>;
}

function StatBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, (value / 200) * 100);
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-track">
        <div className="stat-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function PokemonDetail({ db, pokemon }: { db: Database; pokemon: PokemonRow }) {
  const [variants, setVariants] = useState<PokemonRow[]>([]);
  const [activeForm, setActiveForm] = useState<PokemonRow>(pokemon);
  const [abilities, setAbilities] = useState<AbilityRef[]>([]);
  const [moves, setMoves] = useState<LearnsetMove[]>([]);
  const [legality, setLegality] = useState<FormatLegalityEntry[]>([]);
  const [moveFilter, setMoveFilter] = useState("");

  // Switching the list selection resets which tab (base vs battle form) is active.
  useEffect(() => {
    setActiveForm(pokemon);
    getBattleFormVariants(db, pokemon.species_id).then(setVariants);
  }, [db, pokemon]);

  useEffect(() => {
    getAbilitiesFor(db, activeForm.id).then(setAbilities);
    getLearnsetFor(db, activeForm.id).then(setMoves);
    getFormatLegalityFor(db, activeForm.id).then(setLegality);
  }, [db, activeForm.id]);

  const filteredMoves = useMemo(
    () => moves.filter((m) => m.display_name.toLowerCase().includes(moveFilter.toLowerCase())),
    [moves, moveFilter],
  );

  const sprite = activeForm.sprite_official_art || activeForm.sprite_home || activeForm.sprite_default;

  return (
    <div className="detail">
      <div className="detail-header">
        <img src={sprite ?? undefined} alt={activeForm.display_name} className="detail-sprite" />
        <div>
          <h2>
            {activeForm.display_name}
            {activeForm.form_label ? ` — ${activeForm.form_label}` : ""}
          </h2>
          <div className="dex-num">#{activeForm.national_dex_number}</div>
          <div className="types">
            <TypeBadge type={activeForm.type1} />
            {activeForm.type2 && <TypeBadge type={activeForm.type2} />}
          </div>
        </div>
      </div>

      {variants.length > 0 && (
        <div className="form-tabs">
          <button className={activeForm.id === pokemon.id ? "active" : ""} onClick={() => setActiveForm(pokemon)}>
            {pokemon.display_name}
          </button>
          {variants.map((v) => (
            <button key={v.id} className={activeForm.id === v.id ? "active" : ""} onClick={() => setActiveForm(v)}>
              {v.form_label ?? v.display_name}
            </button>
          ))}
        </div>
      )}

      <section>
        <h3>Base Stats</h3>
        <StatBar label="HP" value={activeForm.base_hp} />
        <StatBar label="Atk" value={activeForm.base_atk} />
        <StatBar label="Def" value={activeForm.base_def} />
        <StatBar label="SpA" value={activeForm.base_spa} />
        <StatBar label="SpD" value={activeForm.base_spd} />
        <StatBar label="Spe" value={activeForm.base_spe} />
      </section>

      <section>
        <h3>Abilities</h3>
        <ul className="ability-list">
          {abilities.map((a) => (
            <li key={a.id}>
              <strong>{a.display_name}</strong>
              {a.is_hidden ? <span className="hidden-tag"> (Hidden)</span> : null}
              {a.short_effect && <div className="ability-effect">{a.short_effect}</div>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Format Legality</h3>
        <div className="legality-grid">
          {legality.map((l) => (
            <span key={l.format_id} className={`legality-badge status-${l.status}`}>
              {l.name}
              {l.tier ? ` (${l.tier})` : ""}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h3>Moves ({moves.length})</h3>
        <input
          className="move-filter"
          placeholder="Filter moves..."
          value={moveFilter}
          onChange={(e) => setMoveFilter(e.target.value)}
        />
        <table className="move-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Cat</th>
              <th>Pow</th>
              <th>Acc</th>
              <th>PP</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {filteredMoves.map((m) => (
              <tr key={`${m.id}-${m.method}`}>
                <td>{m.display_name}</td>
                <td><TypeBadge type={m.type} /></td>
                <td>{m.category}</td>
                <td>{m.power ?? "—"}</td>
                <td>{m.accuracy ?? "—"}</td>
                <td>{m.pp ?? "—"}</td>
                <td>{m.method === "level-up" ? `Lv ${m.level}` : m.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PokedexBrowser({ db }: { db: Database }) {
  const [all, setAll] = useState<PokemonRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PokemonRow | null>(null);

  useEffect(() => {
    listPokemon(db).then((rows) => {
      setAll(rows);
      setSelected(rows[0] ?? null);
    });
  }, [db]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => p.display_name.toLowerCase().includes(q) || p.form_label?.toLowerCase().includes(q));
  }, [all, search]);

  return (
    <div className="pokedex">
      <div className="pokedex-list">
        <input
          className="search-box"
          placeholder={`Search ${all.length} Pokémon...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul>
          {filtered.map((p) => (
            <li
              key={p.id}
              className={selected?.id === p.id ? "selected" : ""}
              onClick={() => setSelected(p)}
            >
              <img src={p.sprite_default ?? undefined} alt="" loading="lazy" />
              <span>
                #{p.national_dex_number} {p.display_name}
                {p.form_label ? ` (${p.form_label})` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="pokedex-detail">
        {selected ? <PokemonDetail db={db} pokemon={selected} /> : <p>Select a Pokémon</p>}
      </div>
    </div>
  );
}

function SettingsView({ db }: { db: Database }) {
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<SeedProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getPokedexUpdatedAt(db).then(setUpdatedAt);
  }, [db]);

  async function handleRefresh() {
    setRefreshing(true);
    setMessage(null);
    try {
      await refreshPokedexData(db, setRefreshProgress);
      setUpdatedAt(await getPokedexUpdatedAt(db));
      setMessage("Pokédex data refreshed successfully.");
    } catch (e) {
      setMessage(`Refresh failed: ${String(e)}. Your existing data was kept where possible.`);
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }

  const pct = refreshProgress ? Math.round((refreshProgress.done / Math.max(1, refreshProgress.total)) * 100) : 0;

  return (
    <div className="settings">
      <h2>Settings</h2>

      <section>
        <h3>Pokédex Data</h3>
        <p className="settings-hint">
          Species, movesets, items, and format legality are bundled with the app and don't update on
          their own. Refresh to pull the latest from the PokeNotes data source (tier shifts, new
          regulations, newly added Pokémon).
        </p>
        <p className="settings-meta">
          Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "unknown"}
        </p>
        <button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing..." : "Refresh Pokédex Data"}
        </button>
        {refreshing && refreshProgress && (
          <div className="seed-progress">
            <div className="seed-progress-track">
              <div className="seed-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span>{refreshProgress.step} ({refreshProgress.done}/{refreshProgress.total})</span>
          </div>
        )}
        {message && <p className="settings-message">{message}</p>}
      </section>
    </div>
  );
}

function App() {
  const { db, progress, error } = useDatabase();
  const [view, setView] = useState<"pokedex" | "settings">("pokedex");

  if (error) return <main className="container"><p className="error">Failed to load database: {error}</p></main>;

  if (!db) {
    const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <main className="container loading-screen">
        <h1>PokeNotes</h1>
        <p>Setting up your local Pokédex (first run only)...</p>
        {progress && (
          <div className="seed-progress">
            <div className="seed-progress-track">
              <div className="seed-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span>{progress.step} ({progress.done}/{progress.total})</span>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="container">
      <nav className="top-nav">
        <span className="brand">PokeNotes</span>
        <div className="nav-tabs">
          <button className={view === "pokedex" ? "active" : ""} onClick={() => setView("pokedex")}>
            Pokédex
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </div>
      </nav>
      {view === "pokedex" ? <PokedexBrowser db={db} /> : <SettingsView db={db} />}
    </main>
  );
}

export default App;
