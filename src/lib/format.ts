import { AlertTriangle, TrendingUp, Repeat, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InjurySeverity, MatchupGrade, NewsType, PlayerStatus } from "../types";

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

export function severityLabel(severity: InjurySeverity): string {
  switch (severity) {
    case "severe":
      return "Severe — likely multi-week";
    case "moderate":
      return "Moderate — game-time decision";
    case "minor":
      return "Minor — probably fine";
  }
}

export function severityColor(severity: InjurySeverity): string {
  switch (severity) {
    case "severe":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "moderate":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "minor":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
}

export function matchupGradeColor(grade: MatchupGrade | null): string {
  switch (grade) {
    case "A":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "B":
      return "bg-teal-500/15 text-teal-300 border-teal-500/30";
    case "C":
      return "bg-[#38383A]/40 text-[#98989D] border-[#38383A]";
    case "D":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "F":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    default:
      return "bg-[#38383A]/40 text-[#636366] border-[#38383A]";
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

/** "just now" / "12 min ago" / "3h ago" / "2d ago" relative to `now` (ms). */
export function timeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
