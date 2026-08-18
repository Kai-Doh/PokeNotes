import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { exportTeamToShowdown, importShowdownTeam } from "./showdownFormat";
import {
  getAbilitiesFor,
  getAbilityUsageFor,
  getAllItems,
  getAvailableMovesFor,
  getFormats,
  getItemUsageFor,
  getLegalPokemonForFormat,
  getPokemonUsageForFormat,
  parseFormatRuleset,
  type FormatRow,
  type ItemRow,
} from "./db/queries";
import {
  clearTeamSlot,
  createTeam,
  deleteTeam,
  getAllTeamRosters,
  getTeam,
  getTeamMembers,
  listTeams,
  saveTeamMember,
  updateTeamMeta,
  type TeamRosterEntry,
} from "./db/teamQueries";
import {
  calcStat,
  dualTypeEffectiveness,
  MAX_EV_PER_STAT,
  MAX_EV_TOTAL,
  MAX_IV_PER_STAT,
  natureModFor,
  NATURES,
  REAL_TYPES,
  STATS,
  TYPES,
  typeEffectiveness,
} from "./constants/gameData";
import type { AbilityRef, LearnsetMove, PokemonRow } from "./types/pokedex";
import type { Team, TeamMember, TeamMemberDisplay } from "./types/team";

function TypeBadge({ type }: { type: string }) {
  return <span className={`type-badge type-${type}`}>{type}</span>;
}

// Physical/Special/Status category badges: a colored circle chip (matching
// the games' orange/blue/gray convention) with a simple white glyph inside,
// so the shape carries meaning too, not just the color -- important at the
// small size these render at, where thin same-color line icons all blur
// into the same dot.
function CategoryIcon({ category }: { category: string }) {
  let glyph: ReactNode;
  if (category === "physical") {
    // Fist: two overlapping rounded blocks, bounding box centered on (12,12).
    glyph = (
      <>
        <rect x="5" y="7" width="14" height="10" rx="4" />
        <rect x="3" y="8" width="6" height="8" rx="3" />
      </>
    );
  } else if (category === "special") {
    // Bold 4-point sparkle, vertices placed by symmetric trig around (12,12)
    // so it's centered exactly (unlike an eyeballed star path).
    glyph = <path d="M12 4L14.1 9.9L20 12L14.1 14.1L12 20L9.9 14.1L4 12L9.9 9.9Z" />;
  } else {
    // Status: a ring with a plus -- "effect", not a raw power number.
    glyph = (
      <>
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="white" strokeWidth="2.2" />
        <path d="M12 8.5v7M8.5 12h7" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      </>
    );
  }
  return (
    <span className={`category-icon-badge category-${category}`}>
      <svg viewBox="0 0 24 24" fill="white">{glyph}</svg>
    </span>
  );
}

const emptyEvs = { ev_hp: 0, ev_atk: 0, ev_def: 0, ev_spa: 0, ev_spd: 0, ev_spe: 0 };
const defaultIvs = { iv_hp: 31, iv_atk: 31, iv_def: 31, iv_spa: 31, iv_spd: 31, iv_spe: 31 };

// Before -> after per stat: IV-only floor vs. the final stat with EVs and
// nature applied, overlaid on one hexagon. Deliberately NOT red/blue -- those
// are reserved for the nature boost/hindered coloring below, so a shared pair
// would read as if the hexagon polygons meant "boosted/hindered" too.
// Validated: node scripts/validate_palette.js "#6f7079,#7c8cff" --mode dark
// --surface "#1a1b20" --ordinal -- ALL PASS.
const CHART_BEFORE_COLOR = "#6f7079";
const CHART_AFTER_COLOR = "#7c8cff";
const NATURE_UP_COLOR = "#3b82f6";
const NATURE_DOWN_COLOR = "#e5484d";

// Classic Pokémon stat-hexagon layout: HP at top, clockwise through the
// physical stats (Atk/Def) down to Speed at the bottom, then back up through
// the special stats (SpD/SpA) -- the arrangement used by Bulbapedia/Serebii/
// Showdown's own stat graphs, so it reads as familiar rather than novel.
const HEX_ORDER = ["hp", "atk", "def", "spe", "spd", "spa"] as const;
const HEX_SIZE = 220;
const HEX_CENTER = HEX_SIZE / 2;
const HEX_RADIUS = HEX_SIZE / 2 - 34;

function hexPoint(index: number, fraction: number) {
  const angle = -Math.PI / 2 + index * (Math.PI / 3);
  const r = HEX_RADIUS * fraction;
  return { x: HEX_CENTER + r * Math.cos(angle), y: HEX_CENTER + r * Math.sin(angle) };
}

function StatComparisonChart({
  pokemon,
  level,
  natureName,
  evs,
  ivs,
}: {
  pokemon: PokemonRow;
  level: number;
  natureName: string | null;
  evs: Record<string, number>;
  ivs: Record<string, number>;
}) {
  const nature = NATURES.find((n) => n.name === natureName);
  const baseStatOf = (key: string) => (pokemon as unknown as Record<string, number>)[`base_${key}`];
  const statLabel = (key: string) => STATS.find((s) => s.key === key)!.label;

  const rows = HEX_ORDER.map((key) => {
    const isHp = key === "hp";
    const mod = natureModFor(nature, key);
    const iv = ivs[`iv_${key}`] ?? 31;
    const ev = evs[`ev_${key}`] ?? 0;
    const before = calcStat(baseStatOf(key), iv, 0, level, isHp, mod);
    const after = calcStat(baseStatOf(key), iv, ev, level, isHp, mod);
    const natureEffect = isHp ? null : nature?.boosts === key ? "up" : nature?.hinders === key ? "down" : null;
    return { key, label: statLabel(key), before, after, natureEffect };
  });

  // Fixed per-axis scale, independent of the *currently selected* EVs/IVs/
  // nature: each axis's theoretical ceiling (31 IV, 252 EV, best-case nature),
  // computed once for this Pokémon+level. Without this, moving one slider
  // would change the shared max and silently reposition every other axis --
  // the "all the other dots move" bug.
  const maxValue = useMemo(() => {
    const ceilings = HEX_ORDER.map((key) => calcStat(baseStatOf(key), 31, 252, level, key === "hp", 1.1));
    return Math.max(...ceilings, 100) * 1.05;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon.id, level]);

  const beforePoints = rows.map((r, i) => hexPoint(i, r.before / maxValue));
  const afterPoints = rows.map((r, i) => hexPoint(i, r.after / maxValue));
  const toPath = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

  const gridRings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="stat-chart">
      <div className="stat-chart-legend">
        <span><i style={{ background: CHART_BEFORE_COLOR }} /> IV only</span>
        <span><i style={{ background: CHART_AFTER_COLOR }} /> With EVs + nature</span>
        <span><i style={{ background: NATURE_UP_COLOR }} /> nature boost</span>
        <span><i style={{ background: NATURE_DOWN_COLOR }} /> nature hindered</span>
      </div>

      <svg viewBox={`0 0 ${HEX_SIZE} ${HEX_SIZE}`} className="stat-hexagon">
        {gridRings.map((frac) => (
          <polygon
            key={frac}
            points={toPath(rows.map((_, i) => hexPoint(i, frac)))}
            className="hex-grid-ring"
          />
        ))}
        {rows.map((_, i) => {
          const p = hexPoint(i, 1);
          return <line key={i} x1={HEX_CENTER} y1={HEX_CENTER} x2={p.x} y2={p.y} className="hex-grid-spoke" />;
        })}

        <polygon points={toPath(beforePoints)} className="hex-area before" />
        <polygon points={toPath(afterPoints)} className="hex-area after" />

        {beforePoints.map((p, i) => <circle key={`b${i}`} cx={p.x} cy={p.y} r="4" className="hex-dot before" />)}
        {afterPoints.map((p, i) => <circle key={`a${i}`} cx={p.x} cy={p.y} r="4" className="hex-dot after" />)}

        {rows.map((r, i) => {
          // One consolidated block per axis (label + value stacked via dy
          // offsets) instead of two independently positioned text elements --
          // the old label/value pair sat close enough along the same radial
          // line to visually collide. Nature effect reads as color on both
          // lines (blue = boosted, red = hindered) rather than an arrow glyph.
          const pos = hexPoint(i, 1.32);
          const natureClass = r.natureEffect ? `nature-${r.natureEffect}` : "";
          return (
            <text key={r.key} x={pos.x} y={pos.y} className={`hex-axis-label ${natureClass}`} textAnchor="middle">
              <tspan x={pos.x} dy="-0.6em">{r.label}</tspan>
              <tspan x={pos.x} dy="1.15em" className="hex-axis-value">{r.after}</tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function MiniStatBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, (value / 200) * 100);
  return (
    <div className="mini-stat-row">
      <span className="mini-stat-label">{label}</span>
      <div className="mini-stat-track"><div className="mini-stat-fill" style={{ width: `${pct}%` }} /></div>
      <span className="mini-stat-value">{value}</span>
    </div>
  );
}

/**
 * Team-wide type coverage: which attacking types the roster is collectively
 * weak to (defense) and which defending types the roster's chosen moves can
 * hit super-effectively (offense). Per-member stats live on the slot cards
 * themselves now, not a separate section here -- showing a Pokémon's stats
 * twice in two different cards was redundant.
 */
function TeamOverviewPanel({ members }: { members: TeamMemberDisplay[] }) {
  if (members.length === 0) return <p className="settings-hint">Add Pokémon to see team coverage.</p>;

  // Immunity is the strongest defensive signal for a type -- a team with an
  // immune wall to Ground is in a different situation than one that's merely
  // "not weak" to it, even if both would otherwise show the same weak count.
  // So immune always wins the color, regardless of how many others are weak.
  const typeInfo = new Map<string, { weak: number; immune: number }>();
  for (const atkType of REAL_TYPES) {
    let weak = 0;
    let immune = 0;
    for (const r of members) {
      const mult = dualTypeEffectiveness(atkType, r.type1, r.type2);
      if (mult === 0) immune++;
      else if (mult > 1) weak++;
    }
    typeInfo.set(atkType, { weak, immune });
  }
  const covered = new Set<string>();
  for (const defType of REAL_TYPES) {
    const hit = members.some((r) =>
      [r.move1_type, r.move2_type, r.move3_type, r.move4_type].some(
        (mt) => mt && typeEffectiveness(mt, defType) > 1,
      ),
    );
    if (hit) covered.add(defType);
  }

  function weaknessClass(t: string) {
    const info = typeInfo.get(t)!;
    if (info.immune > 0) return "immune";
    if (info.weak >= 3) return "very-weak";
    if (info.weak >= 1) return "weak";
    return "neutral";
  }

  return (
    <div className="overview-panel">
      <div className="overview-section">
        <h5>Team weaknesses</h5>
        <p className="settings-hint">Number of teammates weak to each attacking type. Blue means at least one teammate is immune, regardless of how many others are weak.</p>
        <div className="coverage-grid">
          {REAL_TYPES.map((t) => {
            const info = typeInfo.get(t)!;
            return (
              <div key={t} className={`weakness-cell ${weaknessClass(t)}`}>
                <TypeBadge type={t} />
                <span className="weakness-count">{info.immune > 0 && info.weak === 0 ? "Immune" : info.weak}</span>
              </div>
            );
          })}
        </div>
        <div className="coverage-legend">
          <span><i className="legend-swatch very-weak" /> 3+ weak</span>
          <span><i className="legend-swatch weak" /> 1–2 weak</span>
          <span><i className="legend-swatch immune" /> Has immunity</span>
          <span><i className="legend-swatch neutral" /> Neutral</span>
        </div>
      </div>

      <div className="overview-section">
        <h5>Offensive coverage</h5>
        <p className="settings-hint">Types your team has at least one super-effective move against.</p>
        <div className="coverage-grid">
          {REAL_TYPES.map((t) => (
            <div key={t} className={`coverage-cell ${covered.has(t) ? "covered" : "uncovered"}`}>
              <TypeBadge type={t} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function blankMember(teamId: number, slot: number, pokemon: PokemonRow, isDoublesFormat: boolean): Omit<TeamMember, "id"> {
  return {
    team_id: teamId,
    slot,
    pokemon_id: pokemon.id,
    nickname: null,
    item_id: null,
    ability_id: null,
    nature: "Hardy",
    tera_type: pokemon.type1,
    // VGC/doubles/Champions play is always level 50; Showdown's singles
    // tiers (OU, UU, ...) are level 100 -- default to whichever this
    // format's ruleset actually uses instead of a fixed guess.
    level: isDoublesFormat ? 50 : 100,
    move1_id: null,
    move2_id: null,
    move3_id: null,
    move4_id: null,
    ...emptyEvs,
    ...defaultIvs,
  };
}

function SpeciesPicker({
  db,
  formatId,
  onPick,
  onCancel,
}: {
  db: Database;
  formatId: number;
  onPick: (p: PokemonRow) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<(PokemonRow & { legality_status: string; tier: string | null })[]>([]);
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    getLegalPokemonForFormat(db, formatId).then(setOptions);
    getPokemonUsageForFormat(db, formatId).then((rows) => setUsage(new Map(rows.map((r) => [r.pokemon_id, r.usage_pct]))));
  }, [db, formatId]);

  // Real tournament usage (when we have it for this format) surfaces the
  // Pokémon actually being played to the top, instead of leaving them
  // scattered through dex-number order alongside everything legal-but-unused.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? options
      : options.filter((p) => p.display_name.toLowerCase().includes(q) || p.form_label?.toLowerCase().includes(q));
    if (usage.size === 0) return base;
    return [...base].sort((a, b) => (usage.get(b.id) ?? -1) - (usage.get(a.id) ?? -1));
  }, [options, search, usage]);

  return (
    <div className="slot-editor">
      <div className="slot-editor-header">
        <h3>Choose a Pokémon ({options.length} legal)</h3>
        <button className="ghost-btn" onClick={onCancel}>Cancel</button>
      </div>
      <input
        autoFocus
        className="search-box"
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="species-picker-list">
        {filtered.map((p) => (
          <li key={p.id} onClick={() => onPick(p)}>
            <img src={p.sprite_default ?? undefined} alt="" loading="lazy" />
            <span>
              {p.display_name}
              {p.form_label ? ` (${p.form_label})` : ""}
            </span>
            {p.legality_status === "restricted" && <span className="legality-badge status-restricted">Restricted</span>}
            {p.tier && <span className="tier-tag">{p.tier}</span>}
            {usage.has(p.id) && <span className="usage-badge" title="Tournament usage">{usage.get(p.id)!.toFixed(1)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchDropdown<T extends { id: number; display_name: string }>({
  value,
  options,
  onSearch,
  onSelect,
  placeholder,
  renderIcon,
  renderBadge,
}: {
  value: T | null;
  options: T[];
  onSearch: (q: string) => void;
  onSelect: (item: T | null) => void;
  placeholder: string;
  renderIcon?: (item: T) => ReactNode;
  renderBadge?: (item: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.display_name ?? "");

  useEffect(() => setText(value?.display_name ?? ""), [value]);

  return (
    <div className="search-dropdown">
      <div className="search-dropdown-input-row">
        {value && renderIcon?.(value)}
        <input
          value={text}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            onSearch(text);
          }}
          onChange={(e) => {
            setText(e.target.value);
            onSearch(e.target.value);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {value && (
          <button className="clear-btn" onMouseDown={(e) => { e.preventDefault(); onSelect(null); setText(""); }}>
            ×
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul className="search-dropdown-list">
          {options.map((opt) => (
            <li key={opt.id} onMouseDown={(e) => { e.preventDefault(); onSelect(opt); setOpen(false); }}>
              {renderIcon?.(opt)}
              {opt.display_name}
              {renderBadge?.(opt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SetEditor({
  db,
  team,
  slot,
  pokemon,
  existing,
  teraAllowed,
  isDoublesFormat,
  onSaved,
  onChangeSpecies,
  onAutoSaved,
}: {
  db: Database;
  team: Team;
  slot: number;
  pokemon: PokemonRow;
  existing: TeamMemberDisplay | null;
  teraAllowed: boolean;
  isDoublesFormat: boolean;
  onSaved: () => void;
  onChangeSpecies: () => void;
  onAutoSaved: () => void;
}) {
  const [member, setMember] = useState<Omit<TeamMember, "id">>(
    existing ?? blankMember(team.id, slot, pokemon, isDoublesFormat),
  );
  const [abilities, setAbilities] = useState<AbilityRef[]>([]);
  const [availableMoves, setAvailableMoves] = useState<LearnsetMove[]>([]);
  const [moveFilters, setMoveFilters] = useState<string[]>(["", "", "", ""]);
  const [editingMoveIdx, setEditingMoveIdx] = useState<number | null>(null);
  const [allItems, setAllItems] = useState<ItemRow[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<ItemRow | null>(null);
  const [itemUsage, setItemUsage] = useState<Map<number, number>>(new Map());
  const [abilityUsage, setAbilityUsage] = useState<Map<number, number>>(new Map());
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved">("saving");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    getAbilitiesFor(db, pokemon.id).then(setAbilities);
    getAvailableMovesFor(db, pokemon).then(setAvailableMoves);
  }, [db, pokemon]);

  // Real tournament usage % for this exact Pokémon in this format -- "what
  // are people actually running" alongside the ability/item pickers, not
  // just what's legal. No data for most formats yet (LimitlessVGC only
  // tracks the official VGC/Champions ladder), which is fine: the maps are
  // just empty and the pickers render exactly as before.
  useEffect(() => {
    if (!team.format_id) {
      setItemUsage(new Map());
      setAbilityUsage(new Map());
      return;
    }
    getItemUsageFor(db, team.format_id, pokemon.id).then((rows) => setItemUsage(new Map(rows.map((r) => [r.item_id, r.usage_pct]))));
    getAbilityUsageFor(db, team.format_id, pokemon.id).then((rows) => setAbilityUsage(new Map(rows.map((r) => [r.ability_id, r.usage_pct]))));
  }, [db, team.format_id, pokemon]);

  // Loaded once and filtered client-side below, rather than a fresh query
  // per keystroke -- see getAllItems in db/queries.ts for why.
  useEffect(() => {
    getAllItems(db).then(setAllItems);
  }, [db]);

  useEffect(() => {
    if (!existing?.item_id || allItems.length === 0) return;
    setSelectedItem(allItems.find((it) => it.id === existing.item_id) ?? null);
  }, [existing, allItems]);

  const itemOptions = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    const usagePct = (it: ItemRow) => itemUsage.get(it.id) ?? -1;
    if (!q) {
      // Nothing typed yet: surface the items real teams actually run on this
      // Pokémon (if we have data for this format) as suggestions on focus,
      // instead of an empty list until the user starts typing.
      if (itemUsage.size === 0) return [];
      return [...allItems].filter((it) => itemUsage.has(it.id)).sort((a, b) => usagePct(b) - usagePct(a)).slice(0, 10);
    }
    return [...allItems]
      .filter((it) => it.display_name.toLowerCase().includes(q))
      .sort((a, b) => usagePct(b) - usagePct(a))
      .slice(0, 30);
  }, [allItems, itemQuery, itemUsage]);

  const evTotal = STATS.reduce((sum, s) => sum + (member as unknown as Record<string, number>)[`ev_${s.key}`], 0);

  // Remaining budget cap per stat: even if this stat is under 252, it can't
  // grow past whatever room the *other* stats' EVs leave in the 508 total.
  function evMaxFor(stat: string): number {
    const otherTotal = evTotal - (member as unknown as Record<string, number>)[`ev_${stat}`];
    return Math.max(0, Math.min(MAX_EV_PER_STAT, MAX_EV_TOTAL - otherTotal));
  }

  function setEv(stat: string, value: number) {
    const clamped = Math.max(0, Math.min(evMaxFor(stat), value || 0));
    setMember((m) => ({ ...m, [`ev_${stat}`]: clamped }));
  }
  function setIv(stat: string, value: number) {
    const clamped = Math.max(0, Math.min(MAX_IV_PER_STAT, value ?? 0));
    setMember((m) => ({ ...m, [`iv_${stat}`]: clamped }));
  }

  const moveIds = [member.move1_id, member.move2_id, member.move3_id, member.move4_id];
  function setMoveSlot(idx: number, moveId: number | null) {
    const key = `move${idx + 1}_id` as const;
    setMember((m) => ({ ...m, [key]: moveId }));
  }

function currentDraft(): Omit<TeamMember, "id"> {
    return {
      ...member,
      item_id: selectedItem?.id ?? null,
      tera_type: teraAllowed ? member.tera_type : null,
    };
  }

  // Kept in sync every render so the unmount handler below can read the
  // *latest* draft -- an effect cleanup with `[]` deps only ever sees the
  // closure from the render it was created in, otherwise.
  const latestDraftRef = useRef(currentDraft());
  latestDraftRef.current = currentDraft();

  // Best-effort flush if this editor unmounts (e.g. switching to a different
  // slot) while an edit is still inside the debounce window -- otherwise
  // that last edit would be silently dropped rather than saved.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTeamMember(db, latestDraftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-saves ~600ms after each edit, rather than requiring an explicit
  // Save click. Two exceptions to the debounce, both on mount: opening an
  // *already-saved* member skips saving entirely (nothing changed yet, so
  // re-saving would be a no-op); a brand-new species pick saves *immediately*
  // with no debounce delay, so the grid card updates right away instead of
  // waiting 600ms (or only refreshing once you close the editor).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (existing) return;
      setSaveStatus("saving");
      saveTeamMember(db, currentDraft()).then(() => {
        setSaveStatus("saved");
        onAutoSaved();
      });
      return;
    }
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTeamMember(db, currentDraft()).then(() => {
        setSaveStatus("saved");
        onAutoSaved();
      });
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, selectedItem, teraAllowed]);

  // Flushes any pending debounced save immediately -- used before navigating
  // away so a very recent edit isn't lost to the 600ms window closing early.
  async function flushSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveTeamMember(db, currentDraft());
    setSaveStatus("saved");
    onAutoSaved();
  }

  const sprite = pokemon.sprite_default;

  return (
    <div className="slot-editor">
      <div className="slot-editor-header">
        <div className="slot-editor-species">
          <img src={sprite ?? undefined} alt="" />
          <div>
            <strong>{pokemon.display_name}{pokemon.form_label ? ` (${pokemon.form_label})` : ""}</strong>
            <div className="types"><TypeBadge type={pokemon.type1} />{pokemon.type2 && <TypeBadge type={pokemon.type2} />}</div>
          </div>
        </div>
        <div className="slot-editor-header-actions">
          <span className={`save-status ${saveStatus}`}>{saveStatus === "saving" ? "Saving…" : "Saved"}</span>
          <button className="ghost-btn" onClick={onChangeSpecies}>Change</button>
          <button className="ghost-btn" onClick={async () => { await flushSave(); onSaved(); }}>Done</button>
        </div>
      </div>

      <div className="slot-editor-body">
      <div className="slot-editor-main">
      <div className="set-form">
        <label>
          Nickname
          <input
            value={member.nickname ?? ""}
            onChange={(e) => setMember((m) => ({ ...m, nickname: e.target.value || null }))}
            placeholder={pokemon.display_name}
          />
        </label>

        <label className="ability-field">
          Ability
          <div className="ability-cards">
            {abilities.map((a) => (
              <div
                key={a.id}
                className={`ability-card ${member.ability_id === a.id ? "selected" : ""}`}
                onClick={() => setMember((m) => ({ ...m, ability_id: a.id }))}
              >
                <div className="ability-card-header">
                  <strong>{a.display_name}</strong>
                  {abilityUsage.has(a.id) && (
                    <span className="usage-badge" title="Tournament usage">{abilityUsage.get(a.id)!.toFixed(0)}%</span>
                  )}
                  {a.is_hidden ? <span className="hidden-tag">Hidden</span> : null}
                </div>
                {a.short_effect && <p className="ability-card-desc">{a.short_effect}</p>}
              </div>
            ))}
          </div>
        </label>

        <label>
          Item
          <SearchDropdown
            value={selectedItem}
            options={itemOptions}
            placeholder="Search items..."
            onSearch={setItemQuery}
            onSelect={setSelectedItem}
            renderIcon={(it) => it.sprite ? <img src={it.sprite} alt="" className="dropdown-icon" loading="lazy" /> : null}
            renderBadge={(it) => itemUsage.has(it.id) ? (
              <span className="usage-badge" title="Tournament usage">{itemUsage.get(it.id)!.toFixed(0)}%</span>
            ) : null}
          />
        </label>

        <label>
          Nature
          <select value={member.nature ?? "Hardy"} onChange={(e) => setMember((m) => ({ ...m, nature: e.target.value }))}>
            {NATURES.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}{n.boosts ? ` (+${n.boosts}/-${n.hinders})` : " (neutral)"}
              </option>
            ))}
          </select>
        </label>

        {teraAllowed && (
          <label>
            Tera Type
            <select value={member.tera_type ?? pokemon.type1} onChange={(e) => setMember((m) => ({ ...m, tera_type: e.target.value }))}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}

        <label>
          Level
          <div className="level-toggle">
            {[50, 100].map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={member.level === lvl ? "active" : ""}
                onClick={() => setMember((m) => ({ ...m, level: lvl }))}
              >
                Lv {lvl}
              </button>
            ))}
          </div>
        </label>
      </div>

      <h4>Moves</h4>
      <div className="move-cards">
        {[0, 1, 2, 3].map((idx) => {
          const q = moveFilters[idx].toLowerCase();
          const matches = q ? availableMoves.filter((m) => m.display_name.toLowerCase().includes(q)) : availableMoves;
          const currentMove = availableMoves.find((m) => m.id === moveIds[idx]);
          const isEditing = editingMoveIdx === idx || !currentMove;

          if (isEditing) {
            return (
              <div key={idx} className="move-card move-card-editing">
                <SearchDropdown
                  value={currentMove ? { id: currentMove.id, display_name: currentMove.display_name } : null}
                  options={matches.slice(0, 30).map((m) => ({ id: m.id, display_name: m.display_name }))}
                  placeholder={`Search move ${idx + 1}...`}
                  onSearch={(text) => setMoveFilters((f) => f.map((v, i) => (i === idx ? text : v)))}
                  onSelect={(opt) => {
                    setMoveSlot(idx, opt?.id ?? null);
                    setEditingMoveIdx(null);
                  }}
                />
              </div>
            );
          }

          return (
            <div key={idx} className="move-card" onClick={() => setEditingMoveIdx(idx)}>
              <button
                className="slot-clear move-card-clear"
                onClick={(e) => { e.stopPropagation(); setMoveSlot(idx, null); }}
              >
                ×
              </button>
              <div className="move-card-header">
                <strong>{currentMove.display_name}</strong>
                <TypeBadge type={currentMove.type} />
              </div>
              <div className="move-card-stats">
                <span className="move-card-category">
                  <CategoryIcon category={currentMove.category} /> {currentMove.category}
                </span>
                <span>Pow {currentMove.power ?? "—"}</span>
                <span>Acc {currentMove.accuracy ?? "—"}</span>
                <span>PP {currentMove.pp ?? "—"}</span>
              </div>
              {currentMove.short_effect && <p className="move-card-desc">{currentMove.short_effect}</p>}
            </div>
          );
        })}
      </div>

      <h4>EVs ({evTotal}/{MAX_EV_TOTAL})</h4>
      <div className="ev-iv-sliders">
        {STATS.map((s) => (
          <label key={s.key}>
            <span className="slider-label-row">
              {s.label}
              <span className="slider-value">{(member as unknown as Record<string, number>)[`ev_${s.key}`]}</span>
            </span>
            <input
              type="range"
              min={0}
              max={evMaxFor(s.key)}
              step={1}
              value={(member as unknown as Record<string, number>)[`ev_${s.key}`]}
              onChange={(e) => setEv(s.key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      <h4>IVs</h4>
      <div className="ev-iv-sliders">
        {STATS.map((s) => (
          <label key={s.key}>
            <span className="slider-label-row">
              {s.label}
              <span className="slider-value">{(member as unknown as Record<string, number>)[`iv_${s.key}`]}</span>
            </span>
            <input
              type="range"
              min={0}
              max={MAX_IV_PER_STAT}
              value={(member as unknown as Record<string, number>)[`iv_${s.key}`]}
              onChange={(e) => setIv(s.key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      </div>

      <div className="slot-editor-side">
        <h4>Resulting Stats</h4>
        <StatComparisonChart
          pokemon={pokemon}
          level={member.level}
          natureName={member.nature}
          evs={member as unknown as Record<string, number>}
          ivs={member as unknown as Record<string, number>}
        />
      </div>
      </div>
    </div>
  );
}

function TeamSlotCard({
  member,
  onClick,
  onClear,
}: {
  member: TeamMemberDisplay | null;
  onClick: () => void;
  onClear: () => void;
}) {
  if (!member) {
    return (
      <div className="team-slot empty" onClick={onClick}>
        <span>+ Add Pokémon</span>
      </div>
    );
  }
  const nature = NATURES.find((n) => n.name === member.nature);
  const finalStat = (key: string, isHp: boolean) =>
    calcStat((member as unknown as Record<string, number>)[`base_${key}`], (member as unknown as Record<string, number>)[`iv_${key}`],
      (member as unknown as Record<string, number>)[`ev_${key}`], member.level, isHp, natureModFor(nature, key));

  return (
    <div className="team-slot filled">
      <button className="slot-clear" onClick={(e) => { e.stopPropagation(); onClear(); }}>×</button>
      <div onClick={onClick} className="team-slot-content">
        <img className="team-slot-sprite" src={member.pokemon_sprite ?? undefined} alt="" />
        <div className="team-slot-name">{member.nickname || member.pokemon_name}</div>
        <div className="team-slot-item">
          {member.item_name ? (
            <>
              {member.item_sprite && <img src={member.item_sprite} alt="" className="team-slot-item-icon" />}
              {member.item_name}
            </>
          ) : (
            "no item"
          )}
        </div>
        <div className="team-slot-moves">
          {[member.move1_name, member.move2_name, member.move3_name, member.move4_name].filter(Boolean).length > 0 ? (
            <ul className="team-slot-move-list">
              {[member.move1_name, member.move2_name, member.move3_name, member.move4_name]
                .filter(Boolean)
                .map((mv, i) => <li key={i}>{mv}</li>)}
            </ul>
          ) : (
            <span className="team-slot-moves-empty">no moves set</span>
          )}
        </div>
        <div className="team-slot-stats">
          {STATS.map((s) => (
            <MiniStatBar key={s.key} label={s.label} value={finalStat(s.key, s.key === "hp")} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ShowdownImportExportPanel({
  db,
  teamId,
  mode,
  members,
  onClose,
  onImported,
}: {
  db: Database;
  teamId: number;
  mode: "import" | "export";
  members: TeamMemberDisplay[];
  onClose: () => void;
  onImported: () => void;
}) {
  const exportText = useMemo(() => (mode === "export" ? exportTeamToShowdown(members) : ""), [mode, members]);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; warnings: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable -- the text is still
      // selectable in the textarea below, so this isn't a dead end.
    }
  }

  async function handleImport() {
    setImporting(true);
    setResult(null);
    try {
      const res = await importShowdownTeam(db, teamId, importText);
      setResult(res);
      if (res.imported > 0) onImported();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="io-panel">
      <div className="io-panel-header">
        <h3>{mode === "export" ? "Export to Showdown" : "Import from Showdown"}</h3>
        <button className="ghost-btn" onClick={onClose}>Close</button>
      </div>

      {mode === "export" ? (
        <>
          <p className="settings-hint">Paste this into Showdown's team builder ("Import/Export" → paste).</p>
          <textarea className="io-textarea" readOnly value={exportText} onFocus={(e) => e.target.select()} />
          <button onClick={handleCopy}>{copied ? "Copied!" : "Copy to clipboard"}</button>
        </>
      ) : (
        <>
          <p className="settings-hint">Paste a team from Showdown's "Import/Export" panel. This replaces all 6 slots.</p>
          <textarea
            className="io-textarea"
            placeholder={"Iron Valiant @ Booster Energy\nAbility: Quark Drive\nLevel: 50\n...\n\n(blank line between each Pokémon)"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button onClick={handleImport} disabled={importing || !importText.trim()}>
            {importing ? "Importing..." : "Import Team"}
          </button>
          {result && (
            <div className="io-result">
              <p>{result.imported} Pokémon imported.</p>
              {result.warnings.length > 0 && (
                <ul className="io-warnings">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamEditor({ db, teamId, onBack }: { db: Database; teamId: number; onBack: () => void }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [members, setMembers] = useState<TeamMemberDisplay[]>([]);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [pickingSpeciesForSlot, setPickingSpeciesForSlot] = useState<number | null>(null);
  const [chosenSpecies, setChosenSpecies] = useState<PokemonRow | null>(null);
  const [ioMode, setIoMode] = useState<"import" | "export" | null>(null);

  async function reload() {
    const [teamRow, memberRows] = await Promise.all([getTeam(db, teamId), getTeamMembers(db, teamId)]);
    setTeam(teamRow ?? null);
    setMembers(memberRows);
  }

  useEffect(() => {
    getFormats(db).then(setFormats);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, teamId]);

  if (!team) return <p>Loading...</p>;

  const membersBySlot = new Map(members.map((m) => [m.slot, m]));

  async function handleFormatChange(formatId: number) {
    await updateTeamMeta(db, teamId, { format_id: formatId });
    reload();
  }

  async function handleClearSlot(slot: number) {
    await clearTeamSlot(db, teamId, slot);
    reload();
  }

  const editingMember = editingSlot !== null ? membersBySlot.get(editingSlot) ?? null : null;
  const currentFormat = formats.find((f) => f.id === team.format_id);
  const teraAllowed = parseFormatRuleset(currentFormat?.ruleset ?? null).tera_allowed !== false;
  const isDoublesFormat = currentFormat?.is_doubles === 1;

  return (
    <div className="team-editor">
      <div className="team-editor-header">
        <button className="ghost-btn" onClick={onBack}>← Teams</button>
        <input
          className="team-name-input"
          value={team.name}
          onChange={(e) => setTeam({ ...team, name: e.target.value })}
          onBlur={() => updateTeamMeta(db, teamId, { name: team.name })}
        />
        <select
          value={team.format_id ?? ""}
          onChange={(e) => handleFormatChange(Number(e.target.value))}
        >
          <option value="">Select format...</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {team.format_id && !teraAllowed && <span className="format-note">Tera disabled in this format</span>}
        <div className="team-editor-header-actions">
          <button className="ghost-btn" onClick={() => setIoMode("export")}>Export</button>
          <button className="ghost-btn" onClick={() => setIoMode("import")}>Import</button>
        </div>
      </div>

      {ioMode && (
        <ShowdownImportExportPanel
          db={db}
          teamId={teamId}
          mode={ioMode}
          members={members}
          onClose={() => setIoMode(null)}
          onImported={reload}
        />
      )}

      {!team.format_id ? (
        <p className="settings-hint">Pick a format above to start adding Pokémon — only legal picks for that format will show up.</p>
      ) : (
        <>
          <div className="team-grid">
            {[1, 2, 3, 4, 5, 6].map((slot) => (
              <TeamSlotCard
                key={slot}
                member={membersBySlot.get(slot) ?? null}
                onClick={() => {
                  const m = membersBySlot.get(slot);
                  if (m) {
                    setEditingSlot(slot);
                    setChosenSpecies(null);
                  } else {
                    setPickingSpeciesForSlot(slot);
                  }
                }}
                onClear={() => handleClearSlot(slot)}
              />
            ))}
          </div>

          <TeamOverviewPanel members={members} />

          {pickingSpeciesForSlot !== null && (
            <SpeciesPicker
              db={db}
              formatId={team.format_id}
              onCancel={() => setPickingSpeciesForSlot(null)}
              onPick={(p) => {
                setChosenSpecies(p);
                setEditingSlot(pickingSpeciesForSlot);
                setPickingSpeciesForSlot(null);
              }}
            />
          )}

          {editingSlot !== null && (chosenSpecies || editingMember) && (
            <SetEditorLoader
              // The team grid stays clickable while an editor is open, so
              // switching slots without closing the current one first is
              // possible -- without a slot-keyed remount, React treats that
              // as a prop update on the *same* instance rather than a fresh
              // mount, and SetEditor's `member` state (only initialized once
              // via useState) would silently keep the previous slot's data
              // instead of resetting for the new one.
              key={editingSlot}
              db={db}
              team={team}
              slot={editingSlot}
              speciesOverride={chosenSpecies}
              existing={editingMember}
              teraAllowed={teraAllowed}
              isDoublesFormat={isDoublesFormat}
              onSaved={() => {
                setEditingSlot(null);
                setChosenSpecies(null);
                reload();
              }}
              onChangeSpecies={() => {
                setPickingSpeciesForSlot(editingSlot);
                setEditingSlot(null);
              }}
              onAutoSaved={reload}
            />
          )}
        </>
      )}
    </div>
  );
}

// Resolves which PokemonRow to edit (either freshly chosen, or the existing
// member's species looked up by id) before handing off to SetEditor.
function SetEditorLoader({
  db,
  team,
  slot,
  speciesOverride,
  existing,
  teraAllowed,
  isDoublesFormat,
  onSaved,
  onChangeSpecies,
  onAutoSaved,
}: {
  db: Database;
  team: Team;
  slot: number;
  speciesOverride: PokemonRow | null;
  existing: TeamMemberDisplay | null;
  teraAllowed: boolean;
  isDoublesFormat: boolean;
  onSaved: () => void;
  onChangeSpecies: () => void;
  onAutoSaved: () => void;
}) {
  const [pokemon, setPokemon] = useState<PokemonRow | null>(speciesOverride);

  useEffect(() => {
    if (speciesOverride) {
      setPokemon(speciesOverride);
      return;
    }
    if (existing) {
      db.select<PokemonRow[]>("SELECT * FROM pokemon WHERE id = ?", [existing.pokemon_id]).then((r) => setPokemon(r[0] ?? null));
    }
  }, [db, speciesOverride, existing]);

  if (!pokemon) return null;

  return (
    <SetEditor
      db={db}
      team={team}
      slot={slot}
      pokemon={pokemon}
      existing={speciesOverride ? null : existing}
      teraAllowed={teraAllowed}
      isDoublesFormat={isDoublesFormat}
      onSaved={onSaved}
      onChangeSpecies={onChangeSpecies}
      onAutoSaved={onAutoSaved}
    />
  );
}

function TeamList({ db, onOpen }: { db: Database; onOpen: (id: number) => void }) {
  const [teams, setTeams] = useState<(Team & { format_name: string | null })[]>([]);
  const [rosters, setRosters] = useState<Map<number, (TeamRosterEntry | null)[]>>(new Map());

  function reload() {
    listTeams(db).then(setTeams);
    getAllTeamRosters(db).then((rows) => {
      const byTeam = new Map<number, (TeamRosterEntry | null)[]>();
      for (const row of rows) {
        const slots = byTeam.get(row.team_id) ?? Array(6).fill(null);
        slots[row.slot - 1] = row;
        byTeam.set(row.team_id, slots);
      }
      setRosters(byTeam);
    });
  }

  useEffect(reload, [db]);

  async function handleCreateTeam() {
    const id = await createTeam(db, "New Team", null);
    onOpen(id);
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this team?")) return;
    await deleteTeam(db, id);
    reload();
  }

  return (
    <div className="team-list-page">
      <h2>Teams</h2>
      <div className="team-cards-grid">
        <div className="team-slot empty create-team-tile" onClick={handleCreateTeam}>
          <span>+ Create Team</span>
        </div>
        {teams.map((t) => (
          <div key={t.id} className="team-card" onClick={() => onOpen(t.id)}>
            <button className="slot-clear team-card-delete" onClick={(e) => handleDelete(t.id, e)}>×</button>
            <div className="team-card-header">
              <strong>{t.name}</strong>
              <span className="team-list-format">{t.format_name ?? "no format set"}</span>
            </div>
            <div className="team-card-roster">
              {(rosters.get(t.id) ?? Array(6).fill(null)).map((member, i) =>
                member ? (
                  <img key={i} src={member.pokemon_sprite ?? undefined} alt={member.pokemon_name} title={member.pokemon_name} />
                ) : (
                  <div key={i} className="team-card-roster-empty" />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamBuilder({ db }: { db: Database }) {
  const [openTeamId, setOpenTeamId] = useState<number | null>(null);

  return openTeamId === null ? (
    <TeamList db={db} onOpen={setOpenTeamId} />
  ) : (
    <TeamEditor db={db} teamId={openTeamId} onBack={() => setOpenTeamId(null)} />
  );
}
