import { AlertTriangle, TrendingUp, Repeat, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NewsType, PlayerStatus } from "../types";

export function statusColor(status: PlayerStatus): string {
  if (status === "Out" || status === "Doubtful") return "text-red-400";
  if (status === "Questionable") return "text-amber-400";
  return "text-emerald-400";
}

export function statusDot(status: PlayerStatus): string {
  if (status === "Out" || status === "Doubtful") return "bg-red-400";
  if (status === "Questionable") return "bg-amber-400";
  return "bg-emerald-400";
}

export function newsTypeColor(type: NewsType): string {
  switch (type) {
    case "Injury":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "Waiver":
      return "bg-teal-500/15 text-teal-300 border-teal-500/30";
    case "Trade":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
}

export function newsTypeIcon(type: NewsType): LucideIcon {
  switch (type) {
    case "Injury":
      return AlertTriangle;
    case "Waiver":
      return TrendingUp;
    case "Trade":
      return Repeat;
    default:
      return Newspaper;
  }
}
