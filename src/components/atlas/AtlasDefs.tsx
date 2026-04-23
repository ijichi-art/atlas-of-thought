// Shared SVG <defs>. Filters and gradients used across the atlas.

export function AtlasDefs() {
  return (
    <defs>
      {/* Subtle organic edge displacement for forest blobs */}
      <filter id="forest-noise" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="4" />
        <feDisplacementMap in="SourceGraphic" scale="11" />
      </filter>
      {/* Soft drop shadow used for the south-east "hillshade" feel */}
      <filter id="hill-shade" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
        <feOffset dx="3" dy="4" result="shadow" />
        <feComponentTransfer in="shadow" result="dimmed">
          <feFuncA type="linear" slope="0.45" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="dimmed" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

export function MapBackdrop({ width, height }: { width: number; height: number }) {
  return <rect x={0} y={0} width={width} height={height} fill="#f5f3ef" />;
}
