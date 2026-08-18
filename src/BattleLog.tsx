import { useEffect, useMemo, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import {
  fetchReplay, parseBattleLog, parseReplayHtml, parseReplayId,
  type ParsedBattle, type ReplayJson, type Side,
} from "./replayLog";
import {
  addBattleNote, addOpponentMon, deleteBattle, getBattle,
  getBattleMyPokemon, getBattleOpponentPokemon, listBattleNotes,
  listBattles, saveManualBattle, saveParsedBattle, searchScoutedSets, updateOpponentMon,
  type ManualOpponentMon,
} from "./db/battleQueries";
import {
  getAbilitiesFor, getAbilityUsageFor, getAllItems, getAvailableMovesFor, getFormats,
  getItemUsageFor, getMoveUsageFor, listPokemon, parseFormatRuleset,
  type FormatRow, type ItemRow,
} from "./db/queries";
import { getTeamMembers, listTeams } from "./db/teamQueries";
import {
  addChecklistItem, deleteChecklistItem, listChecklistItems, setChecklistItemDone,
  type ChecklistItem,
} from "./db/checklistQueries";
import { normalizeKey } from "./showdownFormat";
import { ConfirmModal, ItemIcon, PickerModal, TypeBadge } from "./TeamBuilder";
import { REAL_TYPES } from "./constants/gameData";
import type { Team } from "./types/team";
import {
  NOTE_TAGS,
  type Battle, type BattleListEntry, type BattleNote, type BattlePokemonDisplay, type ScoutedSetEntry,
} from "./types/battle";
import type { AbilityRef, LearnsetMove, PokemonRow } from "./types/pokedex";
import "./App.css";

type BattleLogView = "list" | "detail" | "scout";

/** Open Team Sheets data comes through Showdown's packed-team format with no spaces (e.g. "RaichuniteY", "FakeOut") — display-only cleanup. */
function humanize(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** Renders a side's full 6-mon preview: sprite, item icon, types, dimmed for benched, tinted green/red for mine/theirs. */
function TeamPreviewGrid({
  species, revealed, brought, pokemonBySpecies, itemsByName, side,
}: {
  species: string[];
  revealed: { species: string; item: string | null; ability: string | null }[];
  brought: string[];
  pokemonBySpecies: Map<string, PokemonRow>;
  itemsByName: Map<string, ItemRow>;
  side: "mine" | "theirs";
}) {
  const broughtSet = new Set(brought);
  const revealedBySpecies = new Map(revealed.map((m) => [m.species, m]));

  return (
    <div className="battle-preview-grid">
      {species.map((sp) => {
        const mon = pokemonBySpecies.get(normalizeKey(sp));
        const rev = revealedBySpecies.get(sp);
        const item = rev?.item ? itemsByName.get(normalizeKey(rev.item)) : undefined;
        const isBrought = broughtSet.has(sp);
        return (
          <div key={sp} className={`battle-preview-card ${side} ${isBrought ? "brought" : "benched"}`}>
            {mon?.sprite_default
              ? <img src={mon.sprite_default} alt={sp} className="battle-preview-sprite" />
              : <div className="battle-preview-sprite battle-preview-sprite-empty" />}
            <span className="battle-preview-name">{humanize(sp)}</span>
            {mon && (
              <div className="battle-preview-types">
                <TypeBadge type={mon.type1} />
                {mon.type2 && <TypeBadge type={mon.type2} />}
              </div>
            )}
            {rev?.item && (
              <div className="battle-preview-item">
                <ItemIcon x={item?.sprite_x ?? null} y={item?.sprite_y ?? null} />
                <span>{humanize(rev.item)}</span>
              </div>
            )}
            {rev?.ability && <span className="battle-preview-ability">{humanize(rev.ability)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function BattleLog({
  db, initialBattleId, initialNonce,
}: { db: Database; initialBattleId?: number | null; initialNonce?: number | null }) {
  const [view, setView] = useState<BattleLogView>("list");
  const [selectedBattleId, setSelectedBattleId] = useState<number | null>(null);
  const [battles, setBattles] = useState<BattleListEntry[]>([]);
  const [loggingReplay, setLoggingReplay] = useState(false);
  const [loggingManual, setLoggingManual] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>("");
  const [checklistEvent, setChecklistEvent] = useState<string | null>(null);

  useEffect(() => {
    if (initialBattleId != null) { setSelectedBattleId(initialBattleId); setView("detail"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNonce]);

  async function reloadBattles() {
    setBattles(await listBattles(db));
  }

  useEffect(() => {
    reloadBattles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  function openBattle(id: number) {
    setSelectedBattleId(id);
    setView("detail");
  }

  const events = useMemo(
    () => Array.from(new Set(battles.map((b) => b.event_name).filter((e): e is string => !!e))).sort(),
    [battles],
  );
  const visibleBattles = eventFilter ? battles.filter((b) => b.event_name === eventFilter) : battles;

  return (
    <div className="battle-log-page">
      {view === "list" && (
        <>
          <div className="battle-log-toolbar">
            <h2>Battle Log</h2>
            <div className="battle-log-toolbar-actions">
              <button className="ghost-btn" onClick={() => setView("scout")}>Scouting Book</button>
              <button className="ghost-btn" onClick={() => setLoggingManual(true)}>+ Log Manually</button>
              <button onClick={() => setLoggingReplay(true)}>+ Log a Replay</button>
            </div>
          </div>
          {events.length > 0 && (
            <div className="battle-log-event-filter">
              <label>
                Event
                <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
                  <option value="">All battles</option>
                  {events.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
              {eventFilter && (
                <button className="ghost-btn" onClick={() => setChecklistEvent(eventFilter)}>
                  Prep Checklist
                </button>
              )}
            </div>
          )}
          {battles.length === 0 ? (
            <p className="battle-log-empty">No battles logged yet. Paste a Showdown replay link, or log one manually, to get started.</p>
          ) : (
            <ul className="battle-list">
              {visibleBattles.map((b) => (
                <li key={b.id} className="battle-list-item" onClick={() => openBattle(b.id)}>
                  <span className={`battle-result-badge result-${b.result ?? "unknown"}`}>
                    {b.result === "win" ? "W" : b.result === "loss" ? "L" : b.result === "tie" ? "T" : "?"}
                  </span>
                  <div className="battle-list-main">
                    <span className="battle-list-opponent">vs {b.opponent_name ?? "Unknown"}</span>
                    <span className="battle-list-meta">
                      {b.format_label ?? "Unknown format"}
                      {b.my_team_name ? ` · ${b.my_team_name}` : ""}
                      {b.event_name ? ` · ${b.event_name}` : ""}
                    </span>
                  </div>
                  <span className="battle-list-date">
                    {b.battle_date ? new Date(b.battle_date).toLocaleDateString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === "detail" && selectedBattleId != null && (
        <BattleDetailView
          db={db}
          battleId={selectedBattleId}
          onBack={() => { setView("list"); reloadBattles(); }}
          onDeleted={() => { setView("list"); setSelectedBattleId(null); reloadBattles(); }}
        />
      )}

      {view === "scout" && <ScoutingBookView db={db} onBack={() => setView("list")} />}

      {loggingReplay && (
        <LogReplayModal
          db={db}
          onClose={() => setLoggingReplay(false)}
          onSaved={(battleId) => { setLoggingReplay(false); reloadBattles(); openBattle(battleId); }}
        />
      )}

      {loggingManual && (
        <ManualBattleModal
          db={db}
          onClose={() => setLoggingManual(false)}
          onSaved={(battleId) => { setLoggingManual(false); reloadBattles(); openBattle(battleId); }}
        />
      )}

      {checklistEvent && (
        <EventChecklistModal db={db} eventName={checklistEvent} onClose={() => setChecklistEvent(null)} />
      )}
    </div>
  );
}

function EventChecklistModal({
  db, eventName, onClose,
}: { db: Database; eventName: string; onClose: () => void }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);

  async function reload() {
    setItems(await listChecklistItems(db, eventName));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, eventName]);

  async function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    try {
      await addChecklistItem(db, eventName, text);
      setNewText("");
      await reload();
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(item: ChecklistItem) {
    await setChecklistItemDone(db, item.id, !item.done);
    await reload();
  }

  async function handleDelete(item: ChecklistItem) {
    await deleteChecklistItem(db, item.id);
    await reload();
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal checklist-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Prep Checklist — {eventName}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="checklist-modal-body">
          <p className="settings-hint">
            {items.length === 0 ? "Nothing on the list yet." : `${doneCount}/${items.length} done`}
          </p>
          <ul className="checklist-items">
            {items.map((item) => (
              <li key={item.id} className={`checklist-item ${item.done ? "done" : ""}`}>
                <label>
                  <input type="checkbox" checked={!!item.done} onChange={() => handleToggle(item)} />
                  <span>{item.text}</span>
                </label>
                <button className="checklist-item-delete" onClick={() => handleDelete(item)} aria-label="Delete item">×</button>
              </li>
            ))}
          </ul>
          <div className="checklist-add-row">
            <input
              type="text"
              placeholder="e.g. Confirm team is legal"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
            <button onClick={handleAdd} disabled={adding || !newText.trim()}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogReplayModal({
  db, onClose, onSaved,
}: { db: Database; onClose: () => void; onSaved: (battleId: number) => void }) {
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawLog, setRawLog] = useState<string | null>(null);
  const [replayUrl, setReplayUrl] = useState("");
  const [uploadtime, setUploadtime] = useState<number | null>(null);
  const [formatIdGuess, setFormatIdGuess] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBattle | null>(null);
  const [ourSide, setOurSide] = useState<Side>("p1");
  const [teamId, setTeamId] = useState<number | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [alreadyLogged, setAlreadyLogged] = useState(false);
  const [eventName, setEventName] = useState("");

  const [importMode, setImportMode] = useState<"url" | "file">("url");
  const [pokemonBySpecies, setPokemonBySpecies] = useState<Map<string, PokemonRow>>(new Map());
  const [itemsByName, setItemsByName] = useState<Map<string, ItemRow>>(new Map());

  useEffect(() => {
    listTeams(db).then(setTeams);
    getFormats(db).then(setFormats);
    listPokemon(db).then((rows) => {
      const map = new Map<string, PokemonRow>();
      for (const p of rows) {
        if (!map.has(normalizeKey(p.display_name))) map.set(normalizeKey(p.display_name), p);
        if (p.showdown_name) map.set(normalizeKey(p.showdown_name), p);
      }
      setPokemonBySpecies(map);
    });
    getAllItems(db).then((rows) => setItemsByName(new Map(rows.map((i) => [normalizeKey(i.display_name), i]))));
  }, [db]);

  async function processReplay(replay: ReplayJson) {
    const parsedBattle = parseBattleLog(replay.log, replay.format);
    const fullUrl = `https://replay.pokemonshowdown.com/${replay.id}`;

    const existing = await db.select<{ id: number }[]>("SELECT id FROM battles WHERE replay_url = ?", [fullUrl]);
    setAlreadyLogged(existing.length > 0);

    setParsed(parsedBattle);
    setRawLog(replay.log);
    setReplayUrl(fullUrl);
    setUploadtime(replay.uploadtime ?? null);
    setFormatIdGuess(replay.formatid ?? null);

    // Auto-detect which side is ours by roster overlap against saved teams.
    const rosters = await Promise.all(teams.map((t) => getTeamMembers(db, t.id)));
    let best = { teamIdx: -1, side: "p1" as Side, overlap: 0 };
    (["p1", "p2"] as Side[]).forEach((side) => {
      const revealedKeys = new Set(parsedBattle.revealed[side].map((m) => normalizeKey(m.species)));
      rosters.forEach((roster, i) => {
        const overlap = roster.filter((m) => revealedKeys.has(normalizeKey(m.pokemon_showdown_name || m.pokemon_name))).length;
        if (overlap > best.overlap) best = { teamIdx: i, side, overlap };
      });
    });
    if (best.overlap >= 2) {
      setOurSide(best.side);
      setTeamId(teams[best.teamIdx].id);
    } else {
      setOurSide("p1");
      setTeamId(null);
    }
  }

  async function handleFetch() {
    const replayId = parseReplayId(urlInput);
    if (!replayId) { setError("Paste a valid replay.pokemonshowdown.com link."); return; }
    setLoading(true);
    setError(null);
    setAlreadyLogged(false);
    try {
      await processReplay(await fetchReplay(replayId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setAlreadyLogged(false);
    try {
      const html = await file.text();
      await processReplay(parseReplayHtml(html));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!parsed || !rawLog) return;
    setSaving(true);
    try {
      let result: "win" | "loss" | "tie" | null = null;
      if (parsed.winner) {
        result = parsed.winner === parsed.players[ourSide] ? "win" : "loss";
      } else if (parsed.turns.some((t) => t.events.some((e) => e.type === "tie"))) {
        result = "tie";
      }
      const matchedFormat = formatIdGuess
        ? formats.find((f) => f.code.toLowerCase() === formatIdGuess.toLowerCase()) ?? null
        : null;
      const res = await saveParsedBattle(db, {
        parsed, rawLog, replayUrl, uploadtimeSec: uploadtime,
        ourSide, teamId, formatId: matchedFormat?.id ?? null, result,
        eventName: eventName.trim() || null,
      });
      onSaved(res.battleId);
    } finally {
      setSaving(false);
    }
  }

  const opponentSide: Side = ourSide === "p1" ? "p2" : "p1";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal battle-log-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Log a Replay</h3>
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
        </div>
        <div className="battle-log-modal-body">
          <div className="battle-log-import-tabs">
            <button type="button" className={importMode === "url" ? "active" : ""} onClick={() => setImportMode("url")}>
              Paste a link
            </button>
            <button type="button" className={importMode === "file" ? "active" : ""} onClick={() => setImportMode("file")}>
              Upload downloaded HTML
            </button>
          </div>

          {importMode === "url" ? (
            <>
              <label>
                Replay link
                <input
                  type="text"
                  placeholder="https://replay.pokemonshowdown.com/gen9vgc2024regh-..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                />
              </label>
              <button onClick={handleFetch} disabled={loading || !urlInput.trim()}>
                {loading ? "Fetching..." : "Fetch Replay"}
              </button>
            </>
          ) : (
            <label>
              Replay HTML file
              <input
                type="file"
                accept=".html,.htm"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <span className="settings-hint">
                From Showdown's "Download replay" button — works offline, and for replays Showdown has since deleted.
              </span>
            </label>
          )}
          {loading && importMode === "file" && <p className="settings-hint">Reading file...</p>}
          {error && <p className="error">{error}</p>}
          {alreadyLogged && <p className="settings-hint">You've already logged this replay — saving will just reopen it.</p>}

          {parsed && (
            <div className="battle-log-preview">
              <p className="settings-hint">{parsed.formatLabel} · {parsed.turns.length} turns</p>

              <div className="battle-log-side-picker">
                <span>Which side is yours?</span>
                <div className="battle-log-side-toggle">
                  {(["p1", "p2"] as Side[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={ourSide === side ? "active" : ""}
                      onClick={() => setOurSide(side)}
                    >
                      {parsed.players[side] || side.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="battle-log-form-row">
                <label>
                  Link to a saved team (optional)
                  <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">None</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label>
                  Event / tournament (optional)
                  <input
                    type="text"
                    placeholder="e.g. Regionals Day 1"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                  />
                </label>
              </div>

              <div className="battle-log-preview-teams">
                <div>
                  <h4>Your team</h4>
                  <TeamPreviewGrid
                    species={parsed.previewTeam[ourSide]}
                    revealed={parsed.revealed[ourSide]}
                    brought={parsed.brought[ourSide]}
                    pokemonBySpecies={pokemonBySpecies}
                    itemsByName={itemsByName}
                    side="mine"
                  />
                </div>
                <div>
                  <h4>vs {parsed.players[opponentSide] || "opponent"}</h4>
                  <TeamPreviewGrid
                    species={parsed.previewTeam[opponentSide]}
                    revealed={parsed.revealed[opponentSide]}
                    brought={parsed.brought[opponentSide]}
                    pokemonBySpecies={pokemonBySpecies}
                    itemsByName={itemsByName}
                    side="theirs"
                  />
                </div>
              </div>
              <p className="settings-hint">Full color = sent out during the battle · dimmed = previewed but never used.</p>

              <button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : alreadyLogged ? "Open Existing Log" : "Save Battle"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface OpponentMonState {
  pokemon: PokemonRow | null;
  item: ItemRow | null;
  abilities: AbilityRef[];
  abilityId: number | null;
  moves: LearnsetMove[];
  moveIds: (number | null)[];
  teraType: string | null;
}

type ManualPickerTarget = { index: number; field: "species" | "item" | 0 | 1 | 2 | 3 };

function OpponentMonRow({
  mon, teraAllowed, onPickItem, onPickMove, onSetAbility, onSetTera, onClearItem, onClearMove, onRemove,
}: {
  mon: OpponentMonState;
  teraAllowed: boolean;
  onPickItem: () => void;
  onPickMove: (slot: 0 | 1 | 2 | 3) => void;
  onSetAbility: (id: number | null) => void;
  onSetTera: (t: string | null) => void;
  onClearItem: () => void;
  onClearMove: (slot: 0 | 1 | 2 | 3) => void;
  onRemove: () => void;
}) {
  return (
    <div className="manual-mon-card">
      <div className="manual-mon-card-header">
        {mon.pokemon!.sprite_default && <img src={mon.pokemon!.sprite_default} alt="" className="battle-roster-sprite" />}
        <span className="battle-roster-name">{mon.pokemon!.display_name}</span>
        <button type="button" className="clear-btn manual-mon-remove" onClick={onRemove}>×</button>
      </div>

      <div className="manual-mon-field">
        <button type="button" className="ghost-btn item-select-btn" onClick={onPickItem}>
          {mon.item
            ? <><ItemIcon x={mon.item.sprite_x} y={mon.item.sprite_y} className="dropdown-icon" /> {mon.item.display_name}</>
            : "Item..."}
        </button>
        {mon.item && <button type="button" className="clear-btn" onClick={onClearItem}>×</button>}
      </div>

      <select value={mon.abilityId ?? ""} onChange={(e) => onSetAbility(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Ability...</option>
        {mon.abilities.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
      </select>

      {teraAllowed && (
        <select value={mon.teraType ?? ""} onChange={(e) => onSetTera(e.target.value || null)}>
          <option value="">Tera type...</option>
          {REAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}

      <div className="manual-mon-moves">
        {([0, 1, 2, 3] as const).map((slot) => {
          const moveId = mon.moveIds[slot];
          const move = moveId ? mon.moves.find((m) => m.id === moveId) : null;
          return (
            <div key={slot} className="manual-mon-field">
              <button type="button" className="ghost-btn" onClick={() => onPickMove(slot)}>
                {move ? move.display_name : `Move ${slot + 1}...`}
              </button>
              {move && <button type="button" className="clear-btn" onClick={() => onClearMove(slot)}>×</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManualBattleModal({
  db, onClose, onSaved,
}: { db: Database; onClose: () => void; onSaved: (battleId: number) => void }) {
  const [opponentName, setOpponentName] = useState("");
  const [eventName, setEventName] = useState("");
  const [battleDate, setBattleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<"win" | "loss" | "tie">("win");
  const [formatId, setFormatId] = useState<number | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonRow[]>([]);
  const [allItems, setAllItems] = useState<ItemRow[]>([]);
  const [mons, setMons] = useState<(OpponentMonState | null)[]>(Array(6).fill(null));
  const [picker, setPicker] = useState<ManualPickerTarget | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTeams(db).then(setTeams);
    getFormats(db).then(setFormats);
    listPokemon(db).then(setAllPokemon);
    getAllItems(db).then(setAllItems);
  }, [db]);

  function updateMon(index: number, patch: Partial<OpponentMonState>) {
    setMons((prev) => prev.map((m, i) => (i === index && m ? { ...m, ...patch } : m)));
  }

  function clearMon(index: number) {
    setMons((prev) => prev.map((m, i) => (i === index ? null : m)));
  }

  async function pickSpecies(index: number, p: PokemonRow) {
    const [abilities, moves] = await Promise.all([getAbilitiesFor(db, p.id), getAvailableMovesFor(db, p)]);

    // Pre-fill with the most-used real build for this format, so logging a
    // battle is "fix what was different" instead of typing a whole set from
    // scratch -- most opponents run something close to the common build.
    let item: ItemRow | null = null;
    let abilityId: number | null = null;
    let moveIds: (number | null)[] = [null, null, null, null];

    if (formatId) {
      const [itemUsage, abilityUsage, moveUsage] = await Promise.all([
        getItemUsageFor(db, formatId, p.id),
        getAbilityUsageFor(db, formatId, p.id),
        getMoveUsageFor(db, formatId, p.id),
      ]);

      const topItem = [...itemUsage].sort((a, b) => b.usage_pct - a.usage_pct)[0];
      if (topItem) item = allItems.find((it) => it.id === topItem.item_id) ?? null;

      const topAbility = [...abilityUsage].sort((a, b) => b.usage_pct - a.usage_pct)[0];
      if (topAbility && abilities.some((a) => a.id === topAbility.ability_id)) abilityId = topAbility.ability_id;

      const topMoves = [...moveUsage]
        .sort((a, b) => b.usage_pct - a.usage_pct)
        .filter((mv) => moves.some((m) => m.id === mv.move_id))
        .slice(0, 4)
        .map((mv) => mv.move_id);
      moveIds = [topMoves[0] ?? null, topMoves[1] ?? null, topMoves[2] ?? null, topMoves[3] ?? null];
    }

    setMons((prev) => prev.map((m, i) => (i === index ? { pokemon: p, abilities, abilityId, moves, item, moveIds, teraType: null } : m)));
    setPicker(null);
  }

  async function handleSave() {
    if (!opponentName.trim()) return;
    setSaving(true);
    try {
      const opponentMons: ManualOpponentMon[] = mons
        .filter((m): m is OpponentMonState & { pokemon: PokemonRow } => m !== null && m.pokemon !== null)
        .map((m) => ({
          pokemonId: m.pokemon.id,
          itemId: m.item?.id ?? null,
          abilityId: m.abilityId,
          teraType: m.teraType,
          moveIds: m.moveIds,
        }));
      const battleId = await saveManualBattle(db, {
        formatId, teamId, opponentName: opponentName.trim(), eventName: eventName.trim() || null,
        result, battleDate: battleDate ? new Date(battleDate).toISOString() : null, opponentMons,
      });
      onSaved(battleId);
    } finally {
      setSaving(false);
    }
  }

  const pickerOptions = useMemo((): (PokemonRow | ItemRow | LearnsetMove)[] => {
    if (!picker) return [];
    const q = normalizeKey(pickerQuery);
    if (picker.field === "species") {
      return allPokemon.filter((p) => !q || normalizeKey(p.display_name).includes(q)).slice(0, 40);
    }
    if (picker.field === "item") {
      return allItems.filter((it) => !q || normalizeKey(it.display_name).includes(q)).slice(0, 40);
    }
    return (mons[picker.index]?.moves ?? []).filter((mv) => !q || normalizeKey(mv.display_name).includes(q));
  }, [picker, pickerQuery, allPokemon, allItems, mons]);

  const teraAllowed = formatId
    ? parseFormatRuleset(formats.find((f) => f.id === formatId)?.ruleset ?? null).tera_allowed !== false
    : true;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal battle-log-modal manual-battle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Log a Battle Manually</h3>
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
        </div>
        <div className="battle-log-modal-body">
          <div className="battle-log-form-row">
            <label>
              Opponent name
              <input value={opponentName} onChange={(e) => setOpponentName(e.target.value)} placeholder="Opponent's name" />
            </label>
            <label>
              Date
              <input type="date" value={battleDate} onChange={(e) => setBattleDate(e.target.value)} />
            </label>
          </div>
          <div className="battle-log-form-row">
            <label>
              Format (optional)
              <select value={formatId ?? ""} onChange={(e) => setFormatId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>
              My team (optional)
              <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          <div className="battle-log-form-row">
            <label>
              Event / tournament (optional)
              <input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Regionals Day 1" />
            </label>
            <label>
              Result
              <div className="battle-log-side-toggle">
                {(["win", "loss", "tie"] as const).map((r) => (
                  <button key={r} type="button" className={result === r ? "active" : ""} onClick={() => setResult(r)}>
                    {r === "win" ? "Win" : r === "loss" ? "Loss" : "Tie"}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <p className="settings-hint">
            Your side comes from the linked team automatically.
            {formatId
              ? " Picking an opponent species pre-fills its most common item/ability/moves for this format — just tweak whatever was actually different."
              : " Pick a format above to also auto-fill each opponent's most common build."}
          </p>
          <div className="manual-mon-grid">
            {mons.map((mon, i) => (
              mon === null ? (
                <button
                  key={i}
                  type="button"
                  className="manual-mon-slot-empty"
                  onClick={() => { setPickerQuery(""); setPicker({ index: i, field: "species" }); }}
                >
                  +
                </button>
              ) : (
                <OpponentMonRow
                  key={i}
                  mon={mon}
                  teraAllowed={teraAllowed}
                  onPickItem={() => { setPickerQuery(""); setPicker({ index: i, field: "item" }); }}
                  onPickMove={(slot) => { setPickerQuery(""); setPicker({ index: i, field: slot }); }}
                  onSetAbility={(id) => updateMon(i, { abilityId: id })}
                  onSetTera={(t) => updateMon(i, { teraType: t })}
                  onClearItem={() => updateMon(i, { item: null })}
                  onClearMove={(slot) => updateMon(i, { moveIds: mon.moveIds.map((m, s) => (s === slot ? null : m)) })}
                  onRemove={() => clearMon(i)}
                />
              )
            ))}
          </div>

          <button onClick={handleSave} disabled={saving || !opponentName.trim()}>
            {saving ? "Saving..." : "Save Battle"}
          </button>
        </div>

        {picker && picker.field === "species" && (
          <PickerModal
            title="Choose species"
            options={pickerOptions as PokemonRow[]}
            query={pickerQuery}
            onQueryChange={setPickerQuery}
            onPick={(p) => pickSpecies(picker.index, p)}
            onClose={() => setPicker(null)}
            renderIcon={(p) => (p.sprite_default ? <img src={p.sprite_default} className="dropdown-icon" alt="" /> : null)}
          />
        )}
        {picker && picker.field === "item" && (
          <PickerModal
            title="Choose an item"
            options={pickerOptions as ItemRow[]}
            query={pickerQuery}
            onQueryChange={setPickerQuery}
            onPick={(it) => { updateMon(picker.index, { item: it }); setPicker(null); }}
            onClose={() => setPicker(null)}
            renderIcon={(it) => <ItemIcon x={it.sprite_x} y={it.sprite_y} className="dropdown-icon" />}
            renderDescription={(it) => it.short_effect}
          />
        )}
        {picker && typeof picker.field === "number" && (
          <PickerModal
            title="Choose a move"
            options={pickerOptions as LearnsetMove[]}
            query={pickerQuery}
            onQueryChange={setPickerQuery}
            onPick={(mv) => {
              const slot = picker.field as 0 | 1 | 2 | 3;
              const current = mons[picker.index];
              if (!current) return;
              updateMon(picker.index, {
                moveIds: current.moveIds.map((m, s) => (s === slot ? mv.id : m)),
              });
              setPicker(null);
            }}
            onClose={() => setPicker(null)}
            renderBadge={(mv) => <TypeBadge type={mv.type} />}
            renderDescription={(mv) => mv.short_effect}
          />
        )}
      </div>
    </div>
  );
}

function NoteChip({ note }: { note: BattleNote }) {
  return (
    <div className="battle-note-chip">
      {note.tag && <span className="battle-note-tag">{note.tag}</span>}
      <span>{note.body}</span>
    </div>
  );
}

function AddNoteInline({
  onAdd, compact,
}: { onAdd: (tag: string | null, body: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [body, setBody] = useState("");

  if (!open) {
    return <button className="ghost-btn battle-add-note-btn" onClick={() => setOpen(true)}>+ Add note</button>;
  }

  function handleAdd() {
    if (!body.trim()) return;
    onAdd(tag, body.trim());
    setBody("");
    setTag(null);
    setOpen(false);
  }

  return (
    <div className={`battle-add-note-form ${compact ? "compact" : ""}`}>
      <div className="battle-note-tag-picker">
        {NOTE_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={tag === t ? "active" : ""}
            onClick={() => setTag(tag === t ? null : t)}
          >
            {t}
          </button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened here?" />
      <div className="battle-add-note-actions">
        <button className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
        <button onClick={handleAdd} disabled={!body.trim()}>Save note</button>
      </div>
    </div>
  );
}

type OppPickerTarget = { rowId: number | "new"; field: "species" | "item" | 0 | 1 | 2 | 3 };

/**
 * The opponent's scouted roster, editable in place: every field (and every
 * empty move/item slot) is a button you click straight into a picker, plus
 * up to 6 add-slots for species you remember seeing but hadn't logged yet.
 * "My" side stays a read-only snapshot (see the note above it) -- only the
 * opponent's best-effort scouting record makes sense to correct later.
 */
function EditableOpponentRoster({
  db, battleId, rows, teraAllowed, onChanged,
}: { db: Database; battleId: number; rows: BattlePokemonDisplay[]; teraAllowed: boolean; onChanged: () => void }) {
  const [allPokemon, setAllPokemon] = useState<PokemonRow[]>([]);
  const [allItems, setAllItems] = useState<ItemRow[]>([]);
  const [abilitiesByPokemon, setAbilitiesByPokemon] = useState<Map<number, AbilityRef[]>>(new Map());
  const [movesByPokemon, setMovesByPokemon] = useState<Map<number, LearnsetMove[]>>(new Map());
  const [picker, setPicker] = useState<OppPickerTarget | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    listPokemon(db).then(setAllPokemon);
    getAllItems(db).then(setAllItems);
  }, [db]);

  useEffect(() => {
    if (allPokemon.length === 0) return;
    const missing = rows.filter((r) => !abilitiesByPokemon.has(r.pokemon_id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const abilitiesMap = new Map(abilitiesByPokemon);
      const movesMap = new Map(movesByPokemon);
      for (const r of missing) {
        const full = allPokemon.find((p) => p.id === r.pokemon_id);
        if (!full) continue;
        const [ab, mv] = await Promise.all([getAbilitiesFor(db, r.pokemon_id), getAvailableMovesFor(db, full)]);
        abilitiesMap.set(r.pokemon_id, ab);
        movesMap.set(r.pokemon_id, mv);
      }
      if (!cancelled) { setAbilitiesByPokemon(abilitiesMap); setMovesByPokemon(movesMap); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allPokemon]);

  async function handleUpdate(rowId: number, patch: Parameters<typeof updateOpponentMon>[2]) {
    await updateOpponentMon(db, rowId, patch);
    onChanged();
  }

  async function handleAddSpecies(p: PokemonRow) {
    setPicker(null);
    await addOpponentMon(db, battleId, p.id);
    onChanged();
  }

  const pickerOptions = useMemo((): (PokemonRow | ItemRow | LearnsetMove)[] => {
    if (!picker) return [];
    const q = normalizeKey(pickerQuery);
    if (picker.field === "species") {
      return allPokemon.filter((p) => !q || normalizeKey(p.display_name).includes(q)).slice(0, 40);
    }
    if (picker.field === "item") {
      return allItems.filter((it) => !q || normalizeKey(it.display_name).includes(q)).slice(0, 40);
    }
    const row = rows.find((r) => r.id === picker.rowId);
    return (row ? movesByPokemon.get(row.pokemon_id) ?? [] : []).filter((mv) => !q || normalizeKey(mv.display_name).includes(q));
  }, [picker, pickerQuery, allPokemon, allItems, rows, movesByPokemon]);

  const emptySlots = Math.max(0, 6 - rows.length);

  return (
    <div className="manual-mon-grid">
      {rows.map((r) => {
        const abilities = abilitiesByPokemon.get(r.pokemon_id) ?? [];
        const moveIds = [r.move1_id, r.move2_id, r.move3_id, r.move4_id];
        const moveNames = [r.move1_name, r.move2_name, r.move3_name, r.move4_name];
        return (
          <div key={r.id} className="manual-mon-card">
            <div className="manual-mon-card-header">
              {r.pokemon_sprite && <img src={r.pokemon_sprite} alt="" className="battle-roster-sprite" />}
              <span className="battle-roster-name">{r.pokemon_name}</span>
            </div>

            <div className="manual-mon-field">
              <button
                type="button" className="ghost-btn item-select-btn"
                onClick={() => { setPickerQuery(""); setPicker({ rowId: r.id, field: "item" }); }}
              >
                {r.item_name
                  ? <><ItemIcon x={r.item_sprite_x} y={r.item_sprite_y} className="dropdown-icon" /> {r.item_name}</>
                  : "Item..."}
              </button>
              {r.item_id != null && <button type="button" className="clear-btn" onClick={() => handleUpdate(r.id, { itemId: null })}>×</button>}
            </div>

            <select
              value={r.ability_id ?? ""}
              onChange={(e) => handleUpdate(r.id, { abilityId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Ability...</option>
              {abilities.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>

            {teraAllowed && (
              <select
                value={r.tera_type ?? ""}
                onChange={(e) => handleUpdate(r.id, { teraType: e.target.value || null })}
              >
                <option value="">Tera type...</option>
                {REAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            <div className="manual-mon-moves">
              {([0, 1, 2, 3] as const).map((slot) => (
                <div key={slot} className="manual-mon-field">
                  <button
                    type="button" className="ghost-btn"
                    onClick={() => { setPickerQuery(""); setPicker({ rowId: r.id, field: slot }); }}
                  >
                    {moveNames[slot] ?? `Move ${slot + 1}...`}
                  </button>
                  {moveIds[slot] != null && (
                    <button
                      type="button" className="clear-btn"
                      onClick={() => { const next = [...moveIds]; next[slot] = null; handleUpdate(r.id, { moveIds: next }); }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {Array.from({ length: emptySlots }).map((_, i) => (
        <button
          key={`empty-${i}`} type="button" className="manual-mon-slot-empty"
          onClick={() => { setPickerQuery(""); setPicker({ rowId: "new", field: "species" }); }}
        >
          +
        </button>
      ))}

      {picker && picker.field === "species" && (
        <PickerModal
          title="Choose species"
          options={pickerOptions as PokemonRow[]}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onPick={handleAddSpecies}
          onClose={() => setPicker(null)}
          renderIcon={(p) => (p.sprite_default ? <img src={p.sprite_default} className="dropdown-icon" alt="" /> : null)}
        />
      )}
      {picker && picker.field === "item" && picker.rowId !== "new" && (
        <PickerModal
          title="Choose an item"
          options={pickerOptions as ItemRow[]}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onPick={(it) => { handleUpdate(picker.rowId as number, { itemId: it.id }); setPicker(null); }}
          onClose={() => setPicker(null)}
          renderIcon={(it) => <ItemIcon x={it.sprite_x} y={it.sprite_y} className="dropdown-icon" />}
          renderDescription={(it) => it.short_effect}
        />
      )}
      {picker && typeof picker.field === "number" && picker.rowId !== "new" && (
        <PickerModal
          title="Choose a move"
          options={pickerOptions as LearnsetMove[]}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onPick={(mv) => {
            const row = rows.find((r) => r.id === picker.rowId);
            if (!row) return;
            const next = [row.move1_id, row.move2_id, row.move3_id, row.move4_id];
            next[picker.field as number] = mv.id;
            handleUpdate(picker.rowId as number, { moveIds: next });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
          renderBadge={(mv) => <TypeBadge type={mv.type} />}
          renderDescription={(mv) => mv.short_effect}
        />
      )}
    </div>
  );
}

function BattleDetailView({
  db, battleId, onBack, onDeleted,
}: { db: Database; battleId: number; onBack: () => void; onDeleted: () => void }) {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [myPokemon, setMyPokemon] = useState<BattlePokemonDisplay[]>([]);
  const [oppPokemon, setOppPokemon] = useState<BattlePokemonDisplay[]>([]);
  const [notes, setNotes] = useState<BattleNote[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function reload() {
    const b = await getBattle(db, battleId);
    setBattle(b ?? null);
    setMyPokemon(await getBattleMyPokemon(db, battleId));
    setOppPokemon(await getBattleOpponentPokemon(db, battleId));
    setNotes(await listBattleNotes(db, battleId));
  }

  useEffect(() => {
    reload();
    getFormats(db).then(setFormats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, battleId]);

  const teraAllowed = battle?.format_id
    ? parseFormatRuleset(formats.find((f) => f.id === battle.format_id)?.ruleset ?? null).tera_allowed !== false
    : true;

  const parsed = useMemo(
    () => (battle?.raw_log ? parseBattleLog(battle.raw_log, battle.format_label ?? "") : null),
    [battle],
  );

  const ourSide: Side | null = useMemo(() => {
    if (!parsed || !battle) return null;
    return parsed.players.p1 === battle.opponent_name ? "p2" : "p1";
  }, [parsed, battle]);

  const notesByTurn = useMemo(() => {
    const map = new Map<number | "general", BattleNote[]>();
    for (const n of notes) {
      const key = n.turn_number ?? "general";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return map;
  }, [notes]);

  async function handleDelete() {
    await deleteBattle(db, battleId);
    onDeleted();
  }

  if (!battle) return <p>Loading...</p>;

  const revealed = (list: BattlePokemonDisplay[]) => (
    <ul className="battle-roster-list">
      {list.map((m) => (
        <li key={m.id}>
          {m.pokemon_sprite
            ? <img src={m.pokemon_sprite} alt={m.pokemon_name} className="battle-roster-sprite" />
            : <div className="battle-roster-sprite battle-preview-sprite-empty" />}
          <div className="battle-roster-info">
            <div className="battle-roster-name-row">
              <span className="battle-roster-name">{m.pokemon_name}</span>
              <TypeBadge type={m.type1} />
              {m.type2 && <TypeBadge type={m.type2} />}
            </div>
            <div className="battle-roster-tags">
              {m.item_name && (
                <span className="battle-roster-detail">
                  <ItemIcon x={m.item_sprite_x} y={m.item_sprite_y} /> {m.item_name}
                </span>
              )}
              {m.ability_name && <span className="battle-roster-detail">{m.ability_name}</span>}
              {m.tera_type && <span className="battle-roster-detail">Tera {m.tera_type}</span>}
              {[m.move1_name, m.move2_name, m.move3_name, m.move4_name].filter(Boolean).map((mv) => (
                <span key={mv} className="battle-roster-detail">{mv}</span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="battle-detail">
      <button className="ghost-btn" onClick={onBack}>← Back</button>
      <div className="battle-detail-header">
        <h2>vs {battle.opponent_name ?? "Unknown"}</h2>
        <span className={`battle-result-badge result-${battle.result ?? "unknown"}`}>
          {battle.result === "win" ? "Win" : battle.result === "loss" ? "Loss" : battle.result === "tie" ? "Tie" : "Unknown"}
        </span>
        <button className="danger-btn" onClick={() => setConfirmingDelete(true)}>Delete</button>
      </div>
      <p className="settings-hint">
        {battle.format_label}
        {battle.battle_date ? ` · ${new Date(battle.battle_date).toLocaleString()}` : ""}
        {battle.replay_url && (
          <> · <a href={battle.replay_url} target="_blank" rel="noreferrer">View on Showdown</a></>
        )}
      </p>

      <div className="battle-detail-section">
        <h4>Your team</h4>
        <p className="settings-hint">Locked in as of this battle — later edits to the team won't change this.</p>
        {revealed(myPokemon)}
      </div>

      <div className="battle-opponent-roster-section">
        <h4>Opponent's team (scouted)</h4>
        <p className="settings-hint">Click any item, ability, tera type, or move — including empty slots — to fill in or correct it.</p>
        <EditableOpponentRoster db={db} battleId={battleId} rows={oppPokemon} teraAllowed={teraAllowed} onChanged={reload} />
      </div>

      <div className="battle-detail-notes-general">
        <h4>Notes</h4>
        {(notesByTurn.get("general") ?? []).map((n) => <NoteChip key={n.id} note={n} />)}
        <AddNoteInline onAdd={async (tag, body) => { await addBattleNote(db, battleId, null, tag, body); reload(); }} />
      </div>

      {parsed && (
        <div className="battle-timeline">
          <h4>Turn-by-turn</h4>
          {parsed.turns.map((turn) => (
            <div key={turn.number} className="battle-timeline-turn">
              <div className="battle-timeline-turn-main">
                <div className="battle-timeline-turn-header">
                  <span>Turn {turn.number}</span>
                </div>
                <ul className="battle-timeline-events">
                  {turn.events.map((ev, i) => (
                    <li key={i} className={ev.side === ourSide ? "mine" : ev.side ? "theirs" : "neutral"}>
                      {ev.pokemon ? `${ev.pokemon}: ` : ""}{ev.detail}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="battle-timeline-turn-notes">
                <span className="battle-timeline-notes-label">Notes</span>
                {(notesByTurn.get(turn.number) ?? []).map((n) => <NoteChip key={n.id} note={n} />)}
                <AddNoteInline
                  compact
                  onAdd={async (tag, body) => { await addBattleNote(db, battleId, turn.number, tag, body); reload(); }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this battle?"
          message="This removes the battle log, its notes, and scouted opponent sets. This can't be undone."
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

function ScoutingBookView({ db, onBack }: { db: Database; onBack: () => void }) {
  const [allPokemon, setAllPokemon] = useState<PokemonRow[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PokemonRow | null>(null);
  const [results, setResults] = useState<ScoutedSetEntry[]>([]);

  useEffect(() => { listPokemon(db).then(setAllPokemon); }, [db]);

  const matches = useMemo(() => {
    const q = normalizeKey(query);
    if (!q) return [];
    return allPokemon.filter((p) => normalizeKey(p.display_name).includes(q)).slice(0, 20);
  }, [query, allPokemon]);

  async function selectSpecies(p: PokemonRow) {
    setSelected(p);
    setQuery(p.display_name);
    setResults(await searchScoutedSets(db, p.id));
  }

  return (
    <div className="scouting-book">
      <button className="ghost-btn" onClick={onBack}>← Back</button>
      <h2>Scouting Book</h2>
      <p className="settings-hint">Every opponent set you've seen, indexed by species. Search a Pokémon you're about to face.</p>
      <input
        type="text"
        placeholder="Search a species..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null); setResults([]); }}
      />
      {!selected && query && (
        <ul className="scouting-book-matches">
          {matches.map((p) => (
            <li key={p.id} onClick={() => selectSpecies(p)}>
              {p.display_name}{p.form_label ? ` (${p.form_label})` : ""}
            </li>
          ))}
          {matches.length === 0 && <li className="picker-modal-empty">No matches</li>}
        </ul>
      )}
      {selected && (
        <div className="scouting-book-results">
          <div className="scouting-book-results-header">
            {selected.sprite_default && <img src={selected.sprite_default} alt={selected.display_name} className="battle-roster-sprite" />}
            <div>
              <h3>{selected.display_name}</h3>
              <div className="battle-preview-types">
                <TypeBadge type={selected.type1} />
                {selected.type2 && <TypeBadge type={selected.type2} />}
              </div>
            </div>
            <span className="settings-hint">{results.length} set{results.length === 1 ? "" : "s"} seen</span>
          </div>
          {results.length === 0 && <p className="battle-log-empty">No sets scouted for this species yet.</p>}
          {results.map((r, i) => (
            <div key={i} className="scouted-set-card">
              <div className="scouted-set-header">
                <span>vs {r.opponent_name ?? "Unknown"}</span>
                <span className="settings-hint">
                  {r.format_label}{r.battle_date ? ` · ${new Date(r.battle_date).toLocaleDateString()}` : ""}
                </span>
              </div>
              <div className="scouted-set-body">
                {r.item_name && (
                  <span><ItemIcon x={r.item_sprite_x} y={r.item_sprite_y} /> {r.item_name}</span>
                )}
                {r.ability_name && <span>{r.ability_name}</span>}
                {r.tera_type && <span>Tera {r.tera_type}</span>}
                {[r.move1_name, r.move2_name, r.move3_name, r.move4_name].filter(Boolean).map((m) => <span key={m}>{m}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
