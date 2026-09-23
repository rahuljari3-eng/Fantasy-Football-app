import { useEffect, useRef } from "react";
import { PAGE_NAV } from "../config/pages";
import type { TabId } from "../types";

export function NavTabs({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  // On a phone the tab row scrolls sideways; keep whichever tab is active
  // on screen (e.g. after jumping to a tab from a button elsewhere).
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <nav
      className="max-w-6xl mx-auto px-3 pb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_85%,transparent)] lg:[mask-image:none]"
    >
      {PAGE_NAV.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            ref={isActive ? activeRef : undefined}
            onClick={() => onChange(t.id)}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
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
