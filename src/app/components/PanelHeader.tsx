import type { ReactNode } from "react";
import { GripVertical } from "lucide-react";

interface PanelHeaderProps {
  label: string;
  accent?: string;
  right?: ReactNode;
  dot?: string;
}

export function PanelHeader({ label, accent, right, dot }: PanelHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-2 py-1.5 select-none shrink-0 border-b"
      style={{
        background: "var(--panel-header, #252527)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <GripVertical size={10} className="text-[#4a4a4e] cursor-grab" />
        {dot && (
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
        )}
        <span
          className="font-mono text-[10px] tracking-[0.18em] uppercase"
          style={{ color: accent ?? "#8a8a8e" }}
        >
          {label}
        </span>
      </div>
      {right && <div className="flex items-center gap-1">{right}</div>}
    </div>
  );
}
