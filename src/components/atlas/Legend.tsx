// Bottom-left legend explaining pin ranks, density, and road types.

export function Legend() {
  return (
    <div className="bg-white rounded-md shadow-md px-3 py-2.5 text-xs text-stone-700 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-stone-500">Legend</div>
      <div className="grid grid-cols-[28px_1fr] gap-x-2 gap-y-1.5 items-center">
        <svg width="28" height="20" viewBox="-14 -10 28 20">
          <circle cx={0} cy={0} r={9} fill="#ffffff" stroke="#3a3a36" strokeWidth={1.4} />
          <circle cx={0} cy={0} r={5} fill="#3a3a36" />
          <circle cx={0} cy={0} r={1.8} fill="#ffffff" />
        </svg>
        <span>Capital — central topic</span>

        <svg width="28" height="20" viewBox="-14 -10 28 20">
          <circle cx={0} cy={0} r={6} fill="#3a3a36" stroke="#ffffff" strokeWidth={1.6} />
        </svg>
        <span>City — significant point</span>

        <svg width="28" height="20" viewBox="-14 -10 28 20">
          <circle cx={0} cy={0} r={3.2} fill="#3a3a36" />
        </svg>
        <span>Town — minor point</span>

        <svg width="28" height="20" viewBox="-14 -10 28 20">
          <rect x={-10} y={-2} width={3} height={6} fill="#9b9384" opacity={0.6} />
          <rect x={-6} y={-5} width={3} height={9} fill="#9b9384" opacity={0.6} />
          <rect x={-2} y={-3} width={3} height={7} fill="#9b9384" opacity={0.6} />
          <rect x={2} y={-1} width={3} height={5} fill="#9b9384" opacity={0.6} />
        </svg>
        <span>Density — discussion volume</span>
      </div>

      <div className="pt-1.5 border-t border-stone-200" />
      <div className="grid grid-cols-[28px_1fr] gap-x-2 gap-y-1.5 items-center">
        <svg width="28" height="10" viewBox="0 0 28 10">
          <line x1={2} y1={5} x2={26} y2={5} stroke="#e69138" strokeWidth={7} strokeLinecap="round" />
          <line x1={2} y1={5} x2={26} y2={5} stroke="#fbe2b6" strokeWidth={4} strokeLinecap="round" />
        </svg>
        <span>Highway — main axis</span>

        <svg width="28" height="10" viewBox="0 0 28 10">
          <line x1={2} y1={5} x2={26} y2={5} stroke="#cfcbc1" strokeWidth={4.5} strokeLinecap="round" />
          <line x1={2} y1={5} x2={26} y2={5} stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
        <span>Regular — derived link</span>

        <svg width="28" height="10" viewBox="0 0 28 10">
          <line
            x1={2}
            y1={5}
            x2={26}
            y2={5}
            stroke="#9b9384"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        </svg>
        <span>Trail — weak link</span>
      </div>
    </div>
  );
}
