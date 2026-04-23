// Water layer. Google-Maps-style: flat pale blue, no texture or stipple.
export function Sea({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  return <rect x={0} y={0} width={width} height={height} fill={color} />;
}
