// Thin situational snapshot for Sensei — situation only, not recommendations.
// Composes playoff outlook, bye pileups, needs, and temporal advice so the
// model can open answers with stakes/timing before calling action tools.
import { optimizeLineup } from "../../../src/lib/optimizeLineup.js";
import { computePlayoffOutlook } from "../../../src/lib/playoffOdds.js";
import { fetchLeagueScheduleSnapshot } from "../../../src/lib/leagueSchedule.js";
import { analyzeRosterNeeds } from "../../../src/lib/rosterNeeds.js";
import type { Position } from "../../../src/types.js";
import {
  activeTeams,
  leagueBaseline,
  needsSummary,
  resolveTeam,
  teamPlayersRanked,
} from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

/** Weeks until a future event before we tell the model not to over-commit capital. */
const TEMPORAL_TOO_EARLY_WEEKS = 6;
const TEMPORAL_PREPARE_WEEKS = 3;
const MAX_BYE_NAMES = 12;

export type TemporalAdvice = "act_now" | "prepare" | "too_early_to_overcommit" | "n_a";

export function temporalAdviceFor(weeksUntil: number | null): TemporalAdvice {
  if (weeksUntil == null || !Number.isFinite(weeksUntil)) return "n_a";
  if (weeksUntil <= TEMPORAL_PREPARE_WEEKS) return "act_now";
  if (weeksUntil < TEMPORAL_TOO_EARLY_WEEKS) return "prepare";
  return "too_early_to_overcommit";
}

/** Volatility proxy from fields we already stamp — never invent ESPN boom/%. */
export function volatilityProxy(p: {
  status?: string;
  tier?: 1 | 2 | 3;
  scheduleEase?: number;
}): { label: "higher_variance" | "steadier" | "unknown"; signals: string[] } {
  const signals: string[] = [];
  const status = p.status ?? "Healthy";
  if (status !== "Healthy" && status !== "Active") signals.push(`status_${status}`);
  if (p.tier === 3) signals.push("tier3_role_risk");
  if (p.tier === 1) signals.push("tier1_stable_role");
  if (typeof p.scheduleEase === "number") {
    if (p.scheduleEase >= 1.05) signals.push("soft_remaining_schedule");
    if (p.scheduleEase <= 0.95) signals.push("tough_remaining_schedule");
  }
  if (!signals.length) return { label: "unknown", signals: [] };
  if (signals.some((s) => s.startsWith("status_") || s === "tier3_role_risk" || s === "tough_remaining_schedule")) {
    return { label: "higher_variance", signals };
  }
  if (signals.includes("tier1_stable_role") || signals.includes("soft_remaining_schedule")) {
    return { label: "steadier", signals };
  }
  return { label: "unknown", signals };
}

export const getSituationalBriefingTool: ToolDefinition = {
  name: "get_situational_briefing",
  description:
    "Compact situation snapshot for advisory answers: current week, optional target week + weeksUntil + temporalAdvice, playoff race snippet for the managed team, bye pileup for a week, and needy/strength positions. Situation ONLY — still call suggest_trades / recommend_pickups / evaluate_trade for concrete actions. Use for any planning, urgency, bye-coverage, or stakes-aware question (not tied to one sample query).",
  parameters: {
    type: "object",
    properties: {
      targetWeek: {
        type: "number",
        description:
          "Optional future NFL/fantasy week to evaluate (e.g. a bye pileup week). Defaults to current week for 'this week' stakes.",
      },
      includePlayoff: {
        type: "boolean",
        description: "Include playoff-race snippet (default true).",
      },
      teamId: {
        type: "number",
        description: "Fantasy team to brief. Defaults to the managed team.",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const includePlayoff = args.includePlayoff !== false;
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const { team } = resolved;

    const currentWeek =
      typeof ctx.scoringPeriodId === "number" && ctx.scoringPeriodId > 0
        ? ctx.scoringPeriodId
        : null;

    let scheduleWeek = currentWeek;
    let snap: Awaited<ReturnType<typeof fetchLeagueScheduleSnapshot>> | null = null;
    try {
      snap = await fetchLeagueScheduleSnapshot();
      scheduleWeek = snap.currentWeek ?? currentWeek;
    } catch {
      snap = null;
    }

    const weekNow = scheduleWeek ?? currentWeek ?? 1;
    const targetWeek =
      typeof args.targetWeek === "number" && args.targetWeek > 0 ? Math.floor(args.targetWeek) : null;
    const weeksUntil = targetWeek != null ? targetWeek - weekNow : null;
    const temporalAdvice = temporalAdviceFor(weeksUntil);

    const ranked = teamPlayersRanked(team.id);
    const baseline = leagueBaseline();
    const needs = analyzeRosterNeeds(ranked);
    const { needy, strength } = needsSummary(needs, baseline);

    const byeWeek = targetWeek ?? weekNow;
    const onBye = ranked.filter((p) => p.bye === byeWeek);
    const byPos: Partial<Record<Position, string[]>> = {};
    for (const p of onBye) {
      const list = byPos[p.pos] ?? [];
      if (list.length < 6) list.push(p.name);
      byPos[p.pos] = list;
    }
    const byePileup = {
      week: byeWeek,
      count: onBye.length,
      byPos,
      names: onBye.slice(0, MAX_BYE_NAMES).map((p) => p.name),
      sampleVolatility: onBye.slice(0, 4).map((p) => ({
        name: p.name,
        ...volatilityProxy(p),
      })),
    };

    let playoff: Record<string, unknown> | null = null;
    if (includePlayoff && snap) {
      const projectedStrengthByTeam: Record<number, number> = {};
      for (const t of activeTeams()) {
        projectedStrengthByTeam[t.id] = optimizeLineup(teamPlayersRanked(t.id)).projectedTotal;
      }
      const outlooks = computePlayoffOutlook(
        snap.standings,
        snap.schedule,
        snap.playoffTeamCount,
        projectedStrengthByTeam
      );
      const mine = outlooks.find((o) => o.teamId === team.id);
      const myStrength = projectedStrengthByTeam[team.id] ?? null;
      const strengths = Object.values(projectedStrengthByTeam).filter((n) => n > 0).sort((a, b) => b - a);
      const strengthRank =
        myStrength != null && strengths.length
          ? strengths.filter((s) => s > myStrength).length + 1
          : null;
      if (mine) {
        playoff = {
          status: mine.status,
          makeOdds: mine.makeOdds,
          winsNeededToClinch: mine.winsNeededToClinch,
          gamesRemaining: mine.gamesRemaining,
          controlsOwnDestiny: mine.controlsOwnDestiny,
          summary: mine.summary,
          projectedStarterTotal: myStrength != null ? Math.round(myStrength * 10) / 10 : null,
          projectedStrengthRank: strengthRank,
          teamsInLeague: strengths.length,
        };
      }
    }

    const citeHints: string[] = [
      `Week now ${weekNow}${targetWeek != null ? `; target week ${targetWeek} (weeksUntil ${weeksUntil}, temporalAdvice ${temporalAdvice})` : ""}.`,
      `Bye pileup week ${byePileup.week}: ${byePileup.count} players (${byePileup.names.slice(0, 6).join(", ") || "none"}).`,
      `Needs: ${needy.join("/") || "none"}; strength: ${strength.join("/") || "none"}.`,
    ];
    if (playoff && typeof playoff.summary === "string") {
      citeHints.push(`Playoff: ${playoff.summary}`);
    }
    citeHints.push(
      "Situation only — call suggest_trades / recommend_pickups / evaluate_trade for concrete actions. Do not invent ESPN boom/bust %; use volatilityProxy signals only."
    );

    return {
      ok: true,
      teamId: team.id,
      teamName: team.name,
      currentWeek: weekNow,
      targetWeek,
      weeksUntil,
      temporalAdvice,
      temporalThresholds: {
        actNowMaxWeeksUntil: TEMPORAL_PREPARE_WEEKS,
        tooEarlyMinWeeksUntil: TEMPORAL_TOO_EARLY_WEEKS,
      },
      playoff,
      byePileup,
      needs: { needy, strength },
      citeHints,
      note: "Situation snapshot only. Follow with action tools for packages/pickups. temporalAdvice applies to any target week.",
    };
  },
};
