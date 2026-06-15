import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export type FormatCategory = "video" | "image" | "audio";

export type Format = {
  id: string;
  label: string;
  category: FormatCategory;
  desc?: string;
};

const ALL_FORMATS: Format[] = [
  // Video
  { id: "MP4",    label: "MP4",    category: "video", desc: "H.264/H.265" },
  { id: "MOV",    label: "MOV",    category: "video", desc: "Apple ProRes" },
  { id: "MKV",    label: "MKV",    category: "video", desc: "Matroska" },
  { id: "WEBM",   label: "WEBM",   category: "video", desc: "VP9/AV1" },
  { id: "AVI",    label: "AVI",    category: "video", desc: "Legacy" },
  { id: "GIF",    label: "GIF",    category: "video", desc: "Animated" },
  { id: "FLV",    label: "FLV",    category: "video", desc: "Flash" },
  { id: "WMV",    label: "WMV",    category: "video", desc: "Windows" },
  { id: "HEVC",   label: "HEVC",   category: "video", desc: "H.265" },
  { id: "ProRes", label: "ProRes", category: "video", desc: "422/4444" },
  { id: "DNxHD",  label: "DNxHD",  category: "video", desc: "Avid" },
  { id: "MXF",    label: "MXF",    category: "video", desc: "Broadcast" },
  // Image
  { id: "PNG",    label: "PNG",    category: "image", desc: "Lossless" },
  { id: "JPG",    label: "JPG",    category: "image", desc: "Lossy" },
  { id: "WEBP",   label: "WEBP",   category: "image", desc: "Web" },
  { id: "TIFF",   label: "TIFF",   category: "image", desc: "Print" },
  { id: "AVIF",   label: "AVIF",   category: "image", desc: "Modern" },
  { id: "EXR",    label: "EXR",    category: "image", desc: "HDR/VFX" },
  { id: "DNG",    label: "DNG",    category: "image", desc: "Raw" },
  { id: "PSD",    label: "PSD",    category: "image", desc: "Photoshop" },
  { id: "BMP",    label: "BMP",    category: "image", desc: "Bitmap" },
  { id: "SVG",    label: "SVG",    category: "image", desc: "Vector" },
  // Audio
  { id: "MP3",    label: "MP3",    category: "audio", desc: "Lossy" },
  { id: "WAV",    label: "WAV",    category: "audio", desc: "Lossless" },
  { id: "FLAC",   label: "FLAC",   category: "audio", desc: "Lossless" },
  { id: "AAC",    label: "AAC",    category: "audio", desc: "Apple" },
  { id: "OGG",    label: "OGG",    category: "audio", desc: "Open" },
];

interface FormatPickerProps {
  value: string | null;
  onChange: (fmt: Format) => void;
  allowedCategories?: FormatCategory[];
  placeholder?: string;
}

const CATEGORY_LABELS: Record<FormatCategory, string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
};

export function FormatPicker({
  value,
  onChange,
  allowedCategories,
  placeholder = "Select Format",
}: FormatPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FormatCategory>("video");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const categories: FormatCategory[] = allowedCategories ?? ["video", "image", "audio"];
  const selected = ALL_FORMATS.find((f) => f.id === value);
  // Fall back to the first allowed category so an image-only picker opens on the
  // Image tab (showing every image format) instead of an empty Video tab.
  const effectiveTab = categories.includes(activeTab) ? activeTab : categories[0];

  const filtered = ALL_FORMATS.filter((f) => {
    const matchCat = search ? true : f.category === effectiveTab;
    const matchSearch = f.label.toLowerCase().includes(search.toLowerCase()) ||
      (f.desc ?? "").toLowerCase().includes(search.toLowerCase());
    const allowed = categories.includes(f.category);
    return allowed && matchCat && matchSearch;
  });

  // Group by category when searching
  const grouped = search
    ? categories.reduce<Record<string, Format[]>>((acc, cat) => {
        const hits = filtered.filter((f) => f.category === cat);
        if (hits.length) acc[cat] = hits;
        return acc;
      }, {})
    : null;

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative" style={{ minWidth: 200 }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        data-active={open}
        className="neon-btn flex items-center gap-2.5 px-4 py-3 rounded-lg w-full transition-all"
        style={{
          background: open ? "rgba(50,40,71,0.25)" : "rgba(39,31,58,0.22)",
          boxShadow: open ? "0 0 0 3px color-mix(in srgb, var(--tool-accent) 12%, transparent)" : "none",
        }}
      >
        {selected ? (
          <>
            <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 15, fontWeight: 700, color: "#ebebeb" }}>
              {selected.label}
            </span>
            <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2", marginLeft: 2 }}>
              {selected.desc}
            </span>
          </>
        ) : (
          <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 14, color: "#b6b6c2" }}>
            {placeholder}
          </span>
        )}
        <ChevronDown
          size={15}
          className="ml-auto transition-transform"
          style={{ color: "#b6b6c2", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="neon absolute left-0 top-full mt-1 z-50 rounded-xl overflow-hidden"
          style={{
            width: 340,
            background: "rgba(31,24,50,0.92)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <div
              className="neon flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(39,31,58,0.4)" }}
            >
              <Search size={13} style={{ color: "#b6b6c2", flexShrink: 0 }} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search format…"
                className="flex-1 bg-transparent focus:outline-none text-sm"
                style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", color: "#ebebeb" }}
              />
              {search && (
                <button onClick={() => setSearch("")}>
                  <X size={12} style={{ color: "#b6b6c2" }} />
                </button>
              )}
            </div>
          </div>

          {/* Category tabs (hidden when searching) */}
          {!search && (
            <div className="flex border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveTab(cat)}
                  className="flex-1 py-2.5 text-sm font-medium transition-colors"
                  style={{
                    fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif",
                    fontSize: 13,
                    fontWeight: effectiveTab === cat ? 600 : 400,
                    color: effectiveTab === cat ? "#ebebeb" : "#b6b6c2",
                    borderBottom: `2px solid ${effectiveTab === cat ? "var(--tool-accent)" : "transparent"}`,
                    marginBottom: -1,
                  }}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}

          {/* Format grid */}
          <div className="p-3 overflow-y-auto" style={{ maxHeight: 280 }}>
            {search && grouped ? (
              Object.entries(grouped).map(([cat, fmts]) => (
                <div key={cat} className="mb-3">
                  <p className="mb-2 px-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 11, fontWeight: 600, color: "#a0a0ae", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {CATEGORY_LABELS[cat as FormatCategory]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {fmts.map((f) => <FormatChip key={f.id} fmt={f} selected={value === f.id} onClick={() => { onChange(f); setOpen(false); setSearch(""); }} />)}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filtered.map((f) => (
                  <FormatChip key={f.id} fmt={f} selected={value === f.id} onClick={() => { onChange(f); setOpen(false); setSearch(""); }} />
                ))}
              </div>
            )}
            {filtered.length === 0 && (
              <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#a0a0ae", textAlign: "center", padding: "20px 0" }}>
                No formats found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FormatChip({ fmt, selected, onClick }: { fmt: Format; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-active={selected}
      className="neon-btn px-3 py-1.5 rounded-md transition-all"
      style={{
        fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif",
        fontSize: 12,
        fontWeight: 600,
        background: selected ? "color-mix(in srgb, var(--tool-accent) 70%, #000)" : "rgba(255,255,255,0.05)",
        color: selected ? "#fff" : "#c4c4c4",
        letterSpacing: "0.03em",
      }}
    >
      {fmt.label}
    </button>
  );
}
