// Builds public/seed/*.json from PokeAPI's raw CSV export (species, forms, stats,
// abilities, moves, items, learnsets) joined with Showdown competitive tiers
// (via @pkmn/dex) for format legality. Run with: node scripts/build-pokedex.mjs
//
// Output is consumed at app first-run by the frontend to populate the local
// SQLite pokedex (see src-tauri/migrations/0001_init.sql for the schema).

import { parse } from "csv-parse/sync";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dex } from "@pkmn/dex";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".cache");
const OUT_DIR = path.join(__dirname, "..", "public", "seed");
const CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const EN = "9"; // PokeAPI english language_id

// Gen 9 version groups whose learnsets we care about (current-gen play).
const LEARNSET_VERSION_GROUPS = new Set(["25", "26", "27", "32"]); // scarlet-violet, teal mask, indigo disk, champions

async function fetchCsv(name) {
  const cachePath = path.join(CACHE_DIR, `${name}.csv`);
  let text;
  if (existsSync(cachePath)) {
    text = await readFile(cachePath, "utf-8");
  } else {
    const res = await fetch(`${CSV_BASE}/${name}.csv`);
    if (!res.ok) throw new Error(`Failed to fetch ${name}.csv: ${res.status}`);
    text = await res.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, text, "utf-8");
  }
  return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
}

function toMap(rows, keyField) {
  const m = new Map();
  for (const r of rows) m.set(r[keyField], r);
  return m;
}

function groupBy(rows, keyField) {
  const m = new Map();
  for (const r of rows) {
    const k = r[keyField];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function englishName(namesRows, idField, id) {
  const row = namesRows.find((r) => r[idField] === id && r.local_language_id === EN);
  return row ? row.name : null;
}

// Cosmetic-only form groups: keep just the default form (plus explicit exceptions,
// e.g. gmax) so the dex isn't flooded with dozens of visually-only variants.
const COSMETIC_FORM_KEEP = {
  unown: [],
  pikachu: ["gmax"],
  eevee: ["gmax"],
  alcremie: ["gmax"],
  vivillon: [],
  minior: ["meteor"],
  furfrou: [],
  deerling: [],
  sawsbuck: [],
  floette: [],
  florges: [],
  flabebe: [],
  shellos: [],
  gastrodon: [],
  spinda: [],
  cherrim: [],
  keldeo: [],
  arceus: [], // 18 same-stat type plates -> keep base, type shown reflects held plate in-game anyway
  silvally: [],
  koraidon: [], // "build" forms are cosmetic ride-art only, not distinct in battle
  miraidon: [], // "mode" forms are cosmetic ride-art only, not distinct in battle
};

// Trial-exclusive "totem" forms and one-off battle gimmicks: not used in
// competitive play, and not present in Showdown's dex at all.
function isNonCompetitiveForm(formIdentifier) {
  return /totem|own-tempo/.test(formIdentifier);
}

function isCosmeticExtra(speciesIdentifier, formSuffix) {
  const keep = COSMETIC_FORM_KEEP[speciesIdentifier];
  if (keep === undefined) return false;
  if (!formSuffix) return false; // default form always kept
  return !keep.includes(formSuffix);
}

function showdownIdFor(identifier) {
  return identifier.replace(/-/g, "").toLowerCase();
}

// PokeAPI's pokemon_name field is truncated for these two (missing "Mane"/"Wings").
const FORM_LABEL_OVERRIDES = {
  "necrozma-dusk": "Dusk Mane Necrozma",
  "necrozma-dawn": "Dawn Wings Necrozma",
};

const SPECIAL_CASE_IDS = {
  "necrozma-dusk": "necrozmaduskmane",
  "necrozma-dawn": "necrozmadawnwings",
  "greninja-battle-bond": "greninjabond",
  "toxtricity-amped-gmax": "toxtricitygmax",
  "urshifu-single-strike-gmax": "urshifugmax",
  "maushold-family-of-three": "mausholdfour",
  "squawkabilly-blue-plumage": "squawkabillyblue",
  "squawkabilly-yellow-plumage": "squawkabillyyellow",
  "squawkabilly-white-plumage": "squawkabillywhite",
  "ogerpon-wellspring-mask": "ogerponwellspring",
  "ogerpon-hearthflame-mask": "ogerponhearthflame",
  "ogerpon-cornerstone-mask": "ogerponcornerstone",
  "meowstic-male-mega": "meowsticmmega",
  "meowstic-female-mega": "meowsticfmega",
};
// Cosmetic-default suffixes PokeAPI attaches even to a species' one-and-only
// competitive form; Showdown's id for these is just the bare species name.
const DEFAULT_SUFFIXES = [
  "normal", "incarnate", "plant", "altered", "land", "aria", "baile", "midday",
  "solo", "disguised", "amped", "full-belly", "average", "standard",
  "single-strike", "curly", "two-segment", "family-of-four", "zero",
  "green-plumage",
];

// Try several normalizations of a PokeAPI identifier to find the matching
// Showdown species id; returns the first one present in `byShowdownId`.
function resolveShowdownId(identifier, speciesIdentifier, isDefaultForm, byShowdownId) {
  const direct = showdownIdFor(identifier);
  if (byShowdownId.has(direct)) return direct;

  if (SPECIAL_CASE_IDS[identifier] && byShowdownId.has(SPECIAL_CASE_IDS[identifier])) {
    return SPECIAL_CASE_IDS[identifier];
  }

  if (isDefaultForm) {
    const bare = showdownIdFor(speciesIdentifier);
    if (byShowdownId.has(bare)) return bare;
  }

  for (const suffix of DEFAULT_SUFFIXES) {
    if (identifier.endsWith(`-${suffix}`)) {
      const stripped = showdownIdFor(identifier.slice(0, -(suffix.length + 1)));
      if (byShowdownId.has(stripped)) return stripped;
    }
  }

  if (identifier.endsWith("-female")) {
    const asF = showdownIdFor(identifier.slice(0, -"-female".length)) + "f";
    if (byShowdownId.has(asF)) return asF;
  }
  if (identifier.endsWith("-male")) {
    const stripped = showdownIdFor(identifier.slice(0, -"-male".length));
    if (byShowdownId.has(stripped)) return stripped;
  }

  if (identifier.endsWith("-breed")) {
    const stripped = showdownIdFor(identifier.slice(0, -"-breed".length));
    if (byShowdownId.has(stripped)) return stripped;
  }

  return direct; // fall through: caller records as unmatched
}

const SINGLES_TIER_ORDER = [
  "AG", "Uber", "OU", "UUBL", "UU", "RUBL", "RU", "NUBL", "NU", "PUBL", "PU", "ZUBL", "ZU",
];
const DOUBLES_TIER_ORDER = ["DUber", "DOU", "DBL", "DUU"];
const NATDEX_TIER_ORDER = ["AG", "Uber", "OU", "UUBL", "UU", "RUBL", "RU", "NUBL", "NU", "PUBL", "PU", "ZUBL", "ZU"];

function normalizeDoublesTier(t) {
  if (t === "(DUU)") return "DUU";
  return t;
}
function normalizeNatDexTier(t) {
  if (t === "(OU)") return "OU";
  return t;
}

async function main() {
  console.log("Fetching PokeAPI CSVs (cached after first run)...");
  const [
    pokemon,
    pokemonSpecies,
    speciesNames,
    pokemonForms,
    formNames,
    pokemonTypes,
    pokemonStats,
    abilities,
    abilityNames,
    abilityProse,
    pokemonAbilities,
    moves,
    moveNames,
    moveEffectProse,
    moveFlagMap,
    moveFlags,
    pokemonMoves,
    moveMethods,
    items,
    itemNames,
    itemProse,
    itemFlavorText,
  ] = await Promise.all([
    fetchCsv("pokemon"),
    fetchCsv("pokemon_species"),
    fetchCsv("pokemon_species_names"),
    fetchCsv("pokemon_forms"),
    fetchCsv("pokemon_form_names"),
    fetchCsv("pokemon_types"),
    fetchCsv("pokemon_stats"),
    fetchCsv("abilities"),
    fetchCsv("ability_names"),
    fetchCsv("ability_prose"),
    fetchCsv("pokemon_abilities"),
    fetchCsv("moves"),
    fetchCsv("move_names"),
    fetchCsv("move_effect_prose"),
    fetchCsv("move_flag_map"),
    fetchCsv("move_flags"),
    fetchCsv("pokemon_moves"),
    fetchCsv("pokemon_move_methods"),
    fetchCsv("items"),
    fetchCsv("item_names"),
    fetchCsv("item_prose"),
    fetchCsv("item_flavor_text"),
  ]);

  console.log("Joining Pokemon + forms...");
  const speciesById = toMap(pokemonSpecies, "id");
  const formsByPokemonId = groupBy(pokemonForms, "pokemon_id");
  const typesByPokemonId = groupBy(pokemonTypes, "pokemon_id");
  const statsByPokemonId = groupBy(pokemonStats, "pokemon_id");
  const abilitiesByPokemonId = groupBy(pokemonAbilities, "pokemon_id");

  const STAT_FIELD = {
    hp: "base_hp",
    attack: "base_atk",
    defense: "base_def",
    "special-attack": "base_spa",
    "special-defense": "base_spd",
    speed: "base_spe",
  };

  const outPokemon = [];
  for (const p of pokemon) {
    const species = speciesById.get(p.species_id);
    if (!species) continue;
    const forms = formsByPokemonId.get(p.id) || [];
    const form = forms[0]; // a pokemon row has exactly one form row in practice
    const formIdentifier = form?.form_identifier || "";
    // pokemon.csv's own is_default flags the species' canonical form (e.g. base
    // Miraidon, despite its form_identifier internally being "ultimate-mode").
    // pokemon_forms.is_default is a red herring: it's ~always "1" since each
    // pokemon_id has exactly one form row referencing itself.
    const isDefaultForm = p.is_default === "1";

    // Skip flooding-cosmetic variants, keeping only curated exceptions.
    if (!isDefaultForm && isCosmeticExtra(species.identifier, formIdentifier)) continue;
    if (!isDefaultForm && isNonCompetitiveForm(formIdentifier)) continue;

    const formNameRow = form
      ? formNames.find((r) => r.pokemon_form_id === form.id && r.local_language_id === EN)
      : null;

    const speciesDisplayName = englishName(speciesNames, "pokemon_species_id", species.id) || species.identifier;
    let formLabel = null;
    if (!isDefaultForm) {
      // PokeAPI's `pokemon_name` is usually the complete official name (e.g.
      // "Mega Charizard X"), but is sometimes truncated (e.g. Necrozma-Dusk's
      // pokemon_name omits "Mane"). Only trust it when it actually contains
      // the species name; otherwise build it from form_name + species.
      const pokemonName = formNameRow?.pokemon_name || null;
      const formNameOnly = formNameRow?.form_name || null;
      if (pokemonName && pokemonName.toLowerCase().includes(speciesDisplayName.toLowerCase())) {
        formLabel = pokemonName;
      } else if (formNameOnly) {
        formLabel = formNameOnly.toLowerCase().includes(speciesDisplayName.toLowerCase())
          ? formNameOnly
          : `${formNameOnly} ${speciesDisplayName}`;
      } else {
        formLabel = pokemonName || null;
      }
      if (!formLabel) {
        // Fallback: derive a readable label from the identifier, e.g. "charizard-mega-x" -> "Mega X"
        const suffix = p.identifier.replace(`${species.identifier}-`, "");
        formLabel = suffix
          .split("-")
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(" ");
      }
      if (FORM_LABEL_OVERRIDES[p.identifier]) formLabel = FORM_LABEL_OVERRIDES[p.identifier];
    }

    let formCategory = null;
    if (form?.is_mega === "1") formCategory = "mega";
    else if (/-gmax$/.test(p.identifier)) formCategory = "gmax";
    else if (/-alola/.test(p.identifier)) formCategory = "alolan";
    else if (/-galar/.test(p.identifier)) formCategory = "galarian";
    else if (/-hisui/.test(p.identifier)) formCategory = "hisuian";
    else if (/-paldea/.test(p.identifier)) formCategory = "paldean";
    else if (!isDefaultForm) formCategory = "other";

    const types = (typesByPokemonId.get(p.id) || []).sort((a, b) => a.slot - b.slot);
    const statRows = statsByPokemonId.get(p.id) || [];
    const statMap = {};
    for (const s of statRows) statMap[s.stat_id] = Number(s.base_stat);
    // stat_id 1..6 = hp,attack,defense,special-attack,special-defense,speed (fixed PokeAPI ordering)
    const STAT_ID_NAME = { 1: "hp", 2: "attack", 3: "defense", 4: "special-attack", 5: "special-defense", 6: "speed" };

    const row = {
      id: Number(p.id),
      species_id: Number(species.id),
      national_dex_number: Number(species.id) <= 100000 ? Number(species.id) : null,
      name: p.identifier,
      display_name: speciesDisplayName,
      form_label: formLabel,
      is_default_form: isDefaultForm ? 1 : 0,
      form_category: formCategory,
      generation: Number(species.generation_id),
      type1: null,
      type2: null,
      base_hp: 0,
      base_atk: 0,
      base_def: 0,
      base_spa: 0,
      base_spd: 0,
      base_spe: 0,
      height_dm: p.height ? Number(p.height) : null,
      weight_hg: p.weight ? Number(p.weight) : null,
      sprite_default: `${SPRITE_BASE}/${p.id}.png`,
      sprite_shiny: `${SPRITE_BASE}/shiny/${p.id}.png`,
      sprite_official_art: `${SPRITE_BASE}/other/official-artwork/${p.id}.png`,
      sprite_home: `${SPRITE_BASE}/other/home/${p.id}.png`,
      is_mega: form?.is_mega === "1" ? 1 : 0,
      is_gmax: /-gmax$/.test(p.identifier) ? 1 : 0,
      is_legendary: species.is_legendary === "1" ? 1 : 0,
      is_mythical: species.is_mythical === "1" ? 1 : 0,
      is_restricted: 0,
      showdown_id: null, // resolved after Showdown dex is loaded, below
      _rawIdentifier: p.identifier,
      _speciesIdentifier: species.identifier,
      _isDefaultForm: isDefaultForm,
      _abilities: (abilitiesByPokemonId.get(p.id) || []).map((a) => ({
        ability_id: Number(a.ability_id),
        slot: Number(a.slot),
        is_hidden: a.is_hidden === "1" ? 1 : 0,
      })),
    };
    for (const t of types) {
      const typeName = TYPE_ID_NAME[t.type_id];
      if (t.slot === "1") row.type1 = typeName;
      else if (t.slot === "2") row.type2 = typeName;
    }
    for (const [id, name] of Object.entries(STAT_ID_NAME)) {
      row[STAT_FIELD[name]] = statMap[id] ?? 0;
    }
    outPokemon.push(row);
  }

  console.log(`Kept ${outPokemon.length} pokemon/forms (of ${pokemon.length} raw rows)`);

  // --- Abilities ---
  console.log("Building abilities...");
  const outAbilities = abilities.map((a) => {
    const prose = abilityProse.find((r) => r.ability_id === a.id && r.local_language_id === EN);
    return {
      id: Number(a.id),
      name: a.identifier.replace(/-/g, ""),
      display_name: englishName(abilityNames, "ability_id", a.id) || a.identifier,
      short_effect: prose?.short_effect || null,
      effect: prose?.effect || null,
      generation: Number(a.generation_id),
    };
  });

  const outPokemonAbilities = [];
  for (const p of outPokemon) {
    for (const a of p._abilities) outPokemonAbilities.push({ pokemon_id: p.id, ...a });
    delete p._abilities;
  }

  // --- Moves ---
  console.log("Building moves...");
  const flagsByMoveId = groupBy(moveFlagMap, "move_id");
  const moveFlagName = toMap(moveFlags, "id");
  const outMoves = moves.map((m) => {
    const prose = moveEffectProse.find((r) => r.move_effect_id === m.effect_id && r.local_language_id === EN);
    const flags = (flagsByMoveId.get(m.id) || []).map((f) => moveFlagName.get(f.move_flag_id)?.identifier).filter(Boolean);
    return {
      id: Number(m.id),
      name: m.identifier.replace(/-/g, ""),
      display_name: englishName(moveNames, "move_id", m.id) || m.identifier,
      type: TYPE_ID_NAME[m.type_id] || null,
      category: DAMAGE_CLASS_ID_NAME[m.damage_class_id] || "status",
      power: m.power ? Number(m.power) : null,
      accuracy: m.accuracy ? Number(m.accuracy) : null,
      pp: m.pp ? Number(m.pp) : null,
      priority: Number(m.priority || 0),
      target: MOVE_TARGET_ID_NAME[m.target_id] || null,
      short_effect: prose?.short_effect || null,
      effect: prose?.effect || null,
      generation: Number(m.generation_id),
      is_zmove: 0,
      is_max_move: 0,
      flags: JSON.stringify(flags),
    };
  });

  // --- Items ---
  console.log("Building items...");
  const latestFlavorByItem = new Map();
  for (const r of itemFlavorText) {
    if (r.language_id !== EN) continue;
    const prev = latestFlavorByItem.get(r.item_id);
    if (!prev || Number(r.version_group_id) > Number(prev.version_group_id)) latestFlavorByItem.set(r.item_id, r);
  }
  const seenItemNames = new Set();
  const outItems = [];
  for (const it of items) {
    const name = it.identifier.replace(/-/g, "");
    // PokeAPI has a handful of genuine duplicate identifiers (e.g. two distinct
    // "roseli-berry" rows with different ids/costs) -- keep the first (lowest id).
    if (seenItemNames.has(name)) continue;
    seenItemNames.add(name);
    const prose = itemProse.find((r) => r.item_id === it.id && r.local_language_id === EN);
    const flavor = latestFlavorByItem.get(it.id);
    outItems.push({
      id: Number(it.id),
      name,
      display_name: englishName(itemNames, "item_id", it.id) || it.identifier,
      category: it.category_id || null,
      short_effect: prose?.short_effect || flavor?.flavor_text?.replace(/\n|\f/g, " ") || null,
      effect: prose?.effect || null,
      sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${it.identifier}.png`,
      generation: null,
    });
  }

  // --- Learnsets (current-gen version groups only) ---
  console.log("Building learnsets...");
  const validPokemonIds = new Set(outPokemon.map((p) => p.id));
  const methodName = toMap(moveMethods, "id");
  const learnsetKey = (pid, mid, method) => `${pid}|${mid}|${method}`;
  const learnsetMap = new Map();
  for (const pm of pokemonMoves) {
    if (!LEARNSET_VERSION_GROUPS.has(pm.version_group_id)) continue;
    if (!validPokemonIds.has(Number(pm.pokemon_id))) continue;
    const method = methodName.get(pm.pokemon_move_method_id)?.identifier || "other";
    const key = learnsetKey(pm.pokemon_id, pm.move_id, method);
    const level = pm.level ? Number(pm.level) : null;
    const existing = learnsetMap.get(key);
    if (!existing || (level !== null && (existing.level === null || level < existing.level))) {
      learnsetMap.set(key, {
        pokemon_id: Number(pm.pokemon_id),
        move_id: Number(pm.move_id),
        method,
        level,
        generation: 9,
      });
    }
  }
  const outLearnsets = [...learnsetMap.values()];

  // --- Showdown tiers -> formats + format_legality ---
  console.log("Matching Showdown tiers via @pkmn/dex...");
  const gen = Dex.forGen(9);
  const showdownSpecies = gen.species.all();
  const byShowdownId = toMap(showdownSpecies, "id");
  let matched = 0;
  const unmatched = [];
  const usedShowdownIds = new Set();
  for (const p of outPokemon) {
    const resolvedId = resolveShowdownId(p._rawIdentifier, p._speciesIdentifier, p._isDefaultForm, byShowdownId);
    p.showdown_id = usedShowdownIds.has(resolvedId) ? `${resolvedId}-dup${p.id}` : resolvedId;
    usedShowdownIds.add(p.showdown_id);
    delete p._rawIdentifier;
    delete p._speciesIdentifier;
    delete p._isDefaultForm;

    const sd = byShowdownId.get(resolvedId);
    if (sd) {
      matched++;
      p._tier = sd.tier;
      p._doublesTier = normalizeDoublesTier(sd.doublesTier);
      p._natDexTier = normalizeNatDexTier(sd.natDexTier);
    } else {
      unmatched.push(p.name);
    }
  }
  console.log(`Showdown tier match: ${matched}/${outPokemon.length} (${unmatched.length} unmatched)`);
  if (unmatched.length) {
    await writeFile(path.join(CACHE_DIR, "unmatched-showdown-ids.json"), JSON.stringify(unmatched, null, 2));
    console.log(`  -> unmatched names written to scripts/.cache/unmatched-showdown-ids.json`);
  }

  const formats = [];
  const formatLegality = [];
  let formatId = 1;

  function addTierFormat(code, name, order, tierField, isDoubles) {
    const fid = formatId++;
    formats.push({ id: fid, code, name, source: "showdown", generation: 9, is_doubles: isDoubles ? 1 : 0, ruleset: null });
    const rank = order.indexOf(tierField.target);
    for (const p of outPokemon) {
      const tier = tierField.get(p);
      if (!tier) continue;
      const tRank = order.indexOf(tier);
      if (tRank === -1) continue; // CAP/NFE/Illegal/etc - no independent tier, skip
      if (tRank >= rank) {
        formatLegality.push({ format_id: fid, pokemon_id: p.id, status: "allowed", tier, notes: null });
      }
    }
  }

  const singlesGet = (p) => p._tier;
  const doublesGet = (p) => p._doublesTier;
  const natDexGet = (p) => p._natDexTier;

  addTierFormat("gen9ubers", "Gen 9 Ubers", SINGLES_TIER_ORDER, { get: singlesGet, target: "Uber" }, false);
  addTierFormat("gen9ou", "Gen 9 OU", SINGLES_TIER_ORDER, { get: singlesGet, target: "OU" }, false);
  addTierFormat("gen9uu", "Gen 9 UU", SINGLES_TIER_ORDER, { get: singlesGet, target: "UU" }, false);
  addTierFormat("gen9ru", "Gen 9 RU", SINGLES_TIER_ORDER, { get: singlesGet, target: "RU" }, false);
  addTierFormat("gen9nu", "Gen 9 NU", SINGLES_TIER_ORDER, { get: singlesGet, target: "NU" }, false);
  addTierFormat("gen9pu", "Gen 9 PU", SINGLES_TIER_ORDER, { get: singlesGet, target: "PU" }, false);
  addTierFormat("gen9zu", "Gen 9 ZU", SINGLES_TIER_ORDER, { get: singlesGet, target: "ZU" }, false);
  addTierFormat("gen9lc", "Gen 9 LC", ["LC"], { get: singlesGet, target: "LC" }, false);
  addTierFormat("gen9doublesubers", "Gen 9 Doubles Ubers", DOUBLES_TIER_ORDER, { get: doublesGet, target: "DUber" }, true);
  addTierFormat("gen9doublesou", "Gen 9 Doubles OU", DOUBLES_TIER_ORDER, { get: doublesGet, target: "DOU" }, true);
  addTierFormat("gen9doublesuu", "Gen 9 Doubles UU", DOUBLES_TIER_ORDER, { get: doublesGet, target: "DUU" }, true);
  addTierFormat("gen9nationaldex", "Gen 9 National Dex", NATDEX_TIER_ORDER, { get: natDexGet, target: "Uber" }, false);
  addTierFormat("gen9nationaldexuu", "Gen 9 National Dex UU", NATDEX_TIER_ORDER, { get: natDexGet, target: "UU" }, false);

  // Official VGC / Pokemon Champions formats: curated per-regulation banlists aren't
  // encoded yet, so default to a conservative signal (mythicals banned, legendaries
  // flagged restricted) that you can refine per-regulation later in the app.
  const officialFormats = [
    { code: "champions-current", name: "Pokemon Champions (Current Series)" },
    { code: "vgc-current", name: "VGC (Current Regulation)" },
  ];
  for (const of of officialFormats) {
    const fid = formatId++;
    formats.push({ id: fid, code: of.code, name: of.name, source: "official", generation: 9, is_doubles: 1, ruleset: JSON.stringify({ note: "Mythicals banned by default; legendaries flagged restricted. Verify against the current regulation and adjust in-app." }) });
    for (const p of outPokemon) {
      if (!p.is_default_form && p.form_category !== "gmax") continue; // battle-only alt formes handled via base entry
      let status = "allowed";
      if (p.is_mythical) status = "banned";
      else if (p.is_legendary) status = "restricted";
      formatLegality.push({ format_id: fid, pokemon_id: p.id, status, tier: null, notes: null });
    }
  }

  for (const p of outPokemon) { delete p._tier; delete p._doublesTier; delete p._natDexTier; }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "pokemon.json"), JSON.stringify(outPokemon));
  await writeFile(path.join(OUT_DIR, "abilities.json"), JSON.stringify(outAbilities));
  await writeFile(path.join(OUT_DIR, "pokemon_abilities.json"), JSON.stringify(outPokemonAbilities));
  await writeFile(path.join(OUT_DIR, "moves.json"), JSON.stringify(outMoves));
  await writeFile(path.join(OUT_DIR, "items.json"), JSON.stringify(outItems));
  await writeFile(path.join(OUT_DIR, "learnsets.json"), JSON.stringify(outLearnsets));
  await writeFile(path.join(OUT_DIR, "formats.json"), JSON.stringify(formats));
  await writeFile(path.join(OUT_DIR, "format_legality.json"), JSON.stringify(formatLegality));

  console.log("Done. Wrote:");
  console.log(`  pokemon: ${outPokemon.length}`);
  console.log(`  abilities: ${outAbilities.length}`);
  console.log(`  pokemon_abilities: ${outPokemonAbilities.length}`);
  console.log(`  moves: ${outMoves.length}`);
  console.log(`  items: ${outItems.length}`);
  console.log(`  learnsets: ${outLearnsets.length}`);
  console.log(`  formats: ${formats.length}`);
  console.log(`  format_legality: ${formatLegality.length}`);
}

// --- static lookup tables (small, stable, not worth a network fetch) ---
const TYPE_ID_NAME = {
  1: "normal", 2: "fighting", 3: "flying", 4: "poison", 5: "ground", 6: "rock",
  7: "bug", 8: "ghost", 9: "steel", 10: "fire", 11: "water", 12: "grass",
  13: "electric", 14: "psychic", 15: "ice", 16: "dragon", 17: "dark", 18: "fairy",
  10001: "unknown", 10002: "shadow",
};
const DAMAGE_CLASS_ID_NAME = { 1: "status", 2: "physical", 3: "special" };
const MOVE_TARGET_ID_NAME = {
  1: "specific-move", 2: "selected-pokemon-me-first", 3: "ally",
  4: "users-field", 5: "user-or-ally", 6: "opponents-field", 7: "user",
  8: "random-opponent", 9: "all-other-pokemon", 10: "selected-pokemon",
  11: "all-opponents", 12: "entire-field", 13: "user-and-allies",
  14: "all-pokemon", 15: "all-allies", 16: "fainting-pokemon",
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
