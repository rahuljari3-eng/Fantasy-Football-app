import { Search, X } from "lucide-react";

/** A search box with a leading icon and a clear (x) button once there's text
 * to clear -- used everywhere a page filters a player list by name. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search players…",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#636366] pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#1C1C1E] border border-[#38383A] rounded-lg pl-7 pr-7 py-1.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/20 placeholder:text-[#636366]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#636366] hover:text-[#FFFFFF] p-0.5 rounded hover:bg-white/10"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
