interface FilmStripProps {
  frames?: number;
  className?: string;
  color?: string;
}

const FRAME_COLORS = [
  "#0d1b2a", "#1a0a2e", "#0a2218", "#2a1800", "#1a1a0a",
  "#0a1a2a", "#200a2a", "#0a2a1a", "#2a0a0a", "#1a2a0a",
];

export function FilmStrip({ frames = 10, className = "", color }: FilmStripProps) {
  return (
    <div className={`flex shrink-0 ${className}`}>
      {Array.from({ length: frames }).map((_, i) => (
        <div
          key={i}
          className="relative border-r border-black/40 shrink-0"
          style={{
            width: 32,
            height: 20,
            background: color ?? FRAME_COLORS[i % FRAME_COLORS.length],
          }}
        >
          {/* Sprocket holes top */}
          <div className="absolute top-0.5 left-1 w-1.5 h-1 bg-black/50 rounded-sm" />
          <div className="absolute top-0.5 right-1 w-1.5 h-1 bg-black/50 rounded-sm" />
          {/* Sprocket holes bottom */}
          <div className="absolute bottom-0.5 left-1 w-1.5 h-1 bg-black/50 rounded-sm" />
          <div className="absolute bottom-0.5 right-1 w-1.5 h-1 bg-black/50 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
