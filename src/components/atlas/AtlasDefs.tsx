// Shared SVG <defs> for the Atlas. The Google-Maps-style background is just a
// flat fill — no paper texture — but we keep this file as the central place
// for any defs (gradients, patterns) the children may reference later.

export function AtlasDefs() {
  return <defs />;
}

export function MapBackdrop({ width, height }: { width: number; height: number }) {
  return <rect x={0} y={0} width={width} height={height} fill="#f5f3ef" />;
}
