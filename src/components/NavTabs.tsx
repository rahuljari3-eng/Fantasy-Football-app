import { PAGE_NAV } from "../config/pages";
import type { TabId } from "../types";

export function NavTabs({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <nav className="max-w-6xl mx-auto px-3 pb-2 flex gap-1.5 overflow-x-auto">
      {PAGE_NAV.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              isActive
                ? "bg-[#C9A227]/15 text-[#C9A227] shadow-[inset_0_0_0_1px_rgba(201,162,39,0.4)]"
                : "text-[#98989D] hover:text-[#FFFFFF] hover:bg-white/5"
            }`}
          >
            <Icon size={15} /> {t.label}
          </button>
        );
      })}
    </nav>
  );
}
