/** Basemap styling for the Map view (ADR 0027).
 *
 *  The base is OpenFreeMap's `dark` style — free OpenStreetMap vector tiles,
 *  no API key, no registration, no request cap. It is already dark, so this
 *  module only has to pull it the rest of the way onto our tokens: land to
 *  `--bg`, boundaries to our hairline alphas, labels onto the grey text ramp,
 *  and everything that competes with a photograph turned off.
 *
 *  The overrides are applied by mutating the fetched style JSON *before*
 *  constructing the map, not on the `load` event — the latter fires after the
 *  first paint and shows a frame of the stock style first. */

export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** Rendered by MapLibre's own attribution control. OpenStreetMap (ODbL) and
 *  OpenFreeMap require it for the tiles; GeoNames (CC BY 4.0) rides along
 *  because this is the one user-facing surface where its derived place labels
 *  are visible — ADR 0026 could only record that obligation in a server-side
 *  NOTICE file, which does not discharge it. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> · ' +
  '<a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a>';

/** Roads, rails, runways, footpaths and water names. All of it is texture
 *  competing with the thumbnails for attention at the zooms this view lives
 *  at, and none of it answers "where was this taken". */
const HIDDEN_LAYERS = [
  "landcover_ice_shelf",
  "landcover_glacier",
  "aeroway-taxiway",
  "aeroway-runway-casing",
  "aeroway-area",
  "aeroway-runway",
  "highway_path",
  "road_oneway",
  "road_oneway_opposite",
  "railway_transit",
  "railway_transit_dashline",
  "railway_minor",
  "railway_minor_dashline",
  "railway",
  "railway_dashline",
  "highway_name_other",
  "highway_name_motorway",
  "water_name",
  "place_other",
  "place_suburb",
  // The grey veil over Europe at country zoom: thousands of residential
  // polygons, drawn from z0 to z9. Nothing at that scale is legible as land
  // use — it reads only as a haze laid over the map.
  "landuse_residential",
  // The overview road network. Both exist purely to keep motorways visible
  // when zoomed out, which is exactly the scale at which a photo map wants
  // an empty continent.
  "highway_motorway_subtle",
  "highway_major_subtle",
  // Road casings draw the same geometry a second time to outline it. That
  // reads as depth on a light basemap and as a doubled line on a near-black
  // one — 735 major roads became 1 470 strokes at z13, which is most of what
  // "too noisy" was pointing at.
  "highway_major_casing",
  "highway_motorway_casing",
  // Green fills and pier outlines: texture with nothing to say here.
  "landuse_park",
  "landcover_wood",
  "road_area_pier",
  "road_pier",
];

/** Explicit zoom windows, replacing the upstream style's. Almost every place
 *  layer ships as z0–something, so oblast and town names pile up over a whole
 *  continent — the "too noisy" complaint. Each label tier now appears only at
 *  the scale where it is the useful unit of geography, and roads hold off
 *  until the map is close enough for a street to mean anything. */
const ZOOM_RANGES: Record<string, [number, number]> = {
  place_country_major: [0, 7],
  place_country_minor: [2, 8],
  place_country_other: [3, 8],
  place_state: [6, 12], // was z0 — the oblast labels blanketing Europe
  place_city_large: [4, 13],
  place_city: [6, 14],
  place_town: [9, 15],
  place_village: [11, 15],
  boundary_state: [6, 24],
  highway_motorway_inner: [7, 24],
  highway_minor: [14, 24],
  waterway: [7, 24],
};

/** One name, not two. Upstream stacks the Latin and non-Latin names on two
 *  lines (`VOLYN OBLAST` above `ВОЛИНСЬКА ОБЛАСТЬ`), which doubles the ink of
 *  every label on the map — the single largest source of clutter.
 *
 *  English first, because `name:latin` is not a translation: for Latin-script
 *  countries it is simply the local name, so a map labelled that way reads
 *  "UKRAINE" beside "POLSKA" and "MAGYARORSZÁG". English also matches the
 *  place labels the geocoder writes ("Kyiv, Ukraine", ADR 0026), so the map
 *  and the drawer agree. Local name is the last resort. */
const ENGLISH_LABEL = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

const LAND = "#080808"; // --bg
const WATER = "#101013"; // barely lifted: coastline reads by shape, not brightness
const HAIRLINE = "rgba(255,255,255,0.07)"; // --bd
const HAIRLINE_HI = "rgba(255,255,255,0.14)"; // --bdh
const ROAD = "rgba(255,255,255,0.055)";
const ROAD_HI = "rgba(255,255,255,0.10)";
const LABEL = "#959793"; // --t2 resolved — 6.8:1 on LAND
const LABEL_DIM = "#7a7b78"; // --t2b resolved — 4.7:1, still AA
const HALO = "rgba(8,8,8,0.9)";

/** layer id → paint properties to overwrite. Anything not listed and not in
 *  HIDDEN_LAYERS keeps the upstream dark style's own paint. */
const PAINT_OVERRIDES: Record<string, Record<string, unknown>> = {
  background: { "background-color": LAND },
  water: { "fill-color": WATER },
  waterway: { "line-color": WATER },
  building: { "fill-color": "#0b0b0b", "fill-outline-color": "rgba(255,255,255,0.03)" },
  highway_minor: { "line-color": ROAD },
  highway_major_inner: { "line-color": ROAD_HI },
  highway_motorway_inner: { "line-color": ROAD_HI },
  boundary_state: { "line-color": HAIRLINE },
  "boundary_country_z0-4": { "line-color": HAIRLINE_HI },
  "boundary_country_z5-": { "line-color": HAIRLINE_HI },
  place_village: { "text-color": LABEL_DIM, "text-halo-color": HALO, "text-halo-width": 1.1 },
  place_town: { "text-color": LABEL_DIM, "text-halo-color": HALO, "text-halo-width": 1.1 },
  place_state: { "text-color": LABEL_DIM, "text-halo-color": HALO, "text-halo-width": 1.1 },
  place_city: { "text-color": LABEL, "text-halo-color": HALO, "text-halo-width": 1.2 },
  place_city_large: { "text-color": LABEL, "text-halo-color": HALO, "text-halo-width": 1.2 },
  place_country_other: { "text-color": LABEL, "text-halo-color": HALO, "text-halo-width": 1.4 },
  place_country_minor: { "text-color": LABEL, "text-halo-color": HALO, "text-halo-width": 1.4 },
  place_country_major: { "text-color": LABEL, "text-halo-color": HALO, "text-halo-width": 1.4 },
};

/** Space Mono is not among the three fontstacks OpenFreeMap serves (only Noto
 *  Sans Regular / Bold / Italic — everything else 404s, and a 404 in a
 *  `text-font` array drops the labels entirely). Naming an unavailable font
 *  here would silently empty the map. Wide tracking and uppercase carry our
 *  typographic voice instead; country names get Space Mono's even rhythm
 *  without pretending to be it. */
const LAYOUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  place_country_major: { "text-letter-spacing": 0.16, "text-transform": "uppercase" },
  place_country_minor: { "text-letter-spacing": 0.16, "text-transform": "uppercase" },
  place_country_other: { "text-letter-spacing": 0.16, "text-transform": "uppercase" },
  place_state: { "text-letter-spacing": 0.18, "text-transform": "uppercase" },
  place_city_large: { "text-letter-spacing": 0.1 },
  place_city: { "text-letter-spacing": 0.1 },
  place_town: { "text-letter-spacing": 0.08 },
  place_village: { "text-letter-spacing": 0.08 },
};

interface StyleLayer {
  id: string;
  type?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
}
interface StyleDoc {
  layers?: StyleLayer[];
  sources?: Record<string, { attribution?: string }>;
}

/** Recolours a fetched style in place and returns it. Tolerant by design: an
 *  upstream rename drops that one override rather than throwing, because a
 *  slightly-off basemap beats a blank pane. */
export function applyArchiveMindTheme<T>(style: T): T {
  const doc = style as StyleDoc;
  if (!Array.isArray(doc.layers)) return style;

  const hidden = new Set(HIDDEN_LAYERS);
  doc.layers = doc.layers.filter((layer) => !hidden.has(layer.id));

  for (const layer of doc.layers) {
    const paint = PAINT_OVERRIDES[layer.id];
    if (paint) layer.paint = { ...layer.paint, ...paint };
    const layout = LAYOUT_OVERRIDES[layer.id];
    if (layout) layer.layout = { ...layer.layout, ...layout };
    const zoom = ZOOM_RANGES[layer.id];
    if (zoom) {
      layer.minzoom = zoom[0];
      layer.maxzoom = zoom[1];
    }
    // Every place label, whatever its tier, drops to a single script.
    if (layer.type === "symbol" && layer.id.startsWith("place_")) {
      layer.layout = { ...layer.layout, "text-field": ENGLISH_LABEL };
    }
  }

  for (const source of Object.values(doc.sources ?? {})) {
    source.attribution = BASEMAP_ATTRIBUTION;
  }
  return style;
}

/** Exported for the test that guards against overriding a layer that the
 *  upstream style no longer has — a silent no-op otherwise. */
export const HIDDEN_LAYER_IDS: readonly string[] = HIDDEN_LAYERS;
/** Layers we actively style, as opposed to remove. */
export const STYLED_LAYER_IDS: readonly string[] = [
  ...Object.keys(PAINT_OVERRIDES),
  ...Object.keys(LAYOUT_OVERRIDES),
  ...Object.keys(ZOOM_RANGES),
];

export const THEMED_LAYER_IDS = [
  ...HIDDEN_LAYERS,
  ...Object.keys(PAINT_OVERRIDES),
  ...Object.keys(LAYOUT_OVERRIDES),
  ...Object.keys(ZOOM_RANGES),
];
