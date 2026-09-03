import { Shield, Repeat, Newspaper, Users, UserPlus, Sparkles, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TabId } from "../types";

export interface PageNavEntry {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

// The tab bar, in display order. Add, remove, or reorder a page by editing
// this list -- App.tsx just maps over it and switches on `id`.
export const PAGE_NAV: PageNavEntry[] = [
  { id: "roster", label: "Build roster", icon: Users },
  { id: "freeagents", label: "Free agents", icon: UserPlus },
  { id: "lineup", label: "Lineup", icon: Shield },
  { id: "trade", label: "Trade analyzer", icon: Repeat },
  { id: "coach", label: "AI Coach", icon: Sparkles },
  { id: "league", label: "League", icon: Trophy },
  { id: "news", label: "News & injuries", icon: Newspaper },
];

export const DEFAULT_TAB: TabId = "roster";
