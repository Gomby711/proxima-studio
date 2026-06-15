// Reusable toggle. The track glows orange when ON (styles in theme.css).
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center shrink-0 cursor-pointer">
      <input
        type="checkbox"
        className="px-switch-input sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="px-track">
        <span className="px-knob" />
      </span>
    </label>
  );
}
