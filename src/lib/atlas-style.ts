// Single source of truth for atlas visual styling.
// All atlas components read from here — to change look-and-feel, edit only this file.
// (No component should hard-code colors, font sizes, stroke widths, etc.)

export const ATLAS_STYLE = {
  // ── Sea / map background ───────────────────────────────────────────────────
  // Snazzy "Interface Map" — soft cyan water.
  sea: {
    color: "#aee0f4",
    grainOpacity: 0.35,
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
    family: '"Helvetica Neue", -apple-system, system-ui, sans-serif',
  },

  // ── Biome (terrain in city-less regions) ───────────────────────────────────
  // City neighbourhoods stay cream/white; far-from-cities areas show terrain.
  // Each country picks one biome deterministically from its name hash.
  biome: {
    forest: "#b8c9a8", // soft yellow-green (highland / forest feel)
    desert: "#d4c08a", // soft yellow-brown (desert feel)
  },
  civil: {
    // Per-city radial-gradient blob: white at the city, fading to transparent
    // → reveals the biome colour underneath in city-less regions.
    blobRadius: 110,
    blobInnerStop: 0.0,
    blobOuterStop: 1.0,
    blobInnerOpacity: 1.0,
    blobOuterOpacity: 0.0,
  },

  // ── Country (land mass + name label) ───────────────────────────────────────
  // Snazzy "Interface Map" — uniform cream landscape near cities; biome colour
  // shows through in empty regions via the civil-blob radial gradient.
  country: {
    useUniformFill: false, // biome instead — fillColor below is ignored when useUniformFill=false
    fillColor: "#f9f5ed",
    strokeColor: "#d8d2c2",
    strokeWidth: 1.0,
    haloOffsetY: 0,
    haloOpacity: 0,
    label: {
      fontSize: 20,
      fontWeight: 500,
      letterSpacing: 5,
      color: "#878787",
      haloColor: "#f9f5ed",
      haloWidth: 0, // Snazzy: labels.text.stroke = off
      opacity: 1,
      uppercase: true,
      jaFontSize: 13,
      jaFontWeight: 400,
      jaColor: "#a0a0a0",
      jaLetterSpacing: 3,
      jaOffsetY: 20,
      jaHaloWidth: 0,
    },
  },

  // ── District (sub-cluster label, mid-zoom only) ────────────────────────────
  district: {
    label: {
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: 2.5,
      color: "#878787",
      haloColor: "#f9f5ed",
      haloWidth: 0,
      uppercase: true,
      jaFontSize: 9,
      jaColor: "#a0a0a0",
      jaLetterSpacing: 2,
      jaOffsetY: 11,
      jaHaloWidth: 0,
      yOffsetPx: -28, // unscaled pixels above district centroid
    },
    fadeInScale: { min: 1.2, max: 1.6 },
  },

  // ── Cities: pins (rank-dependent geometry) ─────────────────────────────────
  cityPin: {
    capital: {
      outerR: 6.5,
      innerR: 3,
      fillOuter: "#ffffff",
      fillInner: "#3a3a36",
      strokeColor: "#3a3a36",
      strokeWidth: 1.4,
      shadow: true,
    },
    city: {
      outerR: 4.5,
      fillOuter: "#3a3a36",
      strokeColor: "#ffffff",
      strokeWidth: 1.2,
      shadow: true,
    },
    town: {
      outerR: 3,
      fillOuter: "#5a5650",
      strokeColor: "#5a5650",
      strokeWidth: 0,
      shadow: false,
    },
    selectionHaloColor: "#3367d6",
    selectionHaloOpacity: 0.18,
    selectionHaloPad: 5,
  },

  // ── Cities: labels (rank-dependent type) ───────────────────────────────────
  // Snazzy "Interface Map" — all labels #878787, no stroke.
  cityLabel: {
    capital: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: 0.3,
      color: "#5e5e5e",
      haloColor: "#f9f5ed",
      haloWidth: 0,
      labelDy: 18,
      minScale: 0,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#a0a0a0",
      jaHaloWidth: 0,
    },
    city: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0,
      color: "#878787",
      haloColor: "#f9f5ed",
      haloWidth: 0,
      labelDy: 14,
      minScale: 0.55,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#a0a0a0",
      jaHaloWidth: 0,
    },
    town: {
      fontSize: 9.5,
      fontWeight: 500,
      letterSpacing: 0,
      color: "#878787",
      haloColor: "#f9f5ed",
      haloWidth: 0,
      labelDy: 11,
      minScale: 1.0,
      showJa: false,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#a0a0a0",
      jaHaloWidth: 0,
    },
  },

  // ── Roads (per RoadType) ──────────────────────────────────────────────────
  // Single solid stroke per road (no casing). All dashed styles dropped — Google
  // Maps roads are continuous. minScale hides lower-importance roads at wide view
  // so the map stays readable; highways are always visible (minScale 0).
  road: {
    highway: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#e69138", width: 3.5, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0,
    },
    regular: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#b0a896", width: 2.2, dash: undefined as string | undefined, opacity: 1 },
      minScale: 0.7,
    },
    trail: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#7d6a4a", width: 1.5, dash: undefined as string | undefined, opacity: 0.9 },
      minScale: 1.5,
    },
    ferry: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#3367d6", width: 1.5, dash: undefined as string | undefined, opacity: 0.9 },
      minScale: 0.7,
    },
  },

  // ── Road number badge (Google-Maps-style highway shield) ──────────────────
  roadNumber: {
    fontSize: 9,
    fontWeight: 600,
    textColor: "#3a3a36",
    bgFill: "#ffffff",
    bgStroke: "#aaa",
    bgStrokeWidth: 0.5,
    bgWidth: 16,
    bgHeight: 14,
    bgRadius: 3,
    minScale: 0.85, // don't show badges at very wide view
  },
} as const;

export type AtlasStyle = typeof ATLAS_STYLE;
