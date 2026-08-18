import { useEffect, useMemo, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { platform } from "@tauri-apps/plugin-os";
import { getDb } from "./db/client";
import { getPokedexUpdatedAt, refreshPokedexData, seedDatabaseIfNeeded, type SeedProgress } from "./db/pokedex-data";
import { getAbilitiesFor, getBattleFormVariants, getFormatLegalityFor, getLearnsetFor, listPokemon } from "./db/queries";
import type { AbilityRef, FormatLegalityEntry, LearnsetMove, PokemonRow } from "./types/pokedex";
import TeamBuilder from "./TeamBuilder";
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
        <div className="move-table-scroll">
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
        </div>
      </section>
    </div>
  );
}

function PokedexBrowser({ db }: { db: Database }) {
  const [all, setAll] = useState<PokemonRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PokemonRow | null>(null);
  // Desktop shows list+detail side by side always; on a phone-width screen
  // there's only room for one pane, so this tracks which one is showing
  // (CSS below only acts on it under the mobile breakpoint).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

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
    <div className={`pokedex ${mobileDetailOpen ? "mobile-detail-open" : ""}`}>
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
              onClick={() => { setSelected(p); setMobileDetailOpen(true); }}
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
        <button className="mobile-back-btn" onClick={() => setMobileDetailOpen(false)}>← Back to list</button>
        {selected ? <PokemonDetail db={db} pokemon={selected} /> : <p>Select a Pokémon</p>}
      </div>
    </div>
  );
}

function AppUpdateSection() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error">("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The in-place updater plugin only runs on desktop -- Android/iOS builds
  // don't register it at all (see the cfg-gated dependency in Cargo.toml),
  // so this branches to a plain "here's your version" note there instead of
  // a Check for Updates button that would just error out on tap.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion);
    const p = platform();
    setIsMobile(p === "android" || p === "ios");
  }, []);

  async function handleCheck() {
    setStatus("checking");
    setError(null);
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function handleInstall() {
    if (!update) return;
    setStatus("downloading");
    setError(null);
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setDownloadPct(total > 0 ? Math.round((received / total) * 100) : 0);
        } else if (event.event === "Finished") {
          setStatus("ready");
        }
      });
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  if (isMobile) {
    return (
      <section>
        <h3>App Updates</h3>
        <p className="settings-meta">Current version: {appVersion ?? "unknown"}</p>
        <p className="settings-hint">Updates on Android are delivered wherever you installed this build from, not in-app.</p>
      </section>
    );
  }

  return (
    <section>
      <h3>App Updates</h3>
      <p className="settings-hint">
        Checks GitHub Releases for a newer build of PokeNotes and installs it in place.
      </p>
      <p className="settings-meta">Current version: {appVersion ?? "unknown"}</p>

      {status !== "available" && status !== "downloading" && status !== "ready" && (
        <button onClick={handleCheck} disabled={status === "checking"}>
          {status === "checking" ? "Checking..." : "Check for Updates"}
        </button>
      )}

      {status === "up-to-date" && <p className="settings-message">You're on the latest version.</p>}

      {status === "available" && update && (
        <div className="settings-message">
          <p>Version {update.version} is available{update.body ? ":" : "."}</p>
          {update.body && <p className="settings-hint">{update.body}</p>}
          <button onClick={handleInstall}>Install & Restart</button>
        </div>
      )}

      {status === "downloading" && (
        <div className="seed-progress">
          <div className="seed-progress-track">
            <div className="seed-progress-fill" style={{ width: `${downloadPct}%` }} />
          </div>
          <span>Downloading update... {downloadPct}%</span>
        </div>
      )}

      {status === "ready" && <p className="settings-message">Update installed. Restarting...</p>}

      {status === "error" && error && <p className="settings-message">Update check failed: {error}</p>}
    </section>
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

      <AppUpdateSection />
    </div>
  );
}

const NAV_ITEMS = [
  {
    id: "pokedex" as const,
    label: "Pokédex",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6a3 3 0 0 0 6 0h6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: "teams" as const,
    label: "Teams",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2.5 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6" />
        <path d="M14.5 14.3c2.4.4 4 2.6 4 5.7" />
      </svg>
    ),
  },
];

const SETTINGS_NAV_ITEM = {
  id: "settings" as const,
  label: "Settings",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L14.9 3h-3.8l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h3.8l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z" />
    </svg>
  ),
};

function App() {
  const { db, progress, error } = useDatabase();
  const [view, setView] = useState<"pokedex" | "teams" | "settings">("pokedex");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSidebarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

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
        <button
          className={`hamburger-btn ${sidebarOpen ? "open" : ""}`}
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
        <span className="brand">PokeNotes</span>
      </nav>

      <div className={`sidebar-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <span className="brand">PokeNotes</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => { setView(item.id); setSidebarOpen(false); }}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <nav className="sidebar-nav sidebar-nav-footer">
          <button
            className={view === SETTINGS_NAV_ITEM.id ? "active" : ""}
            onClick={() => { setView(SETTINGS_NAV_ITEM.id); setSidebarOpen(false); }}
          >
            <span className="sidebar-icon">{SETTINGS_NAV_ITEM.icon}</span>
            {SETTINGS_NAV_ITEM.label}
          </button>
        </nav>
      </aside>

      <div className="app-body">
        {view === "pokedex" && <PokedexBrowser db={db} />}
        {view === "teams" && <TeamBuilder db={db} />}
        {view === "settings" && <SettingsView db={db} />}
      </div>
    </main>
  );
}

export default App;
