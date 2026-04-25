// Single source of truth for atlas visual styling.
// All atlas components read from here — to change look-and-feel, edit only this file.
// (No component should hard-code colors, font sizes, stroke widths, etc.)

export const ATLAS_STYLE = {
  // ── Sea / map background ───────────────────────────────────────────────────
  sea: {
    color: "#dde5ec",
    grainOpacity: 0.6,
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

  // ── Country (land mass + name label) ───────────────────────────────────────
  country: {
    strokeColor: "#9aa3aa",
    strokeWidth: 1.1,
    haloOffsetY: 4,
    haloOpacity: 0.4,
    label: {
      fontSize: 20,
      fontWeight: 500,
      letterSpacing: 5,
      color: "#3a3a36",
      haloColor: "#f5f3ef",
      haloWidth: 5,
      opacity: 0.78,
      uppercase: true,
      jaFontSize: 13,
      jaFontWeight: 400,
      jaColor: "#6a655e",
      jaLetterSpacing: 3,
      jaOffsetY: 20,
      jaHaloWidth: 4,
    },
  },

  // ── District (sub-cluster label, mid-zoom only) ────────────────────────────
  district: {
    label: {
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: 2.5,
      color: "#736a5e",
      haloColor: "#f5f3ef",
      haloWidth: 4,
      uppercase: true,
      jaFontSize: 9,
      jaColor: "#8a8175",
      jaLetterSpacing: 2,
      jaOffsetY: 11,
      jaHaloWidth: 3,
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
  cityLabel: {
    capital: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: 0.3,
      color: "#1f1d1a",
      haloColor: "#f5f3ef",
      haloWidth: 4,
      labelDy: 18,
      minScale: 0,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#5a5650",
      jaHaloWidth: 3.5,
    },
    city: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0,
      color: "#1f1d1a",
      haloColor: "#f5f3ef",
      haloWidth: 4,
      labelDy: 14,
      minScale: 0.55,
      showJa: true,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#5a5650",
      jaHaloWidth: 3.5,
    },
    town: {
      fontSize: 9.5,
      fontWeight: 500,
      letterSpacing: 0,
      color: "#1f1d1a",
      haloColor: "#f5f3ef",
      haloWidth: 4,
      labelDy: 11,
      minScale: 1.0,
      showJa: false,
      jaFontSizeRatio: 0.78,
      jaFontWeight: 400,
      jaColor: "#5a5650",
      jaHaloWidth: 3.5,
    },
  },

  // ── Roads (per RoadType) ──────────────────────────────────────────────────
  road: {
    highway: {
      casing: { color: "#e69138", width: 7 },
      fill: { color: "#fbe2b6", width: 4, dash: undefined as string | undefined, opacity: 1 },
    },
    regular: {
      casing: { color: "#cfcbc1", width: 4.5 },
      fill: { color: "#ffffff", width: 2.5, dash: undefined as string | undefined, opacity: 1 },
    },
    trail: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#7d6a4a", width: 1.6, dash: "5 4", opacity: 0.85 },
    },
    ferry: {
      casing: undefined as undefined | { color: string; width: number },
      fill: { color: "#3367d6", width: 1.6, dash: "2 5", opacity: 0.85 },
    },
  },
} as const;

export type AtlasStyle = typeof ATLAS_STYLE;
