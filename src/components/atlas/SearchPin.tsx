// Google-Maps-style red drop-pin shown at the target of a search
// selection. Inverse-scaled so the pin stays a constant size on screen
// regardless of map zoom. Click the pin to dismiss it.

export function SearchPin({
  x,
  y,
  scale,
  onDismiss,
}: {
  x: number;
  y: number;
  scale: number;
  onDismiss: () => void;
}) {
  const inv = 1 / scale;
  return (
    <g
      transform={`translate(${x} ${y}) scale(${inv})`}
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onDismiss();
      }}
    >
      {/* Subtle ground shadow under the pin tip */}
      <ellipse cx="0" cy="1" rx="6" ry="2" fill="rgba(0,0,0,0.25)" />
      {/* Pulsing halo so the pin is impossible to miss right after the
          camera flies in. The animation runs once for ~1.5s thanks to
          animation-iteration: 1 baked into the SVG attributes. */}
      <circle cx="0" cy="-18" r="14" fill="#ea4335" opacity="0.25">
        <animate
          attributeName="r"
          values="14;26;14"
          dur="1.5s"
          repeatCount="2"
        />
        <animate
          attributeName="opacity"
          values="0.25;0;0.25"
          dur="1.5s"
          repeatCount="2"
        />
      </circle>
      {/* Pin teardrop body — red Google-Maps style. The path tip sits
          at (0, 0) so positioning the group at (target.x, target.y)
          aligns the tip exactly with the search target. */}
      <path
        d="M 0,0 C -2,-4 -12,-8 -12,-18 C -12,-25 -6,-32 0,-32 C 6,-32 12,-25 12,-18 C 12,-8 2,-4 0,0 Z"
        fill="#ea4335"
        stroke="#b31412"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Inner white dot — Google Maps' cap-cutout look. */}
      <circle cx="0" cy="-20" r="5" fill="#ffffff" />
      <circle cx="0" cy="-20" r="3" fill="#ea4335" />
    </g>
  );
}
