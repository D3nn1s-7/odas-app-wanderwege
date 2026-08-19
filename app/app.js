/*
 * Wanderwege – App-Logik
 *
 * Funktion: app(configdata, enclosingHtmlDivElement)
 *  - Ort, Umkreis und Kategorie (Radweg/Fußwanderweg/Sonstige touristische
 *    Wege) sind fest in der Instanz-Konfiguration hinterlegt (ort, radiusKm,
 *    kategorie) — keine Suchmaske im UI. Beim Erstaufruf laedt die App den
 *    konfigurierten Ausschnitt automatisch aus der DZT-Knowledge-Graph-API.
 *  - Suche laeuft per SPARQL (ein Request liefert Name, Laenge, Schwierigkeit,
 *    Dauer, Rundweg-Kennzeichen, Art und einen Referenzpunkt je Treffer);
 *    verbleibende Filter (Schwierigkeit, Laenge, Rundweg) bleiben im UI
 *    einstellbar.
 *  - Die Detailansicht laedt bei Bedarf den vollen Datensatz eines Wegs
 *    (GET /v2/kg/things/{id}) und zeichnet die Strecke als Polyline auf der
 *    Karte sowie – wenn Hoehendaten vorhanden sind – ein Hoehenprofil.
 *  - Datenlage (gemessen 2026-08-19, siehe Projektplan): Streckengeometrie
 *    100 %, Laenge/Schwierigkeit ~100 %, Dauer ~67 %. Sperrstatus,
 *    Ausruestung, Betreuer, Gipfelpunkte werden von keinem Anbieter befuellt
 *    (0 %) und sind daher nicht Teil der Detailansicht.
 *  - Zustand ueberlebt Seitenwechsel: onPageLeave() baut nur DOM-gebundene
 *    Laufzeitressourcen (Karte, Chart, laufender Fetch) ab, der Eintrag in
 *    wwInstances bleibt erhalten. Kehrt app() zu einer bereits bekannten
 *    Instanz zurueck, wird aus dem Cache neu gerendert statt neu geladen
 *    (siehe app(), "Resume"-Zweig).
 *
 * Sicherheitshinweis (siehe README): Der DZT-API-Key liegt in der
 * Instanz-Konfiguration und ist damit oeffentlich lesbar, weil ODAS-Apps
 * ihre Konfiguration ueber einen anonymen fetch laden. Diese App ist daher
 * nicht fuer den ODAS-Live-Betrieb vorgesehen.
 */

// F-42-Muster: Instanzzaehler auf Modulebene, Laufzeitzustand pro Instanz im
// von app() erzeugten state-Objekt. wwInstances haelt den Eintrag bewusst
// auch nach onPageLeave() weiter (siehe dort) — nur so kann app() bei einer
// Rueckkehr zur Startseite ohne erneuten Netzwerk-Request neu rendern.
let wwInstanzZaehler = 0;
const wwInstances = new Map();

function onPageLeave(page) {
  wwInstances.forEach((state) => {
    state.disposed = true;
    if (state.searchAbortController) state.searchAbortController.abort();
    if (state.map) {
      try {
        state.map.remove();
      } catch (error) {
        console.warn("Fehler beim Entfernen der Leaflet-Karte:", error);
      }
      state.map = null;
    }
    state.markerLayer = null;
    state.detailPolylineLayer = null;
    if (state.elevationChart) {
      try {
        state.elevationChart.destroy();
      } catch (error) {
        console.warn("Fehler beim Entfernen des Hoehenprofils:", error);
      }
      state.elevationChart = null;
    }
    // Der Eintrag selbst (allTrails, filteredTrails, filters, center,
    // detailCache, searchCompleted, statusMessage, …) bleibt in wwInstances
    // erhalten — siehe Kommentar oben.
  });
}

// ---------------------------------------------------------------------------
// Konstanten: DZT-Knowledge-Graph-Vokabular
// ---------------------------------------------------------------------------

const TRAIL_DS = "https://semantify.it/ds/hSsrCTQowvYH";

// Unterkuenfte (u.a. Campingplaetze, Wohnmobilstellplaetze) und Gastronomie
// fuer die KI-Routenplanung (Grounding-Anreicherung). Lodging-ID verifiziert
// 2026-08-19 per SPARQL (ds:compliesWith auf einem realen Stellplatz-Entity);
// Gastronomie-ID stammt aus derselben DZT-Dokumentation, aber (noch) nicht
// eigenstaendig per SPARQL nachgemessen.
const LODGING_DS = "https://semantify.it/ds/xVTuYwJrJrfq";
const GASTRONOMY_DS = "https://semantify.it/ds/zmoYZEMoSAKS";

const P = {
  name: "https://schema.org/name",
  description: "https://schema.org/description",
  image: "https://schema.org/image",
  geo: "https://schema.org/geo",
  line: "https://schema.org/line",
  latitude: "https://schema.org/latitude",
  longitude: "https://schema.org/longitude",
  contentUrl: "https://schema.org/contentUrl",
  copyrightNotice: "https://schema.org/copyrightNotice",
  license: "https://schema.org/license",
  sdLicense: "https://schema.org/sdLicense",
  author: "https://schema.org/author",
  url: "https://schema.org/url",
  value: "https://schema.org/value",
  address: "https://schema.org/address",
  addressLocality: "https://schema.org/addressLocality",
  streetAddress: "https://schema.org/streetAddress",
  circularTrail: "https://odta.io/voc/circularTrail",
  difficulty: "https://odta.io/voc/difficulty",
  length: "https://odta.io/voc/length",
  uphillElevation: "https://odta.io/voc/uphillElevation",
  downhillElevation: "https://odta.io/voc/downhillElevation",
  estimatedDuration: "https://odta.io/voc/estimatedDuration",
  startLocation: "https://odta.io/voc/startLocation",
  endLocation: "https://odta.io/voc/endLocation",
};

// Gemessen 2026-08-19 (679 Wege im 50-km-Testradius): odta:kindOfTrail wird
// von keinem Anbieter befuellt. Die Art steckt im @type-Array. Priorität
// Rad > Wandern > Sonstige, weil Bike-/Hike-Typen in der Praxis nicht
// gemeinsam auf einem Weg vorkommen.
const TRAIL_GROUP_RAD = new Set([
  "BikeTourTrail",
  "LongDistanceBikeTourTrail",
  "MountainBikeTourTrail",
  "RacingBikeTourTrail",
]);
const TRAIL_GROUP_WANDERN = new Set([
  "HikingTrail",
  "LongDistanceHikeTrail",
  "AlpineTourTrail",
  "MountaineeringTrail",
  "PilgrimageTrail",
  "PanoramaTrail",
  "SightseeingTrail",
  "ThematicTrail",
  "NordicWalkingTrail",
  "TrailRunning",
  "JoggingTrail",
  "WalkingAndSkatingTrail",
  "InlineSkatingTrail",
]);
const TRAIL_GROUP_LABELS = {
  rad: "Radweg",
  wandern: "Fußwanderweg",
  sonstige: "Sonstige touristische Wege",
};
// Bildet den in der Instanz-Konfiguration gewaehlten Kategorie-Wert
// (instanz-config "kategorie") auf die interne Gruppe ab, die
// classifyTypeGroup() aus den @type-Werten der Suchtreffer ableitet.
const KATEGORIE_TO_GROUP = {
  "Radweg": "rad",
  "Fußwanderweg": "wandern",
  "Sonstige touristische Wege": "sonstige",
};
const DIFFICULTY_ORDER = ["Leicht", "Mittel", "Schwer"];
const DEFAULT_RADIUS_KM = 25;
const LENGTH_BUCKETS = [
  { id: "", label: "Beliebige Länge", min: 0, max: Infinity },
  { id: "kurz", label: "bis 5 km", min: 0, max: 5 },
  { id: "mittel", label: "5–15 km", min: 5, max: 15 },
  { id: "lang", label: "15–30 km", min: 15, max: 30 },
  { id: "sehrlang", label: "über 30 km", min: 30, max: Infinity },
];
const KPI_CONTEXT = {
  count:
    "Gezählt werden Wege, deren Streckenverlauf den konfigurierten Umkreis kreuzt – auch wenn der markierte Startpunkt (etwa bei mehrteiligen Fernwegen) außerhalb liegt.",
  totalLength: "Summe der Streckenlängen aller aktuell angezeigten Wege.",
  circular: "Wege, die zum Ausgangspunkt zurückführen.",
};

// === KI-Routenplanung ===
// Fest im Code hinterlegte, kategorieabhaengige Vorschlagsfragen (auf
// ausdruecklichen Wunsch nicht konfigurierbar). "sonstige" dient zugleich als
// Fallback fuer Gruppen ohne eigene Liste.
const AI_PROMPT_PRESETS = {
  rad: ["Wo gibt es Rastplätze oder Einkehrmöglichkeiten entlang der Strecke?", "Ist die Route für E-Bikes geeignet?"],
  wandern: ["Wo kann ich auf dieser Route rasten oder einkehren?", "Was sollte ich für diese Tour einpacken?"],
  sonstige: [
    "Welche Wohnmobilstellplätze gibt es entlang der Route? Was kosten sie? Sind Hunde erlaubt?",
    "Welche Sehenswürdigkeiten liegen auf dem Weg?",
  ],
};
const AI_GROUNDING_RADIUS_KM = 8;
const AI_HISTORY_LIMIT = 20; // Nachrichten, nicht Zeichen — Deckel gegen unbegrenztes Prompt-Wachstum
const AI_SESSION_KEY_PREFIX = "ww-ai-";

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

function app(configdata = {}, enclosingHtmlDivElement) {
  const cached = wwInstances.get(enclosingHtmlDivElement);

  if (cached) {
    // Rueckkehr zur Startseite derselben Instanz: state bleibt erhalten,
    // nur das DOM (von der zwischenzeitlich gezeigten Seite ueberschrieben)
    // und die davon abgeleiteten Laufzeitressourcen (Karte, Chart) werden
    // neu aufgebaut. Kein erneuter Netzwerk-Request, wenn die urspruengliche
    // Suche bereits abgeschlossen war.
    cached.disposed = false;
    cached.root = enclosingHtmlDivElement;
    cached.config = configdata;
    mountShell(cached);

    if (cached.searchCompleted) {
      if (cached.statusMessage) showStatus(cached, cached.statusMessage.text, cached.statusMessage.kind);
      applyFilters(cached); // rendert KPIs/Liste/Karte aus dem Cache
    } else {
      // Der urspruengliche Suchlauf wurde durch einen Seitenwechsel
      // unterbrochen (onPageLeave() bricht laufende Fetches ab) und nie
      // abgeschlossen — erneut versuchen, statt dauerhaft leer zu bleiben.
      renderMap(cached);
      initSearchFromConfig(cached);
    }
    return;
  }

  const state = {
    uid: "i" + ++wwInstanzZaehler,
    root: enclosingHtmlDivElement,
    config: configdata,
    disposed: false,
    lang: String(configdata.standardSprache || "de").trim() || "de",
    center: null, // [lat, lon]
    centerLabel: "",
    radiusKm: DEFAULT_RADIUS_KM,
    lockedGroup: "",
    allTrails: [],
    filteredTrails: [],
    filters: { group: "", difficulty: "", lengthBucket: "", circularOnly: false },
    availableDifficulties: [],
    map: null,
    markerLayer: null,
    detailPolylineLayer: null,
    elevationChart: null,
    detailCache: new Map(),
    openDetailId: null,
    page: 0,
    pageSize: 10,
    searchAbortController: null,
    hitLimit: false,
    statusMessage: null,
    searchCompleted: false,
    aiChat: { open: false, trailId: null, sending: false },
    aiMessagesByTrail: new Map(),
    aiGroundingPromises: new Map(),
  };
  wwInstances.set(enclosingHtmlDivElement, state);

  mountShell(state);
  renderMap(state); // leere Deutschlandkarte als Ausgangszustand
  initSearchFromConfig(state);
}

function mountShell(state) {
  state.root.innerHTML = renderShell(state);
  bindFilterControls(state);
  bindListControls(state);
  restoreFilterControls(state);
  renderSchale4Blocks(state);
  renderErklaerText(state);
  bindAiModalControls(state);
}

// ---------------------------------------------------------------------------
// Shell / Rendering
// ---------------------------------------------------------------------------

function renderShell(state) {
  const u = state.uid;

  return `
    <section id="ww-app-${u}" class="ww-app">
      <div id="ww-erklaer-${u}" class="ww-erklaer-text"></div>

      <div id="ww-search-status-${u}" class="ww-search-status" role="status" aria-live="polite"></div>

      <div id="ww-schale4-top-${u}" class="ww-schale4-top"></div>

      <div id="ww-kpi-${u}" class="ww-kpi-grid"></div>

      <div class="ww-toolbar mb-3">
        <select id="ww-filter-difficulty-${u}" class="form-select ww-filter-select">
          <option value="">Alle Schwierigkeiten</option>
        </select>
        <select id="ww-filter-length-${u}" class="form-select ww-filter-select">
          ${LENGTH_BUCKETS.map((b) => `<option value="${b.id}">${escapeHtml(b.label)}</option>`).join("")}
        </select>
        <div class="form-check ww-filter-check">
          <input class="form-check-input" type="checkbox" id="ww-filter-circular-${u}">
          <label class="form-check-label" for="ww-filter-circular-${u}">Nur Rundwege</label>
        </div>
        <span id="ww-filter-count-${u}" class="ww-filter-count"></span>
      </div>

      <div class="ww-map-wrap">
        <div id="ww-map-${u}" class="ww-map"></div>
      </div>

      <div id="ww-list-${u}" class="ww-list-group"></div>
      <nav id="ww-pager-${u}" class="ww-pager"></nav>

      <div id="ww-schale4-bottom-${u}" class="ww-schale4-bottom"></div>

      ${renderAiModal(state)}
    </section>
  `;
}

function renderAiModal(state) {
  const u = state.uid;
  return `
    <div id="ww-ai-modal-${u}" class="ww-ai-modal" hidden>
      <div class="ww-ai-modal-backdrop" data-ai-close></div>
      <div class="ww-ai-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="ww-ai-modal-title-${u}">
        <div class="ww-ai-modal-header">
          <h2 id="ww-ai-modal-title-${u}" class="ww-ai-modal-title">KI Routenplanung</h2>
          <button type="button" class="ww-ai-modal-close" data-ai-close aria-label="Schließen">&times;</button>
        </div>
        <div class="ww-ai-modal-body">
          <label class="ww-ai-route-label" for="ww-ai-route-select-${u}">Route</label>
          <select id="ww-ai-route-select-${u}" class="form-select ww-ai-route-select"></select>

          <div class="alert alert-warning ww-ai-disclaimer" role="alert">
            KI-Antworten können ungenau sein. Bitte Preise, Öffnungszeiten und Regelungen vor Ort prüfen.
          </div>

          <div id="ww-ai-messages-${u}" class="ww-ai-messages"></div>
          <div id="ww-ai-status-${u}" class="ww-ai-status" role="status" aria-live="polite"></div>
          <div id="ww-ai-presets-${u}" class="ww-ai-presets"></div>

          <div class="ww-ai-input-row">
            <textarea id="ww-ai-input-${u}" class="form-control ww-ai-input" rows="2" placeholder="Eigene Frage stellen …"></textarea>
            <button type="button" id="ww-ai-send-${u}" class="btn btn-primary ww-ai-send">Senden</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderErklaerText(state) {
  const u = state.uid;
  const el = state.root.querySelector(`#ww-erklaer-${u}`);
  if (!el) return;
  const ort = String(state.config.ort || "").trim();
  const kategorieLabel = String(state.config.kategorie || "").trim();
  const radius = Number(state.config.radiusKm) || DEFAULT_RADIUS_KM;
  if (!ort || !kategorieLabel) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<p class="ww-erklaer-p">Diese Karte zeigt ${escapeHtml(kategorieLabel)} im Umkreis von ` +
    `${escapeHtml(String(radius))} km um ${escapeHtml(ort)}. Die Wege werden live aus dem ` +
    `Knowledge Graph der Deutschen Zentrale für Tourismus abgerufen.</p>`;
}

// ---------------------------------------------------------------------------
// Suche: konfigurierter Ort/Umkreis/Kategorie -> Geocoding -> SPARQL
// ---------------------------------------------------------------------------

// Loest beim Erstaufruf einer Instanz automatisch den konfigurierten
// Ausschnitt auf und laedt ihn. Liefert kein UI-Suchfeld mehr — Ort, Umkreis
// und Kategorie sind Redaktionssache (instanz-config), nicht Nutzer:innensache.
async function initSearchFromConfig(state) {
  const missing = missingSourceReason(state.config);
  if (missing) {
    showStatus(state, missing, "info");
    state.searchCompleted = true; // ohne Config-Aenderung gibt es nichts zu wiederholen
    return;
  }

  const ort = String(state.config.ort || "").trim();
  const kategorieLabel = String(state.config.kategorie || "").trim();
  state.lockedGroup = KATEGORIE_TO_GROUP[kategorieLabel] || "wandern";
  state.filters.group = state.lockedGroup;
  state.radiusKm = Number(state.config.radiusKm) || DEFAULT_RADIUS_KM;

  showStatus(state, `Wege im Umkreis von ${state.radiusKm} km um „${ort}" werden geladen …`, "loading");

  let coords;
  try {
    coords = await geocodeAddress(ort);
  } catch (error) {
    if (state.disposed) return; // Seite verlassen, waehrend Geocoding lief: naechster Resume versucht es erneut
    console.error("Geocoding fehlgeschlagen:", error);
    showStatus(state, "Die Ortssuche ist fehlgeschlagen. Bitte später erneut versuchen.", "error");
    state.searchCompleted = true;
    return;
  }
  if (state.disposed) return;

  if (!coords) {
    showStatus(
      state,
      `Der konfigurierte Ort „${ort}" konnte nicht gefunden werden. Bitte in der Instanzkonfiguration prüfen.`,
      "info",
    );
    state.searchCompleted = true;
    return;
  }

  state.centerLabel = ort;
  state.searchCompleted = await runSearch(state, coords, ort);
}

async function geocodeAddress(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const lat = Number(payload[0].lat);
  const lon = Number(payload[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

// Liefert true, wenn die Suche wirklich abgeschlossen wurde (Erfolg, leeres
// Ergebnis oder ein definitiver Fehler) und false, wenn sie durch einen
// Seitenwechsel abgebrochen wurde — dann soll ein spaeterer Resume es erneut
// versuchen, statt den Umkreis dauerhaft leer zu lassen.
async function runSearch(state, center, label) {
  if (state.disposed) return false;
  state.center = center;
  state.centerLabel = label || "";
  state.page = 0;

  if (state.searchAbortController) state.searchAbortController.abort();
  const controller = new AbortController();
  state.searchAbortController = controller;

  showStatus(state, `Wege im Umkreis von ${state.radiusKm} km um „${state.centerLabel}" werden geladen …`, "loading");

  let json;
  try {
    const query = buildTrailSearchSparql(center[0], center[1], state.radiusKm);
    json = await fetchSparql(query, state.config, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return false;
    console.error("Wegsuche fehlgeschlagen:", error);
    showStatus(state, error.message || "Die Wegsuche ist fehlgeschlagen.", "error");
    return true;
  }
  if (controller.signal.aborted || state.disposed) return false;

  const rows = json?.results?.bindings || [];
  state.hitLimit = rows.length >= 950;
  state.allTrails = parseSparqlTrailRows(rows, state.lang);

  if (state.allTrails.length === 0) {
    showStatus(state, `Keine Wege im Umkreis von ${state.radiusKm} km um „${state.centerLabel}" gefunden.`, "info");
  } else {
    showStatus(state, "", "clear");
  }

  computeAvailableFacets(state);
  renderFilterOptions(state);
  applyFilters(state);
  return true;
}

function buildTrailSearchSparql(lat, lon, radiusKm) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  const radius = `${Math.max(1, Math.round(Number(radiusKm) || DEFAULT_RADIUS_KM))}km`;
  const geoShapeJson = JSON.stringify({
    query: {
      geo_shape: {
        geometry: {
          shape: { type: "circle", radius, coordinates: [lonNum, latNum] },
          relation: "intersects",
        },
      },
    },
  });
  const geoShapeLiteral = JSON.stringify(geoShapeJson);

  return `PREFIX inst: <http://www.ontotext.com/connectors/elasticsearch/instance#>
PREFIX con: <http://www.ontotext.com/connectors/elasticsearch#>
PREFIX schema: <https://schema.org/>
PREFIX odta: <https://odta.io/voc/>
PREFIX ds: <https://vocab.sti2.at/ds/>

SELECT ?id ?name ?length ?diffName ?duration ?circ ?type ?startLat ?startLon WHERE {
  ?search a inst:dzt-geo-shapes ;
    con:query ${geoShapeLiteral} ;
    con:entities ?geoent .
  ?geoent ds:compliesWith <${TRAIL_DS}> ; schema:geo ?geo .
  ?geo a schema:GeoShape .
  BIND(?geoent AS ?id)
  OPTIONAL { ?geoent schema:name ?name }
  OPTIONAL { ?geoent odta:length/schema:value ?length }
  OPTIONAL { ?geoent odta:difficulty/schema:name ?diffName }
  OPTIONAL { ?geoent odta:estimatedDuration/schema:name ?duration }
  OPTIONAL { ?geoent odta:circularTrail ?circ }
  OPTIONAL { ?geoent a ?type }
  OPTIONAL {
    ?geoent odta:startLocation ?startLoc .
    ?startLoc schema:geo ?startGeo .
    ?startGeo schema:latitude ?startLat ; schema:longitude ?startLon .
  }
}
LIMIT 1000`;
}

function parseSparqlTrailRows(rows, preferredLang) {
  const byId = new Map();
  for (const row of rows) {
    const id = row.id && row.id.value;
    if (!id) continue;
    let entry = byId.get(id);
    if (!entry) {
      entry = {
        id,
        names: [],
        length: null,
        difficulty: "",
        durationIso: "",
        circular: null,
        types: new Set(),
        startLat: null,
        startLon: null,
      };
      byId.set(id, entry);
    }
    if (row.name) entry.names.push({ value: row.name.value, lang: row.name["xml:lang"] || "" });
    if (row.length && entry.length == null) entry.length = Number(row.length.value);
    if (row.diffName && !entry.difficulty) entry.difficulty = row.diffName.value;
    if (row.duration && !entry.durationIso) entry.durationIso = row.duration.value;
    if (row.circ && entry.circular == null) entry.circular = row.circ.value === "true";
    if (row.type) entry.types.add(row.type.value);
    if (row.startLat && entry.startLat == null) entry.startLat = Number(row.startLat.value);
    if (row.startLon && entry.startLon == null) entry.startLon = Number(row.startLon.value);
  }

  return Array.from(byId.values()).map((e) => {
    const types = Array.from(e.types);
    return {
      id: e.id,
      name: pickPreferredName(e.names, preferredLang) || "(ohne Namen)",
      lengthKm: e.length != null && Number.isFinite(e.length) ? e.length / 1000 : null,
      difficulty: e.difficulty,
      durationIso: e.durationIso,
      durationText: formatIsoDuration(e.durationIso),
      circular: e.circular,
      types,
      group: classifyTypeGroup(types),
      startLat: Number.isFinite(e.startLat) ? e.startLat : null,
      startLon: Number.isFinite(e.startLon) ? e.startLon : null,
    };
  });
}

function pickPreferredName(names, preferredLang) {
  const withLang = names.find((n) => n.lang === preferredLang);
  if (withLang) return withLang.value;
  const german = names.find((n) => n.lang === "de");
  if (german) return german.value;
  return names.length ? names[0].value : "";
}

function classifyTypeGroup(typeUris) {
  const local = typeUris.map((t) => t.replace("https://odta.io/voc/", ""));
  if (local.some((t) => TRAIL_GROUP_RAD.has(t))) return "rad";
  if (local.some((t) => TRAIL_GROUP_WANDERN.has(t))) return "wandern";
  return "sonstige";
}

function formatIsoDuration(iso) {
  if (!iso) return "";
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso);
  if (!m) return "";
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  if (!h && !min) return "";
  return [h ? `${h} Std` : "", min ? `${min} Min` : ""].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Facetten / Filter
// ---------------------------------------------------------------------------

function computeAvailableFacets(state) {
  const difficulties = new Set();
  for (const t of state.allTrails) {
    if (t.difficulty) difficulties.add(t.difficulty);
  }
  state.availableDifficulties = DIFFICULTY_ORDER.filter((d) => difficulties.has(d));
}

function renderFilterOptions(state) {
  const u = state.uid;
  const diffSel = state.root.querySelector(`#ww-filter-difficulty-${u}`);
  if (!diffSel) return;

  diffSel.innerHTML =
    `<option value="">Alle Schwierigkeiten</option>` +
    state.availableDifficulties.map((d) => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("");
}

// Stellt nach einem Neuaufbau der Shell (renderShell()) die zuvor gewaehlten
// Filterwerte wieder her — Difficulty-Optionen kommen aus dem Cache
// (state.availableDifficulties), nicht aus einem erneuten Suchlauf.
function restoreFilterControls(state) {
  renderFilterOptions(state);
  const u = state.uid;
  const diffSel = state.root.querySelector(`#ww-filter-difficulty-${u}`);
  const lengthSel = state.root.querySelector(`#ww-filter-length-${u}`);
  const circularCheck = state.root.querySelector(`#ww-filter-circular-${u}`);
  if (diffSel) diffSel.value = state.filters.difficulty;
  if (lengthSel) lengthSel.value = state.filters.lengthBucket;
  if (circularCheck) circularCheck.checked = state.filters.circularOnly;
}

function bindFilterControls(state) {
  const u = state.uid;
  const root = state.root;
  root.querySelector(`#ww-filter-difficulty-${u}`).addEventListener("change", (e) => {
    state.filters.difficulty = e.target.value;
    state.page = 0;
    applyFilters(state);
  });
  root.querySelector(`#ww-filter-length-${u}`).addEventListener("change", (e) => {
    state.filters.lengthBucket = e.target.value;
    state.page = 0;
    applyFilters(state);
  });
  root.querySelector(`#ww-filter-circular-${u}`).addEventListener("change", (e) => {
    state.filters.circularOnly = e.target.checked;
    state.page = 0;
    applyFilters(state);
  });
}

function bindListControls(state) {
  const u = state.uid;
  state.root.querySelector(`#ww-pager-${u}`).addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn) return;
    state.page = Number(btn.getAttribute("data-page"));
    renderList(state);
  });
}

function applyFilters(state) {
  const f = state.filters;
  const bucket = LENGTH_BUCKETS.find((b) => b.id === f.lengthBucket) || LENGTH_BUCKETS[0];

  state.filteredTrails = state.allTrails.filter((t) => {
    if (f.group && t.group !== f.group) return false;
    if (f.difficulty && t.difficulty !== f.difficulty) return false;
    if (f.circularOnly && t.circular !== true) return false;
    if (bucket.id) {
      const km = t.lengthKm;
      if (km == null || km < bucket.min || km >= bucket.max) return false;
    }
    return true;
  });

  renderKpis(state);
  renderList(state);
  renderMap(state);
  const u = state.uid;
  const countEl = state.root.querySelector(`#ww-filter-count-${u}`);
  if (countEl) {
    countEl.textContent = state.allTrails.length
      ? `${state.filteredTrails.length} von ${state.allTrails.length} Wegen`
      : "";
  }
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

function renderKpis(state) {
  const u = state.uid;
  const el = state.root.querySelector(`#ww-kpi-${u}`);
  if (!state.allTrails.length) {
    el.innerHTML = "";
    return;
  }
  const filtered = state.filteredTrails;
  const totalLengthKm = filtered.reduce((sum, t) => sum + (t.lengthKm || 0), 0);
  const circularCount = filtered.filter((t) => t.circular === true).length;

  const tiles = [
    { id: "count", label: "Gefundene Wege", value: filtered.length.toLocaleString("de-DE"), ctx: KPI_CONTEXT.count },
    {
      id: "totalLength",
      label: "Gesamtlänge",
      value: `${totalLengthKm.toLocaleString("de-DE", { maximumFractionDigits: 0 })} km`,
      ctx: KPI_CONTEXT.totalLength,
    },
    { id: "circular", label: "Rundwege", value: circularCount.toLocaleString("de-DE"), ctx: KPI_CONTEXT.circular },
  ];

  el.innerHTML = tiles
    .map(
      (t) => `
      <div class="ww-kpi-card">
        <div class="ww-kpi-value-row">
          <div class="ww-kpi-value">${t.value}</div>
          <button type="button" class="ww-kpi-info-toggle" data-ww-kpi-toggle="${t.id}-${u}" aria-expanded="false" title="Erläuterung anzeigen">ⓘ</button>
        </div>
        <div class="ww-kpi-label">${escapeHtml(t.label)}</div>
        <div class="ww-kpi-context" id="ww-kpi-context-${t.id}-${u}" hidden>${escapeHtml(t.ctx)}</div>
      </div>`,
    )
    .join("");

  el.querySelectorAll("[data-ww-kpi-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-ww-kpi-toggle");
      const box = el.querySelector(`#ww-kpi-context-${key}`);
      if (!box) return;
      const open = !box.hidden;
      box.hidden = open;
      btn.setAttribute("aria-expanded", String(!open));
    });
  });
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

function renderList(state) {
  const u = state.uid;
  const list = state.root.querySelector(`#ww-list-${u}`);
  const pager = state.root.querySelector(`#ww-pager-${u}`);
  const trails = state.filteredTrails;
  const start = state.page * state.pageSize;
  const slice = trails.slice(start, start + state.pageSize);

  if (!state.allTrails.length) {
    list.innerHTML = "";
    pager.innerHTML = "";
    return;
  }
  if (trails.length === 0) {
    list.innerHTML = `<div class="ww-empty">Keine Treffer für die aktuelle Filterauswahl.</div>`;
    pager.innerHTML = "";
    return;
  }

  const limitNotice = state.hitLimit
    ? `<div class="alert alert-warning ww-limit-notice" role="alert">Sehr viele Treffer im gewählten Umkreis – die Liste ist möglicherweise unvollständig. Kleineren Umkreis wählen.</div>`
    : "";

  list.innerHTML =
    limitNotice +
    `<div class="ww-list-group">` +
    slice
      .map((t) => {
        const lengthText = t.lengthKm != null ? `${t.lengthKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : "";
        const meta = [
          TRAIL_GROUP_LABELS[t.group] || t.group,
          t.difficulty,
          lengthText,
          t.durationText,
          t.circular === true ? "Rundweg" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `
          <div class="ww-list-item-wrap" data-trail-id="${escapeAttr(t.id)}">
            <button type="button" class="ww-list-item" data-trail-id="${escapeAttr(t.id)}">
              <div class="ww-list-body">
                <div class="ww-list-title">${escapeHtml(t.name)}</div>
                <div class="ww-list-meta">${escapeHtml(meta)}</div>
              </div>
              <svg class="ww-list-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <div class="ww-list-detail" hidden></div>
          </div>`;
      })
      .join("") +
    `</div>`;

  list.querySelectorAll(".ww-list-item").forEach((el) => {
    el.addEventListener("click", () => toggleDetail(state, el.getAttribute("data-trail-id")));
  });

  const totalPages = Math.max(1, Math.ceil(trails.length / state.pageSize));
  if (totalPages <= 1) {
    pager.innerHTML = `<span class="ww-pager-info">Seite ${state.page + 1} / ${totalPages}</span>`;
    return;
  }
  pager.innerHTML =
    `<button type="button" class="ww-pager-btn" data-page="${Math.max(0, state.page - 1)}" ${state.page === 0 ? "disabled" : ""}>‹</button>` +
    `<span class="ww-pager-info">Seite ${state.page + 1} / ${totalPages}</span>` +
    `<button type="button" class="ww-pager-btn" data-page="${Math.min(totalPages - 1, state.page + 1)}" ${state.page >= totalPages - 1 ? "disabled" : ""}>›</button>`;
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "vendor/leaflet/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "vendor/leaflet/leaflet.js";
    script.onload = () => {
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
        iconUrl: "vendor/leaflet/images/marker-icon.png",
        shadowUrl: "vendor/leaflet/images/marker-shadow.png",
      });
      resolve();
    };
    script.onerror = () => reject(new Error("Leaflet konnte nicht geladen werden"));
    document.head.appendChild(script);
  });
  return leafletLoading;
}

function boundsForRadius(center, radiusKm) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((center[0] * Math.PI) / 180));
  return L.latLngBounds(
    [center[0] - latDelta, center[1] - lonDelta],
    [center[0] + latDelta, center[1] + lonDelta],
  );
}

function renderMap(state) {
  loadLeaflet()
    .then(() => {
      if (state.disposed) return;
      const u = state.uid;
      const el = state.root.querySelector(`#ww-map-${u}`);
      if (!el) return;
      if (!state.map) {
        state.map = L.map(el, { scrollWheelZoom: true }).setView([51.1657, 10.4515], 6);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap-Mitwirkende",
          maxZoom: 18,
        }).addTo(state.map);
        state.markerLayer = L.layerGroup().addTo(state.map);
      }
      state.markerLayer.clearLayers();

      for (const t of state.filteredTrails) {
        if (t.startLat == null || t.startLon == null) continue;
        const marker = L.marker([t.startLat, t.startLon]).bindPopup(
          `<strong>${escapeHtml(t.name)}</strong><br><span class="small">${escapeHtml(TRAIL_GROUP_LABELS[t.group] || t.group)}</span>`,
        );
        marker.on("click", () => scrollToTrail(state, t.id));
        state.markerLayer.addLayer(marker);
      }

      if (state.center) {
        // Auf den gesuchten Umkreis zoomen, nicht auf alle Marker: Fernwege
        // (z. B. "Hugenotten- und Waldenserpfad") tragen einen Startpunkt, der
        // weit außerhalb des Suchradius liegen kann, obwohl ihr Streckenverlauf
        // den Umkreis kreuzt (live beobachtet 2026-08-19). Ein Fit auf alle
        // Markerpunkte würde den Kartenausschnitt dann auf den Ausreißer statt
        // auf die eigentliche Suche ausrichten.
        state.map.fitBounds(boundsForRadius(state.center, state.radiusKm));
      }

      setTimeout(() => {
        if (state.disposed || !state.map) return;
        state.map.invalidateSize();
      }, 100);
    })
    .catch((err) => {
      const u = state.uid;
      const el = state.root.querySelector(`#ww-map-${u}`);
      if (el) el.innerHTML = `<div class="alert alert-warning">Karte konnte nicht geladen werden: ${escapeHtml(err.message)}</div>`;
    });
}

function scrollToTrail(state, trailId) {
  // Marker-Klicks kommen aus state.filteredTrails, aber renderList() rendert nur die
  // aktuell sichtbare Seite ins DOM. Liegt der Weg auf einer anderen Seite, faende
  // querySelector sonst nichts und der Klick haette still keine Wirkung.
  const idx = state.filteredTrails.findIndex((t) => t.id === trailId);
  if (idx === -1) return; // Weg ist aktuell herausgefiltert
  const targetPage = Math.floor(idx / state.pageSize);
  if (targetPage !== state.page) {
    state.page = targetPage;
    renderList(state);
  }

  const wrap = state.root.querySelector(`.ww-list-item-wrap[data-trail-id="${cssEscape(trailId)}"]`);
  if (!wrap) return;
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  const detail = wrap.querySelector(".ww-list-detail");
  if (detail && detail.hidden) toggleDetail(state, trailId);
  wrap.classList.add("ww-list-item-flash");
  setTimeout(() => wrap.classList.remove("ww-list-item-flash"), 1200);
}

// ---------------------------------------------------------------------------
// Detailansicht
// ---------------------------------------------------------------------------

function toggleDetail(state, trailId) {
  const wrap = state.root.querySelector(`.ww-list-item-wrap[data-trail-id="${cssEscape(trailId)}"]`);
  if (!wrap) return;
  const detail = wrap.querySelector(".ww-list-detail");
  const chevron = wrap.querySelector(".ww-list-chevron");
  const isOpen = !detail.hidden;

  if (isOpen) {
    detail.hidden = true;
    detail.innerHTML = "";
    wrap.classList.remove("ww-list-item-open");
    if (chevron) chevron.style.transform = "";
    clearDetailPolyline(state);
    state.openDetailId = null;
    return;
  }

  const trail = state.allTrails.find((t) => t.id === trailId);
  if (!trail) return;

  wrap.classList.add("ww-list-item-open");
  if (chevron) chevron.style.transform = "rotate(90deg)";
  detail.hidden = false;
  state.openDetailId = trailId;
  detail.innerHTML = `<div class="ww-detail-loading"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Details werden geladen …</span></div></div>`;

  loadTrailDetail(state, trail)
    .then((detailObj) => {
      if (state.disposed || state.openDetailId !== trailId) return;
      detail.innerHTML = detailHtml(state, trail, detailObj);
      bindDetailControls(state, trail, detailObj);
      drawDetailPolyline(state, detailObj);
      renderElevationChart(state, detail.querySelector(".ww-elevation-canvas"), detailObj);
    })
    .catch((error) => {
      if (state.disposed || state.openDetailId !== trailId) return;
      console.error("Detail konnte nicht geladen werden:", error);
      detail.innerHTML = `<div class="alert alert-danger" role="alert">Die Details konnten nicht geladen werden: ${escapeHtml(error.message || String(error))}</div>`;
    });
}

async function loadTrailDetail(state, trail) {
  if (state.detailCache.has(trail.id)) return state.detailCache.get(trail.id);
  const raw = await fetchTrailDetail(trail.id, state.config);
  state.detailCache.set(trail.id, raw);
  return raw;
}

async function fetchTrailDetail(id, configdata) {
  const thingsBase = buildThingsBaseUrl(configdata.apiurl);
  if (!thingsBase) throw new Error("Der Detail-Endpunkt konnte nicht aus der Instanzkonfiguration abgeleitet werden.");
  const lastSlash = id.lastIndexOf("/");
  const ns = id.slice(0, lastSlash + 1);
  const localName = id.slice(lastSlash + 1);
  const url = `${thingsBase}/${encodeURIComponent(localName)}?ns=${encodeURIComponent(ns)}`;
  const json = await fetchKgJson(url, configdata);
  const obj = Array.isArray(json) ? json[0] : json;
  if (!obj) throw new Error("Keine Detaildaten in der Antwort gefunden.");
  return parseTrailDetail(obj);
}

function buildThingsBaseUrl(sparqlUrl) {
  try {
    const u = new URL(sparqlUrl);
    return `${u.origin}/api/ts/v2/kg/things`;
  } catch (_error) {
    return null;
  }
}

function parseTrailDetail(obj) {
  const description = jsonLdText(obj[P.description]);
  const images = (Array.isArray(obj[P.image]) ? obj[P.image] : obj[P.image] ? [obj[P.image]] : [])
    .map((img) => ({
      url: safeHttpUrl(literalValue(img[P.contentUrl])),
      copyright: jsonLdText(img[P.copyrightNotice]),
    }))
    .filter((img) => img.url);

  const lengthM = literalValue(getPath(obj, [P.length, P.value]));
  const uphillM = literalValue(getPath(obj, [P.uphillElevation, P.value]));
  const downhillM = literalValue(getPath(obj, [P.downhillElevation, P.value]));
  const durationIso = literalValue(getPath(obj, [P.estimatedDuration, P.name])) || jsonLdText(getPath(obj, [P.estimatedDuration, P.name]));
  const circularRaw = literalValue(obj[P.circularTrail]);

  const difficulty = extractDifficultyLabel(obj[P.difficulty]);
  const lineStr = getPath(obj, [P.geo, P.line]);
  const lineCoords = parseGeoLine(lineStr);

  const startPlace = parsePlaceNode(obj[P.startLocation]);
  const endPlace = parsePlaceNode(obj[P.endLocation]);

  const sdLicense = obj[P.sdLicense] || {};
  const licenseUrl = safeHttpUrl(literalValue(sdLicense[P.license]));
  const author = sdLicense[P.author] || {};
  const authorName = jsonLdText(author[P.name]) || literalValue(author[P.name]);

  return {
    description,
    images,
    lengthKm: Number.isFinite(Number(lengthM)) ? Number(lengthM) / 1000 : null,
    uphillM: Number.isFinite(Number(uphillM)) ? Number(uphillM) : null,
    downhillM: Number.isFinite(Number(downhillM)) ? Number(downhillM) : null,
    durationText: formatIsoDuration(durationIso),
    circular: circularRaw === "true" || circularRaw === true,
    difficulty,
    types: Array.isArray(obj["@type"]) ? obj["@type"] : obj["@type"] ? [obj["@type"]] : [],
    lineCoords,
    startPlace,
    endPlace,
    licenseUrl,
    authorName,
  };
}

function parsePlaceNode(node) {
  if (!node) return null;
  const address = node[P.address] || {};
  const locality = literalValue(address[P.addressLocality]) || jsonLdText(address[P.addressLocality]);
  const street = literalValue(address[P.streetAddress]) || jsonLdText(address[P.streetAddress]);
  const name = jsonLdText(node[P.name]) || literalValue(node[P.name]);
  const parts = [street, locality].filter(Boolean);
  return { name: name || "", address: parts.join(", ") };
}

function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[0] : cur;
    cur = cur ? cur[key] : undefined;
  }
  return cur;
}

function literalValue(node) {
  if (node == null) return null;
  if (Array.isArray(node)) node = node[0];
  if (node && typeof node === "object" && "@value" in node) return node["@value"];
  if (typeof node === "string" || typeof node === "number") return node;
  return null;
}

function jsonLdText(value, preferredLang) {
  if (value == null) return "";
  const arr = Array.isArray(value) ? value : [value];
  if (preferredLang) {
    const withLang = arr.find((v) => v && typeof v === "object" && v["@language"] === preferredLang);
    if (withLang) return withLang["@value"];
  }
  const german = arr.find((v) => v && typeof v === "object" && v["@language"] === "de");
  if (german) return german["@value"];
  const anyLang = arr.find((v) => v && typeof v === "object" && v["@value"] != null);
  if (anyLang) return anyLang["@value"];
  const plain = arr.find((v) => typeof v === "string");
  return plain || "";
}

function extractDifficultyLabel(value) {
  if (value == null) return "";
  const arr = Array.isArray(value) ? value : [value];
  for (const v of arr) {
    if (v && typeof v === "object" && v[P.name] != null) {
      return jsonLdText(v[P.name]) || literalValue(v[P.name]) || "";
    }
  }
  return "";
}

function parseGeoLine(lineStr) {
  const str = literalValue(lineStr) || (typeof lineStr === "string" ? lineStr : "");
  if (!str) return [];
  return String(str)
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const parts = pair.split(",");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      const ele = parts.length > 2 ? Number(parts[2]) : null;
      return { lat, lon, ele: Number.isFinite(ele) && ele !== 0 ? ele : null };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function detailHtml(state, trail, detail) {
  const lengthText = detail.lengthKm != null ? `${detail.lengthKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : "";
  const hasElevationProfile = detail.lineCoords.filter((p) => p.ele != null).length >= 5;

  const galleryHtml = detail.images.length
    ? `<div class="ww-gallery">${detail.images
        .map((img) => `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(trail.name)}" class="ww-gallery-img" loading="lazy">`)
        .join("")}</div>`
    : "";

  return `
    <div class="ww-detail-header">
      <h2 class="ww-detail-title">${escapeHtml(trail.name)}</h2>
      <div class="ww-detail-badges">
        <span class="ww-detail-badge">${escapeHtml(TRAIL_GROUP_LABELS[trail.group] || trail.group)}</span>
        ${detail.difficulty ? `<span class="ww-detail-badge">${escapeHtml(detail.difficulty)}</span>` : ""}
        ${detail.circular ? `<span class="ww-detail-badge">Rundweg</span>` : ""}
      </div>
      ${state.config.kiRoutenplanung === "ja" ? `<button type="button" class="btn btn-sm btn-primary ww-ai-open-btn" data-trail-id="${escapeAttr(trail.id)}">KI Routenplanung</button>` : ""}
    </div>

    ${galleryHtml}

    ${detail.description ? `<div class="ww-detail-desc">${escapeHtml(detail.description)}</div>` : ""}

    <div class="ww-detail-grid">
      <div class="ww-detail-section">
        <h3 class="ww-detail-section-title">Kennzahlen</h3>
        <div class="ww-detail-info">
          ${lengthText ? `<div><span class="ww-info-label">Länge</span> <span class="ww-info-value">${escapeHtml(lengthText)}</span></div>` : ""}
          ${detail.durationText ? `<div><span class="ww-info-label">Dauer</span> <span class="ww-info-value">${escapeHtml(detail.durationText)}</span></div>` : ""}
          ${detail.uphillM != null ? `<div><span class="ww-info-label">Aufstieg</span> <span class="ww-info-value">${escapeHtml(String(Math.round(detail.uphillM)))} m</span></div>` : ""}
          ${detail.downhillM != null ? `<div><span class="ww-info-label">Abstieg</span> <span class="ww-info-value">${escapeHtml(String(Math.round(detail.downhillM)))} m</span></div>` : ""}
        </div>
      </div>

      ${detail.startPlace || detail.endPlace ? `<div class="ww-detail-section">
        <h3 class="ww-detail-section-title">Start &amp; Ziel</h3>
        <div class="ww-detail-info">
          ${detail.startPlace ? `<div><span class="ww-info-label">Start</span> <span class="ww-info-value">${escapeHtml(detail.startPlace.name || detail.startPlace.address || "")}</span></div>` : ""}
          ${detail.endPlace ? `<div><span class="ww-info-label">Ziel</span> <span class="ww-info-value">${escapeHtml(detail.endPlace.name || detail.endPlace.address || "")}</span></div>` : ""}
        </div>
      </div>` : ""}

      <div class="ww-detail-section">
        <h3 class="ww-detail-section-title">Daten &amp; Lizenz</h3>
        <div class="ww-detail-info">
          ${detail.licenseUrl ? `<div><a href="${escapeAttr(detail.licenseUrl)}" target="_blank" rel="noopener" class="ww-link">Lizenzbedingungen</a></div>` : ""}
          ${detail.authorName ? `<div><span class="ww-info-label">Quelle</span> <span class="ww-info-value">${escapeHtml(detail.authorName)}</span></div>` : ""}
        </div>
      </div>
    </div>

    ${hasElevationProfile ? `<div class="ww-elevation-wrap"><h3 class="ww-detail-section-title">Höhenprofil</h3><canvas class="ww-elevation-canvas" height="120"></canvas></div>` : ""}

    <details class="ww-jsonld-accordion">
      <summary class="ww-jsonld-summary">
        <svg class="ww-jsonld-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        <span class="ww-jsonld-label">ODTA-JSON-LD</span>
        <span class="ww-jsonld-hint">konformer Datenexport</span>
      </summary>
      <div class="ww-jsonld-body">
        <div class="ww-jsonld-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary ww-jsonld-copy" title="In Zwischenablage kopieren">Kopieren</button>
          <button type="button" class="btn btn-sm btn-outline-secondary ww-jsonld-download" title="Als .jsonld-Datei herunterladen">Download</button>
        </div>
        <pre class="ww-jsonld-pre"><code></code></pre>
      </div>
    </details>
  `;
}

function bindDetailControls(state, trail, detail) {
  const wrap = state.root.querySelector(`.ww-list-item-wrap[data-trail-id="${cssEscape(trail.id)}"] .ww-list-detail`);
  if (!wrap) return;

  const aiBtn = wrap.querySelector(".ww-ai-open-btn");
  if (aiBtn) {
    aiBtn.addEventListener("click", () => openAiChat(state, trail.id));
  }

  const accordion = wrap.querySelector(".ww-jsonld-accordion");
  const codeEl = accordion ? accordion.querySelector("code") : null;
  if (accordion && codeEl) {
    accordion.addEventListener("toggle", () => {
      if (accordion.open && !codeEl.textContent) {
        codeEl.textContent = JSON.stringify(toOdtaTrailJsonLd(trail, detail), null, 2);
      }
    });
  }

  const copyBtn = wrap.querySelector(".ww-jsonld-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(toOdtaTrailJsonLd(trail, detail), null, 2));
        const orig = copyBtn.textContent;
        copyBtn.textContent = "Kopiert!";
        setTimeout(() => (copyBtn.textContent = orig), 1500);
      } catch (_error) {
        copyBtn.textContent = "Fehler";
      }
    });
  }

  const dlBtn = wrap.querySelector(".ww-jsonld-download");
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(toOdtaTrailJsonLd(trail, detail), null, 2)], { type: "application/ld+json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${trail.id.split("/").pop().replace(/[^a-z0-9-]/gi, "_")}.jsonld`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}

function toOdtaTrailJsonLd(trail, detail) {
  const out = {
    "@context": { schema: "https://schema.org/", odta: "https://odta.io/voc/" },
    "@id": trail.id,
    "@type": "odta:Trail",
    "schema:name": trail.name,
  };
  if (detail.description) out["schema:description"] = detail.description;
  if (detail.lengthKm != null) out["odta:length"] = { "@type": "schema:QuantitativeValue", "schema:value": Math.round(detail.lengthKm * 1000), "schema:unitCode": "MTR" };
  if (detail.difficulty) out["odta:difficulty"] = detail.difficulty;
  if (detail.durationText) out["odta:estimatedDuration"] = trail.durationIso || detail.durationText;
  if (trail.circular != null) out["odta:circularTrail"] = trail.circular;
  if (detail.uphillM != null) out["odta:uphillElevation"] = { "@type": "schema:QuantitativeValue", "schema:value": detail.uphillM, "schema:unitCode": "MTR" };
  if (detail.downhillM != null) out["odta:downhillElevation"] = { "@type": "schema:QuantitativeValue", "schema:value": detail.downhillM, "schema:unitCode": "MTR" };
  if (detail.lineCoords.length) {
    out["schema:geo"] = {
      "@type": "schema:GeoShape",
      "schema:line": detail.lineCoords.map((p) => `${p.lon},${p.lat}`).join(" "),
    };
  }
  if (detail.images.length) {
    out["schema:image"] = detail.images.map((img) => ({ "@type": "schema:ImageObject", "schema:contentUrl": img.url }));
  }
  if (detail.licenseUrl) out["sdLicense"] = detail.licenseUrl;
  out["sdSource"] = "https://proxy.opendatagermany.io/api/ts/v2/kg/things";
  return out;
}

// ---------------------------------------------------------------------------
// KI-Routenplanung
// ---------------------------------------------------------------------------
// App-weites Modal (nicht pro Listenzeile) mit waehlbarer Kontext-Route,
// mehrstufigem Chatverlauf und optionaler Umgebungsanreicherung (Grounding:
// echte Unterkuenfte/Gastronomie aus dem DZT Knowledge Graph). Jede neue
// Frage baut den kompletten Prompt (Routendaten + Grounding + bisheriger
// Verlauf + neue Frage) neu zusammen — der /ai-Endpunkt selbst hat kein
// Gedaechtnis, das Chat-Gefuehl entsteht rein clientseitig. Verlauf liegt in
// sessionStorage (ueberlebt Reload im selben Tab, nicht dauerhaft).

function bindAiModalControls(state) {
  const u = state.uid;
  const modal = state.root.querySelector(`#ww-ai-modal-${u}`);
  if (!modal) return;

  modal.querySelectorAll("[data-ai-close]").forEach((el) => el.addEventListener("click", () => closeAiChat(state)));

  const select = modal.querySelector(`#ww-ai-route-select-${u}`);
  if (select) select.addEventListener("change", () => switchAiRoute(state, select.value));

  const input = modal.querySelector(`#ww-ai-input-${u}`);
  const sendBtn = modal.querySelector(`#ww-ai-send-${u}`);
  if (sendBtn && input) {
    sendBtn.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendAiMessage(state, text);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendBtn.click();
      }
    });
  }

  const presets = modal.querySelector(`#ww-ai-presets-${u}`);
  if (presets) {
    presets.addEventListener("click", (event) => {
      const btn = event.target.closest(".ww-ai-preset-btn");
      if (!btn) return;
      sendAiMessage(state, btn.dataset.prompt);
    });
  }

  // Ueberlebt das Modal einen Seitenwechsel-und-zurueck (DOM wird neu
  // aufgebaut, state.aiChat bleibt erhalten) im geoeffneten Zustand, wird es
  // hier wiederhergestellt — konsistent mit dem Persistenzverhalten der
  // restlichen App.
  if (state.aiChat.open && state.aiChat.trailId) {
    openAiChat(state, state.aiChat.trailId);
  }
}

function openAiChat(state, trailId) {
  const trail = state.allTrails.find((t) => t.id === trailId);
  if (!trail) return;

  state.aiChat.open = true;
  state.aiChat.trailId = trailId;
  state.aiChat.sending = false;

  const u = state.uid;
  const modal = state.root.querySelector(`#ww-ai-modal-${u}`);
  if (!modal) return;
  modal.hidden = false;

  renderAiRouteOptions(state);
  const select = modal.querySelector(`#ww-ai-route-select-${u}`);
  if (select) select.value = trailId;

  ensureAiMessagesLoaded(state, trailId);
  renderAiMessages(state);
  renderAiPresets(state);
  renderAiStatus(state, "");

  getAiGroundingPromise(state, trail); // im Hintergrund laden/cachen, kein Warten noetig
}

function closeAiChat(state) {
  state.aiChat.open = false;
  const modal = state.root.querySelector(`#ww-ai-modal-${state.uid}`);
  if (modal) modal.hidden = true;
}

function switchAiRoute(state, trailId) {
  if (!trailId || trailId === state.aiChat.trailId) return;
  openAiChat(state, trailId);
}

function renderAiRouteOptions(state) {
  const select = state.root.querySelector(`#ww-ai-route-select-${state.uid}`);
  if (!select) return;
  const trails = state.allTrails;
  select.innerHTML = trails
    .map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name)} (${escapeHtml(TRAIL_GROUP_LABELS[t.group] || t.group)})</option>`)
    .join("");
}

function ensureAiMessagesLoaded(state, trailId) {
  if (state.aiMessagesByTrail.has(trailId)) return;
  state.aiMessagesByTrail.set(trailId, loadAiMessagesFromStorage(trailId));
}

function loadAiMessagesFromStorage(trailId) {
  try {
    const raw = sessionStorage.getItem(AI_SESSION_KEY_PREFIX + trailId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch (_error) {
    return [];
  }
}

function saveAiMessagesToStorage(trailId, messages) {
  try {
    const capped = messages.slice(-AI_HISTORY_LIMIT);
    sessionStorage.setItem(AI_SESSION_KEY_PREFIX + trailId, JSON.stringify({ messages: capped, ts: Date.now() }));
  } catch (_error) {
    // Privatmodus o.ae. kann werfen — Verlauf bleibt dann nur fuer diese Seitenansicht erhalten
  }
}

function renderAiMessages(state) {
  const el = state.root.querySelector(`#ww-ai-messages-${state.uid}`);
  if (!el) return;
  const messages = state.aiMessagesByTrail.get(state.aiChat.trailId) || [];
  el.innerHTML = messages.length
    ? messages.map((m) => `<div class="ww-ai-msg ww-ai-msg-${m.role}"><span class="ww-ai-msg-text">${escapeHtml(m.text)}</span></div>`).join("")
    : `<div class="ww-ai-msg-empty">Noch keine Fragen gestellt. Vorschlag wählen oder eigene Frage schreiben.</div>`;
  el.scrollTop = el.scrollHeight;
}

function renderAiPresets(state) {
  const el = state.root.querySelector(`#ww-ai-presets-${state.uid}`);
  if (!el) return;
  const trail = state.allTrails.find((t) => t.id === state.aiChat.trailId);
  const presets = (trail && AI_PROMPT_PRESETS[trail.group]) || AI_PROMPT_PRESETS.sonstige;
  el.innerHTML = presets
    .map((p) => `<button type="button" class="btn btn-sm btn-outline-primary ww-ai-preset-btn" data-prompt="${escapeAttr(p)}">${escapeHtml(p)}</button>`)
    .join("");
}

function renderAiStatus(state, message, kind) {
  const el = state.root.querySelector(`#ww-ai-status-${state.uid}`);
  if (!el) return;
  if (!message) {
    el.innerHTML = "";
    return;
  }
  const spinner = kind === "loading" ? `<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Wird geladen …</span></div>` : "";
  const cls = kind === "error" ? "alert alert-danger" : "ww-ai-status-info";
  el.innerHTML = `<div class="${cls}">${spinner}<span>${escapeHtml(message)}</span></div>`;
}

// Grounding-Treffer werden als Promise pro Route gecacht (auch nach einem
// Fehlschlag als leeres Array) — ein Routenwechsel im Modal fragt dieselbe
// Umgebung nicht zweimal ab.
function getAiGroundingPromise(state, trail) {
  if (state.aiGroundingPromises.has(trail.id)) return state.aiGroundingPromises.get(trail.id);
  const promise = fetchAiGrounding(state, trail);
  state.aiGroundingPromises.set(trail.id, promise);
  return promise;
}

async function fetchAiGrounding(state, trail) {
  if (trail.startLat == null || trail.startLon == null) return [];
  try {
    const sparql = buildGroundingSparql(trail.startLat, trail.startLon, AI_GROUNDING_RADIUS_KM);
    const json = await fetchSparql(sparql, state.config);
    const rows = (json && json.results && json.results.bindings) || [];
    return parseGroundingRows(rows);
  } catch (error) {
    console.warn("Umgebungsdaten fuer KI-Routenplanung konnten nicht geladen werden:", error);
    return [];
  }
}

function buildGroundingSparql(lat, lon, radiusKm) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  const radius = `${Math.max(1, Math.round(Number(radiusKm) || AI_GROUNDING_RADIUS_KM))}km`;
  const geoShapeJson = JSON.stringify({
    query: { geo_shape: { geometry: { shape: { type: "circle", radius, coordinates: [lonNum, latNum] }, relation: "intersects" } } },
  });
  const geoShapeLiteral = JSON.stringify(geoShapeJson);

  return `PREFIX inst: <http://www.ontotext.com/connectors/elasticsearch/instance#>
PREFIX con: <http://www.ontotext.com/connectors/elasticsearch#>
PREFIX schema: <https://schema.org/>
PREFIX ds: <https://vocab.sti2.at/ds/>

SELECT ?id ?name ?desc WHERE {
  ?search a inst:dzt-geo-shapes ;
    con:query ${geoShapeLiteral} ;
    con:entities ?geoent .
  VALUES ?ds { <${LODGING_DS}> <${GASTRONOMY_DS}> }
  ?geoent ds:compliesWith ?ds ; schema:geo ?geo .
  ?geo a schema:GeoCoordinates .
  BIND(?geoent AS ?id)
  OPTIONAL { ?geoent schema:name ?name }
  OPTIONAL { ?geoent schema:description ?desc }
}
LIMIT 200`;
}

function parseGroundingRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = row.id && row.id.value;
    if (!id) continue;
    let entry = byId.get(id);
    if (!entry) {
      entry = { id, names: [], descs: [] };
      byId.set(id, entry);
    }
    if (row.name) entry.names.push({ value: row.name.value, lang: row.name["xml:lang"] || "" });
    if (row.desc) entry.descs.push({ value: row.desc.value, lang: row.desc["xml:lang"] || "" });
  }
  return Array.from(byId.values())
    .map((e) => ({ name: pickPreferredName(e.names, "de"), description: pickPreferredName(e.descs, "de") }))
    .filter((e) => e.name || e.description)
    .slice(0, 15); // Prompt-Laenge begrenzen
}

function buildAiPrompt(trail, detail, groundingPois, history, question) {
  const facts = [`${trail.name}`, `${TRAIL_GROUP_LABELS[trail.group] || trail.group}`];
  if (detail.lengthKm != null) facts.push(`${detail.lengthKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`);
  if (detail.difficulty) facts.push(`Schwierigkeit ${detail.difficulty}`);
  if (detail.durationText) facts.push(`Dauer ${detail.durationText}`);
  if (detail.uphillM != null) facts.push(`${Math.round(detail.uphillM)} Hm Aufstieg`);
  if (detail.downhillM != null) facts.push(`${Math.round(detail.downhillM)} Hm Abstieg`);

  const lines = [`Routendaten: ${facts.join(", ")}.`];
  if (detail.description) lines.push(`Beschreibung: ${detail.description}`);

  lines.push("");
  if (groundingPois.length) {
    lines.push(
      "Bekannte Orte in der Umgebung (aus dem DZT Knowledge Graph, nutze nur diese Angaben fuer Fakten zu Kosten/Oeffnungszeiten/Regelungen; sage klar, wenn etwas nicht bekannt ist):"
    );
    groundingPois.forEach((p) => lines.push(`- ${p.name}${p.description ? `: ${p.description}` : ""}`));
  } else {
    lines.push("Es sind keine bekannten Orte in der Umgebung aus dem DZT Knowledge Graph verfuegbar.");
  }

  if (history.length) {
    lines.push("");
    lines.push("Bisheriger Verlauf:");
    history.forEach((m) => lines.push(`${m.role === "user" ? "Nutzer" : "KI"}: ${m.text}`));
  }

  lines.push("", `Neue Frage: ${question}`, "", "Antworte in einfachem Fließtext ohne HTML oder Markdown.");
  return lines.join("\n");
}

async function sendAiMessage(state, questionText) {
  const trailId = state.aiChat.trailId;
  if (!trailId || state.aiChat.sending) return;
  const trail = state.allTrails.find((t) => t.id === trailId);
  if (!trail) return;

  const messages = state.aiMessagesByTrail.get(trailId) || [];
  messages.push({ role: "user", text: questionText });
  state.aiMessagesByTrail.set(trailId, messages);
  saveAiMessagesToStorage(trailId, messages);
  renderAiMessages(state);

  state.aiChat.sending = true;
  renderAiStatus(state, "KI denkt nach …", "loading");
  const sendBtn = state.root.querySelector(`#ww-ai-send-${state.uid}`);
  if (sendBtn) sendBtn.disabled = true;

  try {
    const detail = await loadTrailDetail(state, trail);
    const groundingPois = await getAiGroundingPromise(state, trail);
    const history = messages.slice(0, -1); // ohne die soeben gestellte Frage
    const prompt = buildAiPrompt(trail, detail, groundingPois, history, questionText);
    const answer = await fetchAiAnswer(prompt);

    if (state.disposed) return;
    const current = state.aiMessagesByTrail.get(trailId) || [];
    current.push({ role: "assistant", text: answer });
    state.aiMessagesByTrail.set(trailId, current);
    saveAiMessagesToStorage(trailId, current);
    renderAiStatus(state, "");
  } catch (error) {
    console.error("KI-Routenplanung fehlgeschlagen:", error);
    renderAiStatus(state, error.message || "Die KI-Routenplanung ist derzeit nicht verfügbar.", "error");
  } finally {
    state.aiChat.sending = false;
    if (sendBtn) sendBtn.disabled = false;
    if (!state.disposed && state.aiChat.trailId === trailId) renderAiMessages(state);
  }
}

async function fetchAiAnswer(prompt) {
  const base = getOdasAppBasePath();
  let response;
  try {
    response = await fetch(`${base}/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, fileUrl: "" }),
    });
  } catch (_error) {
    throw new Error("Die KI-Routenplanung ist nur im ODAS-Betrieb verfügbar.");
  }
  // Statuscodes, die typischerweise bedeuten "diese Route/Methode gibt es hier gar nicht"
  // (kein echter ODAS-Betrieb, z. B. lokaler Live-Server oder Standalone-Hosting) statt
  // eines echten Fehlers des /ai-Endpunkts selbst.
  if ([404, 405, 501].includes(response.status)) {
    throw new Error("Die KI-Routenplanung ist nur im ODAS-Betrieb verfügbar.");
  }
  if (!response.ok) {
    throw new Error(`Die KI-Routenplanung antwortet mit HTTP ${response.status}.`);
  }
  let json;
  try {
    json = await response.json();
  } catch (_error) {
    throw new Error("Die Antwort der KI-Routenplanung konnte nicht gelesen werden.");
  }
  const result = json && typeof json.result === "string" ? json.result.trim() : "";
  if (!result) throw new Error("Die KI-Routenplanung hat keine Antwort geliefert.");
  return result;
}

// ---------------------------------------------------------------------------
// Streckenlinie auf der Karte / Hoehenprofil
// ---------------------------------------------------------------------------

function drawDetailPolyline(state, detail) {
  if (!state.map || !detail.lineCoords.length) return;
  clearDetailPolyline(state);
  const latlngs = detail.lineCoords.map((p) => [p.lat, p.lon]);
  state.detailPolylineLayer = L.polyline(latlngs, { color: "#c1440e", weight: 4, opacity: 0.85 }).addTo(state.map);
  state.map.fitBounds(state.detailPolylineLayer.getBounds().pad(0.1));
}

function clearDetailPolyline(state) {
  if (state.detailPolylineLayer && state.map) {
    try {
      state.map.removeLayer(state.detailPolylineLayer);
    } catch (_error) {
      // Layer war bereits entfernt
    }
  }
  state.detailPolylineLayer = null;
  if (state.center) {
    state.map.setView(state.center, state.map.getZoom());
  }
}

let chartjsLoading = null;
function loadChartjs() {
  if (window.Chart) return Promise.resolve();
  if (chartjsLoading) return chartjsLoading;
  chartjsLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/chartjs/chart.umd.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Chart.js konnte nicht geladen werden"));
    document.head.appendChild(script);
  });
  return chartjsLoading;
}

function renderElevationChart(state, canvas, detail) {
  if (!canvas) return;
  const points = detail.lineCoords.filter((p) => p.ele != null);
  if (points.length < 5) return;

  loadChartjs()
    .then(() => {
      if (state.disposed || !canvas.isConnected) return;
      let cumKm = 0;
      const labels = [];
      const data = [];
      for (let i = 0; i < detail.lineCoords.length; i++) {
        const p = detail.lineCoords[i];
        if (i > 0) cumKm += haversineKm(detail.lineCoords[i - 1], p);
        if (p.ele != null) {
          labels.push(cumKm.toFixed(1));
          data.push(Math.round(p.ele));
        }
      }
      if (state.elevationChart) {
        try {
          state.elevationChart.destroy();
        } catch (_error) {
          // bereits entfernt
        }
      }
      state.elevationChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [{ label: "Höhe (m)", data, borderColor: "#c1440e", backgroundColor: "rgba(193,68,14,0.15)", fill: true, pointRadius: 0, tension: 0.2 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: "Strecke (km)" } },
            y: { title: { display: true, text: "Höhe (m)" } },
          },
          plugins: { legend: { display: false } },
        },
      });
    })
    .catch((err) => console.warn("Höhenprofil konnte nicht gezeichnet werden:", err));
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Schale 4 (Methodik, verwandte Links)
// ---------------------------------------------------------------------------

function renderSchale4Blocks(state) {
  const u = state.uid;
  const top = state.root.querySelector(`#ww-schale4-top-${u}`);
  const bottom = state.root.querySelector(`#ww-schale4-bottom-${u}`);

  const methodik = String(state.config.datenquelleHinweis || "").trim();
  const datenStandText = String(state.config.datenStand || "").trim();
  const links = String(state.config.weiterfuehrendeLinks || "").trim();

  let topHtml = "";
  if (methodik) topHtml += `<div class="ww-schale4-card"><h2>Methodik &amp; Datenquelle</h2><div>${methodik}</div></div>`;
  if (datenStandText) topHtml += `<div class="ww-freshness">${escapeHtml(datenStandText)}</div>`;
  if (top) top.innerHTML = topHtml;

  if (bottom) bottom.innerHTML = links ? `<div class="ww-schale4-card"><h2>Verwandte Links</h2><div>${links}</div></div>` : "";
}

// ---------------------------------------------------------------------------
// Status / Fehlerzustaende
// ---------------------------------------------------------------------------

function missingSourceReason(configdata) {
  const apiurl = String(configdata.apiurl || "").trim();
  const apiKey = String(configdata.apiKey || "").trim();
  const ort = String(configdata.ort || "").trim();
  const isPlaceholder = (v) => /^\{\{.*\}\}$/.test(v) || /^<.*>$/.test(v);
  if (!apiurl || isPlaceholder(apiurl)) return "Es ist keine Datenquelle konfiguriert.";
  if (!apiKey || isPlaceholder(apiKey)) return "Es ist kein DZT-API-Key konfiguriert.";
  if (!ort || isPlaceholder(ort)) return "Es ist kein Ort konfiguriert.";
  return null;
}

function showStatus(state, message, kind) {
  // Nicht-transiente Zustaende (alles außer "loading") merken, damit ein
  // Resume aus dem Cache (siehe app()) denselben Zustand ohne neue Anfrage
  // reproduzieren kann. "clear"/leere Nachricht bedeutet: Ergebnisse selbst
  // zeigen den Zustand, keine Statuszeile noetig.
  if (kind !== "loading") {
    state.statusMessage = message ? { text: message, kind } : null;
  }

  const u = state.uid;
  const el = state.root.querySelector(`#ww-search-status-${u}`);
  if (!el) return;
  if (kind === "clear" || !message) {
    el.innerHTML = "";
    return;
  }
  const cls = { loading: "ww-status-loading", error: "alert alert-danger", info: "ww-status-info" }[kind] || "ww-status-info";
  const spinner = kind === "loading" ? `<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Wird geladen …</span></div>` : "";
  el.innerHTML = `<div class="${cls}" role="status">${spinner}<span>${escapeHtml(message)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Fetch-Helfer (Direktzugriff, kein ODAS-Proxy — siehe README)
// ---------------------------------------------------------------------------

// Kanonischer ODAS-Helfer: liefert den Basis-Pfad der App-Instanz (ohne
// Datei-Segment wie index.html), damit z. B. der /ai-Endpunkt unabhaengig
// vom Deployment-Pfad der Instanz korrekt adressiert wird.
function getOdasAppBasePath(pathname = window.location.pathname) {
  let appPath = String(pathname || "/");
  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }
  return appPath.replace(/\/+$/, "");
}

async function fetchSparql(query, configdata, signal) {
  const base = String(configdata.apiurl || "").trim();
  const url = `${base}?${new URLSearchParams({ query }).toString()}`;
  return fetchKgJson(url, configdata, { accept: "application/sparql-results+json" }, signal);
}

async function fetchKgJson(url, configdata, extraHeaders = {}, signal) {
  const headers = { accept: "application/json", ...extraHeaders };
  const apiKey = String(configdata.apiKey || "").trim();
  if (apiKey) headers["x-api-key"] = apiKey;

  let response;
  try {
    response = await fetch(url, { headers, signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Datenabruf fehlgeschlagen: ${error.message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Der DZT-API-Key ist ungültig oder abgelaufen. Bitte in der Instanzkonfiguration prüfen.");
  }
  if (response.status === 429) {
    throw new Error("Das Tageslimit der DZT-Schnittstelle ist erreicht. Bitte später erneut versuchen.");
  }
  if (!response.ok) {
    throw new Error(`Die DZT-Schnittstelle antwortet mit HTTP ${response.status}.`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error("Die Antwort der DZT-Schnittstelle konnte nicht als JSON gelesen werden.");
  }
}

// ---------------------------------------------------------------------------
// Allgemeine Helfer
// ---------------------------------------------------------------------------

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function safeHttpUrl(value) {
  const s = String(value || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function addToHead() {}
