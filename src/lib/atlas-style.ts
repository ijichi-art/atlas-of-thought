// Single source of truth for atlas visual styling.
// All atlas components read from here — to change look-and-feel, edit only this file.
// (No component should hard-code colors, font sizes, stroke widths, etc.)
//
// Palette: Google-Maps style (see globals.css :root for canonical CSS-var copy).

export const ATLAS_STYLE = {
  // ── Sea / map background ───────────────────────────────────────────────────
  // Flat pale-blue water, no texture. Tone eyedropped from real Google Maps.
  sea: {
    color: "#aaccdd", // --map-water (toned down from spec's #aadaff)
    grainOpacity: 0, // paper grain disabled (kept in defs for backward-compat)
    grainBaseFreq: 0.9,
  },

  // ── Zoom range and behavior ────────────────────────────────────────────────
  zoom: {
    min: 0.4,
    max: 12,
    initial: 1,
  },

  // ── Typography (shared) ────────────────────────────────────────────────────
  font: {
    // Loaded by next/font/google in src/app/layout.tsx (Inter + Noto Sans JP).
    // Components apply this via the `style` prop so that var() resolves.
    family:
      'var(--font-inter), var(--font-noto-jp), -apple-system, system-ui, sans-serif',
  },

  // ── Biome (terrain in city-less regions) ───────────────────────────────────
  // Currently inert (useUniformFill=true uses the land color uniformly).
  // Kept for future park/forest overlays.
  biome: {
    forest: "#b8d4a8", // --map-park
    desert: "#ece5d3", // --map-built-up (used as alt urban tone)
  },
  civil: {
    // Per-city built-up polygon fill (yellow-beige urban tone over land).
    blobRadius: 110,
    blobInnerStop: 0.0,
    blobOuterStop: 1.0,
    blobInnerOpacity: 1.0,
    blobOuterOpacity: 0.0,
    // Notably darker than country fill (#ece5d3) so cluster cores stand
    // out clearly. Earlier #ddd0b5 was too close to the country tone and
    // clusters disappeared under road clutter at default zoom.
    blobColor: "#cfb78a",
  },

  // ── Country (land mass + name label) ───────────────────────────────────────
  country: {
    useUniformFill: true,
    // Built-up beige across the whole country — matches Manhattan / LA /
    // Chicago at neighborhood zoom, where the city covers the viewport
    // continuously and green is the exception (parks). Cluster cities then
    // use a slightly DARKER beige (civil.blobColor) to subtly distinguish
    // their cores without drawing hard polygon boundaries.
    fillColor: "#ece5d3", // --map-built-up
    strokeColor: "#b8b3a8", // --border-country
    strokeWidth: 1.5,
    strokeDash: "4 3", // dotted border per spec rule G
    haloOffsetY: 0,
    haloOpacity: 0,
    label: {
      fontSize: 24,
      fontWeight: 300,
      letterSpacing: 7, // ~0.3em on 24px
      color: "#5a5a5a", // --label-country
      haloColor: "#ffffff", // --label-stroke
      haloWidth: 4,
      opacity: 0.5,
      // Country labels are most readable at wide view and fade as the user
      // zooms in (they get in the way at street level).
      fadeStart: 1.0,
      fadeEnd: 2.5,
      uppercase: true,
      jaFontSize: 13,
      jaFontWeight: 400,
      jaColor: "#757575",
      jaLetterSpacing: 3,
      jaOffsetY: 22,
      jaHaloWidth: 3,
    },
  },

  // ── District (sub-cluster label, mid-zoom only) ────────────────────────────
  district: {
    label: {
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: 2.5,
      color: "#757575", // --label-district
      haloColor: "#ffffff",
      haloWidth: 3,
      uppercase: true,
      jaFontSize: 9,
      jaColor: "#8a8a8a",
      jaLetterSpacing: 2,
      jaOffsetY: 11,
      jaHaloWidth: 2,
      yOffsetPx: -28,
    },
    fadeInScale: { min: 1.2, max: 1.6 },
  },

  // ── Cities: pins (rank-dependent geometry) ─────────────────────────────────
  cityPin: {
    capital: {
      outerR: 6.5,
      innerR: 3,
      fillOuter: "#ffffff",
      fillInner: "#d65a4a", // --landmark-poi
      strokeColor: "#d65a4a",
      strokeWidth: 1.4,
      shadow: true,
    },
    city: {
      outerR: 4.5,
      fillOuter: "#d65a4a", // --landmark-poi
      strokeColor: "#ffffff",
      strokeWidth: 1.2,
      shadow: true,
    },
    town: {
      outerR: 3,
      fillOuter: "#5a5a5a",
      strokeColor: "#5a5a5a",
      strokeWidth: 0,
      shadow: false,
    },
    selectionHaloColor: "#1976d2", // --landmark-transit
    selectionHaloOpacity: 0.22,
    selectionHaloPad: 5,
  },

  // ── Cities: labels (rank-dependent type) ───────────────────────────────────
  cityLabel: {
    capital: {
      fontSize: 14,
      fontWeight: 500,
      letterSpacing: 0.3,
      color: "#2c2c2c", // --label-city-major
      haloColor: "#ffffff",
      haloWidth: 3,
      labelDy: 18,
      minScale: 0,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#5a5a5a",
      jaHaloWidth: 3,
    },
    city: {
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: 0,
      color: "#5a5a5a", // --label-city-minor
      haloColor: "#ffffff",
      haloWidth: 3,
      labelDy: 14,
      minScale: 0.55,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#757575",
      jaHaloWidth: 3,
    },
    town: {
      fontSize: 11,
      fontWeight: 400,
      letterSpacing: 0,
      color: "#757575",
      haloColor: "#ffffff",
      haloWidth: 3,
      labelDy: 11,
      minScale: 1.0,
      showJa: false,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#8a8a8a",
      jaHaloWidth: 2,
    },
  },

  // ── Roads (per RoadType) ──────────────────────────────────────────────────
  // Casing+fill double-stroke is wired by Road.tsx in Step 3.
  // Type mapping (existing RoadType → road hierarchy):
  //   highway → highway, regular → arterial, trail → collector, ferry → transit
  road: {
    // Curve magnitude is no longer per type — Road.tsx now derives the
    // bezier control point from the segment endpoints alone, so any roads
    // sharing a trunk segment trace identical curves regardless of type.
    //
    // Roads here represent SEMANTIC links (cluster→cluster), not physical
    // infrastructure. They have to read as background — bold yellow strokes
    // were dominating the canvas at zoom 1, drowning out the cities. Now:
    //   - widths halved (highway 6→2.5, regular 4→1.2, trail 2.5→0.8)
    //   - colors desaturated (less yellow, more "pale arterial")
    //   - weight-based LOD: weak edges (weight=1) only show in a narrow
    //     mid-zoom band; strong edges always show. Drops visible road
    //     count from ~230 to ~30-50 at default zoom — matches the visible
    //     street count at Manhattan zoom 14 (~30-40).
    highway: {
      casing: { color: "#dba955", width: 3 } as { color: string; width: number } | undefined,
      fill: { color: "#f0d585", width: 1.6, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0,
      // Hide at street zoom — when the user is examining cluster interiors,
      // long cross-canvas highways are clutter, not orientation.
      maxScale: 1.8,
      weightFloor: 0,
    },
    regular: {
      casing: { color: "#e0cf9c", width: 2.4 } as { color: string; width: number } | undefined,
      fill: { color: "#f5e7b8", width: 1.2, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0,
      maxScale: 2.0,
      // Hide weight=1 regular roads everywhere — they're the noisy fragments.
      weightFloor: 2,
    },
    trail: {
      casing: { color: "#d8d4ca", width: 1.5 } as { color: string; width: number } | undefined,
      fill: { color: "#ffffff", width: 0.8, dash: undefined as string | undefined, opacity: 0.9 },
      minScale: 0.7,
      maxScale: 1.8,
      weightFloor: 2,
    },
    ferry: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#1976d2", width: 1.0, dash: "4 3" as string | undefined, opacity: 0.85 },
      minScale: 0.6,
      maxScale: 2.0,
      weightFloor: 0,
    },
  },

  // ── City street blocks (internal grid, street-level zoom only) ───────────
  cityBlocks: {
    // Lowered from 1.8 so the inside of cluster cities reads as populated
    // even at the default zoom. With cities now sized larger (Phase 6
    // built-up R bump), the grids fit visibly without crowding.
    minScale: 1.0,
  },

  // ── POIs (individual conversations inside a cluster city) ────────────────
  poi: {
    minScale: 1.0, // visible at default zoom — they're the city's interior
    labelMinScale: 2.0, // labels at city zoom so user can read POI text
    outerR: 5, // ~70% bigger so they read as the foreground above streets
    fill: "#d65a4a", // legacy fallback (kind-based color in POILayer)
    stroke: "#ffffff",
    strokeWidth: 1.5,
    selectionPad: 4,
    selectionHaloColor: "#1976d2",
    selectionHaloOpacity: 0.22,
    fontSize: 9,
    fontWeight: 500,
    color: "#2c2c2c",
    haloColor: "#ffffff",
    haloWidth: 3,
    labelDy: 9,
  },

  // ── Road labels (textPath along the road) ─────────────────────────────────
  // Only highway/arterial roads get a name label, and only at very tight
  // detail zoom (street level). Labels at default zoom were major clutter.
  roadLabel: {
    fontSize: 9, // user units; rendered as 9 / scale to stay constant on screen
    fontWeight: 500,
    color: "#8a8a8a", // --label-street
    haloColor: "#ffffff",
    haloWidth: 2.5,
    letterSpacing: 0.3,
    minScale: 3.5,
    // Show labels only on these road types (others stay anonymous).
    showOnTypes: ["highway", "regular"] as Array<"highway" | "regular" | "trail" | "ferry">,
  },

  // ── Road number badge (Google-Maps-style highway shield) ──────────────────
  roadNumber: {
    fontSize: 9,
    fontWeight: 600,
    textColor: "#2c2c2c", // --landmark-text
    bgFill: "#ffffff",
    bgStroke: "#b8b3a8",
    bgStrokeWidth: 0.5,
    bgWidth: 16,
    bgHeight: 14,
    bgRadius: 3,
    minScale: 0.85,
  },
} as const;

export type AtlasStyle = typeof ATLAS_STYLE;
