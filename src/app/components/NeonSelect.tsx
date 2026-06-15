import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export type NeonOption = { value: string; label: string };

const f = "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";

/**
 * Custom dropdown that replaces the native <select> so the popup can carry the
 * neon gradient-ring border and a prismatic highlight on the hovered/selected
 * option (native option lists can't be styled). Used app-wide for selects.
 */
export function NeonSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: NeonOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-active={open}
        className="neon-btn w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md"
        style={{ background: "rgba(31,24,50,0.55)", color: "#ececf4", fontFamily: f, fontSize: 13, fontWeight: 500 }}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown size={14} style={{ color: "var(--tool-accent)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div
          className="neon absolute left-0 right-0 top-full mt-1 z-50 rounded-md overflow-hidden py-1"
          style={{ background: "rgba(26,20,44,0.92)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              data-selected={o.value === value}
              className="neon-option w-full text-left px-3 py-2 block"
              style={{ fontFamily: f, fontSize: 13, fontWeight: o.value === value ? 600 : 500, color: o.value === value ? "#ffffff" : "#d6d6e0" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
