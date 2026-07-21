import { describe, expect, it } from "vitest";
import {
  applyArchiveMindTheme,
  BASEMAP_ATTRIBUTION,
  HIDDEN_LAYER_IDS,
  STYLED_LAYER_IDS,
  THEMED_LAYER_IDS,
} from "./map-style";

/** The layer ids OpenFreeMap's `dark` style shipped when this theme was
 *  written (fetched 2026-07-21, 47 layers). It exists to catch a typo in a
 *  layer id, which would otherwise be a silent no-op — the override simply
 *  never applies and the basemap quietly keeps its stock colour. It cannot
 *  catch an upstream rename; `applyArchiveMindTheme` is written to tolerate
 *  that rather than throw. */
const UPSTREAM_LAYER_IDS = [
  "background", "water", "landcover_ice_shelf", "landcover_glacier", "landuse_residential",
  "landcover_wood", "landuse_park", "waterway", "water_name", "building", "aeroway-taxiway",
  "aeroway-runway-casing", "aeroway-area", "aeroway-runway", "road_area_pier", "road_pier",
  "highway_path", "highway_minor", "highway_major_casing", "highway_major_inner",
  "highway_major_subtle", "highway_motorway_casing", "highway_motorway_inner", "road_oneway",
  "road_oneway_opposite", "highway_motorway_subtle", "railway_transit", "railway_transit_dashline",
  "railway_minor", "railway_minor_dashline", "railway", "railway_dashline", "highway_name_other",
  "highway_name_motorway", "boundary_state", "boundary_country_z0-4", "boundary_country_z5-",
  "place_other", "place_suburb", "place_village", "place_town", "place_city", "place_city_large",
  "place_state", "place_country_other", "place_country_minor", "place_country_major",
];

describe("map theme", () => {
  it("only names layers the upstream style actually has", () => {
    const unknown = THEMED_LAYER_IDS.filter((id) => !UPSTREAM_LAYER_IDS.includes(id));
    expect(unknown).toEqual([]);
  });

  it("removes the layers that compete with the photographs", () => {
    const style = applyArchiveMindTheme({
      layers: UPSTREAM_LAYER_IDS.map((id) => ({ id, paint: { "fill-color": "#ff00ff" } })),
      sources: { openmaptiles: {} },
    });
    const ids = style.layers.map((l) => l.id);
    for (const gone of ["railway", "aeroway-runway", "highway_path", "water_name", "place_other"]) {
      expect(ids, gone).not.toContain(gone);
    }
    // Everything that carries meaning survives.
    for (const kept of ["background", "water", "boundary_country_z5-", "place_city"]) {
      expect(ids, kept).toContain(kept);
    }
  });

  it("repaints land and water onto our own near-black tokens", () => {
    const style = applyArchiveMindTheme({
      layers: [
        { id: "background", paint: { "background-color": "rgb(12,12,12)" } },
        { id: "water", paint: { "fill-color": "rgb(27,27,29)", "fill-antialias": false } },
      ],
      sources: {},
    });
    expect(style.layers[0].paint).toMatchObject({ "background-color": "#080808" });
    // Untouched properties on an overridden layer are preserved, not replaced.
    expect(style.layers[1].paint).toMatchObject({ "fill-color": "#101013", "fill-antialias": false });
  });

  it("stamps the attribution both licences require onto every source", () => {
    const style = applyArchiveMindTheme({
      layers: [{ id: "background" }],
      sources: { openmaptiles: {}, ne2_shaded: {} } as Record<string, { attribution?: string }>,
    });
    expect(style.sources.openmaptiles.attribution).toBe(BASEMAP_ATTRIBUTION);
    expect(style.sources.ne2_shaded.attribution).toBe(BASEMAP_ATTRIBUTION);
    expect(BASEMAP_ATTRIBUTION).toContain("OpenStreetMap");
  });

  it("survives a style shaped differently than expected instead of throwing", () => {
    expect(() => applyArchiveMindTheme({} as { layers?: never })).not.toThrow();
    expect(() => applyArchiveMindTheme({ layers: [{ id: "unknown_layer" }], sources: {} })).not.toThrow();
  });
});

describe("map theme — restraint", () => {
  interface TestLayer {
    id: string;
    type: string;
    layout?: Record<string, unknown>;
    minzoom?: number;
    maxzoom?: number;
  }

  const themed = (): { layers: TestLayer[] } =>
    applyArchiveMindTheme<{ layers: TestLayer[]; sources: Record<string, unknown> }>({
      layers: UPSTREAM_LAYER_IDS.map((id) => ({
        id,
        type: id.startsWith("place_") ? "symbol" : "line",
        layout: id.startsWith("place_")
          ? { "text-field": ["case", ["has", "name:nonlatin"], ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]], ["get", "name:latin"]] }
          : undefined,
      })),
      sources: {},
    });

  it("drops more than half the upstream layers", () => {
    // 47 layers of a general-purpose basemap, of which a photo map needs a
    // fraction; the rest is texture competing with the thumbnails.
    expect(themed().layers.length).toBeLessThan(UPSTREAM_LAYER_IDS.length / 2);
  });

  it("removes the grey veil and the road casings", () => {
    const ids = themed().layers.map((l) => l.id);
    // Residential fills drew from z0 and read as a haze over whole countries.
    expect(ids).not.toContain("landuse_residential");
    // Casings redraw the same geometry to outline it — invisible as depth on
    // near-black, plainly visible as a doubled line.
    expect(ids).not.toContain("highway_major_casing");
    expect(ids).not.toContain("highway_motorway_casing");
    expect(ids).not.toContain("highway_motorway_subtle");
  });

  it("collapses every place label to a single name", () => {
    for (const layer of themed().layers) {
      if (!layer.id.startsWith("place_")) continue;
      const field = JSON.stringify(layer.layout?.["text-field"]);
      expect(field, layer.id).toContain("name:en");
      // The upstream two-line concat is what doubled the ink of every label.
      expect(field, layer.id).not.toContain("concat");
      expect(field, layer.id).not.toContain("nonlatin");
    }
  });

  it("holds each label tier back to the zoom where it is the useful unit", () => {
    const byId = new Map(themed().layers.map((l) => [l.id, l]));
    const minzoom = (id: string) => byId.get(id)?.minzoom;
    // Oblast names blanketing a continent was the reported complaint.
    expect(minzoom("place_state")).toBeGreaterThanOrEqual(6);
    // And the tiers stay in order: countries, then cities, then towns.
    expect(minzoom("place_city")).toBeGreaterThan(minzoom("place_city_large") as number);
    expect(minzoom("place_town")).toBeGreaterThan(minzoom("place_city") as number);
    expect(minzoom("place_village")).toBeGreaterThan(minzoom("place_town") as number);
    // Minor streets are meaningless until the map is genuinely close in.
    expect(minzoom("highway_minor")).toBeGreaterThanOrEqual(14);
  });

  it("never styles a layer it has already removed", () => {
    // A paint or zoom rule for a hidden layer is a silent no-op, and reads as
    // an intention the map does not actually honour. This fails the moment
    // the two lists drift apart.
    const hidden = new Set(HIDDEN_LAYER_IDS);
    expect(STYLED_LAYER_IDS.filter((id) => hidden.has(id))).toEqual([]);
  });

  it("keeps every themed id real", () => {
    expect(THEMED_LAYER_IDS.filter((id) => !UPSTREAM_LAYER_IDS.includes(id))).toEqual([]);
  });
});
