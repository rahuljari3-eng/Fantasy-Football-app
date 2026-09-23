import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Collapsed-by-default explanation, so a page leads with its content. */
export function HowItWorks({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mb-3 max-w-2xl">
      <summary className="list-none cursor-pointer text-xs text-[#636366] hover:text-[#98989D] inline-flex items-center gap-1 select-none">
        <ChevronDown size={12} className="transition-transform group-open:rotate-180" /> {summary}
      </summary>
      <div className="text-xs text-[#636366] mt-2 space-y-2">{children}</div>
    </details>
  );
}
