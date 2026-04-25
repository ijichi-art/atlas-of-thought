// Shared SVG <defs>. Filters, gradients, and patterns used across the atlas.

export function AtlasDefs() {
  return (
    <defs>
      {/* Subtle organic edge displacement for forest blobs */}
      <filter id="forest-noise" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="4" />
        <feDisplacementMap in="SourceGraphic" scale="11" />
      </filter>

      {/* Soft inner shadow on the country edge — gives depth */}
      <filter id="country-inset" x="-5%" y="-5%" width="110%" height="110%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur" />
        <feOffset in="blur" dx="0" dy="1" result="offsetBlur" />
        <feComposite in="offsetBlur" in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="inset" />
        <feColorMatrix
          in="inset"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0.18 0"
          result="darkened"
        />
        <feComposite in="darkened" in2="SourceGraphic" operator="atop" />
      </filter>

      {/* Soft drop shadow for pins / city dots */}
      <filter id="pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" />
        <feOffset dx="0" dy="0.8" result="shadow" />
        <feComponentTransfer in="shadow" result="dimmed">
          <feFuncA type="linear" slope="0.45" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="dimmed" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Paper grain — barely visible texture across the whole map */}
      <filter id="paper-grain" x="0%" y="0%" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" />
        <feColorMatrix
          values="0 0 0 0 0.2
                  0 0 0 0 0.18
                  0 0 0 0 0.15
                  0 0 0 0.04 0"
        />
      </filter>

      {/* Highway pattern — solid colored line */}
      {/* Trail pattern — dashed */}
      <pattern id="trail-dash" patternUnits="userSpaceOnUse" width="6" height="6">
        <rect width="6" height="6" fill="transparent" />
      </pattern>
    </defs>
  );
}

// Backdrop = sea/paper background. Sea color from the map, with a faint grain on top.
export function MapBackdrop({ width, height }: { width: number; height: number }) {
  return (
    <>
      <rect x={0} y={0} width={width} height={height} fill="#dde5ec" />
      <rect x={0} y={0} width={width} height={height} fill="#dde5ec" filter="url(#paper-grain)" opacity={0.6} />
    </>
  );
}
