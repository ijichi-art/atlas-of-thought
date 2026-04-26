// Single source of truth for atlas visual styling.
// All atlas components read from here — to change look-and-feel, edit only this file.
// (No component should hard-code colors, font sizes, stroke widths, etc.)
//
// Palette: Google-Maps style (see globals.css :root for canonical CSS-var copy).

export const ATLAS_STYLE = {
  // ── Sea / map background ───────────────────────────────────────────────────
  // Flat pale-blue water, no texture.
  sea: {
    color: "#aadaff", // --map-water
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
    forest: "#c8e6c9", // --map-park
    desert: "#ebe8e1", // --map-built-up (used as alt urban tone)
  },
  civil: {
    // Per-city radial-gradient blob; faded built-up beige inside the country.
    blobRadius: 110,
    blobInnerStop: 0.0,
    blobOuterStop: 1.0,
    blobInnerOpacity: 1.0,
    blobOuterOpacity: 0.0,
    blobColor: "#ebe8e1", // --map-built-up (subtle urban tint over land)
  },

  // ── Country (land mass + name label) ───────────────────────────────────────
  country: {
    useUniformFill: true,
    fillColor: "#f5f5f3", // --map-land
    strokeColor: "#b8b3a8", // --border-country
    strokeWidth: 1.5,
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
    highway: {
      casing: { color: "#f29400", width: 8 } as { color: string; width: number } | undefined,
      fill: { color: "#fbb03b", width: 6, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0,
    },
    regular: {
      casing: { color: "#e6c84c", width: 6 } as { color: string; width: number } | undefined,
      fill: { color: "#ffe167", width: 4, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0.4,
    },
    trail: {
      casing: { color: "#d8d4ca", width: 4 } as { color: string; width: number } | undefined,
      fill: { color: "#ffffff", width: 2.5, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0.8,
    },
    ferry: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#1976d2", width: 1.5, dash: "4 3" as string | undefined, opacity: 0.9 },
      minScale: 0.7,
    },
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
