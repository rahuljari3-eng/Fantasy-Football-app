/** Evidence-first answering helpers for Roster Sensei. */

export const EVIDENCE_ANSWER_RULES = [
  "EVIDENCE CONTRACT (non-negotiable):",
  "Every suggestion, prediction, ranking, or conclusion MUST include the data and reasoning that produced it.",
  "Never assert a player is better/worse, a trade is fair/unfair, or a lineup is optimal without quoting numbers or facts from tool results.",
  "Do not invent projections, VOR, ratios, opponents, byes, standings, injury status, or news. If a tool didn't return it, say the data is missing.",
  "Prefer tool fields over world knowledge. When tools disagree with your prior, trust the tools.",
  "When tool payloads include citeHints, use them (paraphrase OK) in the Data & Reasoning section.",
  "",
  "Required final-answer shape (Markdown) unless you are ONLY asking one clarifying question:",
  "**Recommendation**",
  "- One clear action or conclusion (who to start, trade verdict, pickup, etc.). State the horizon (this week / ROS / both).",
  "",
  "**Data & Reasoning**",
  "- Bullets that cite concrete tool numbers/facts (proj, weekValue, rosValue, VOR, ratio, bye, opponent, grade, headlines, standings).",
  "- Tie each claim to evidence (e.g. \"A weekValue 42.1 vs B 35.4 from compare_players\").",
  "- Call out uncertainty or missing data explicitly.",
  "",
  "Optional short **Risks / Watch** only if relevant (injury tags, thin sample, bye next week).",
].join("\n");

/** True when the reply looks like an evidence-backed Sensei answer (or a clarifying Q). */
export function looksLikeEvidenceAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Clarifying questions are allowed without the full template.
  if (t.includes("?") && t.length < 450 && (t.match(/\?/g) ?? []).length <= 3) {
    const looksLikeOnlyQuestion =
      !/\b(start|sit|trade|pickup|recommend|should|fair|unfair|optimal)\b/i.test(t) ||
      t.split(/\n/).length <= 4;
    if (looksLikeOnlyQuestion && !/\*\*recommendation\*\*/i.test(t)) return true;
  }

  const hasRec =
    /\*\*recommendation\*\*/i.test(t) ||
    /(?:^|\n)\s*#{1,3}\s*recommendation\b/im.test(t) ||
    /(?:^|\n)\s*recommendation\s*:/im.test(t);

  const hasEvidence =
    /\*\*(data\s*(&|and)\s*reasoning|evidence|reasoning|why)\*\*/i.test(t) ||
    /(?:^|\n)\s*#{1,3}\s*(data|evidence|reasoning|why)\b/im.test(t) ||
    /(?:^|\n)\s*(data\s*(&|and)\s*reasoning|evidence|reasoning)\s*:/im.test(t);

  const numberCount = (t.match(/\d+(\.\d+)?/g) || []).length;
  const hasMetricCue =
    /\b(proj|projection|vor|week\s*value|ros|ratio|bye|qscore|quality|implied|grade|headline|record|standings|vs\.?|@ )\b/i.test(
      t
    ) || numberCount >= 2;

  return hasRec && hasEvidence && hasMetricCue;
}

export function evidenceNudgeMessage(toolsUsed: string[]): string {
  const tools = toolsUsed.length ? toolsUsed.join(", ") : "(none yet — call tools first)";
  return [
    "SYSTEM EVIDENCE NUDGE: Your last draft is not acceptable.",
    "Rewrite the FINAL answer using the required Markdown sections **Recommendation** and **Data & Reasoning**.",
    "Every conclusion must quote concrete numbers/facts from tool results already returned this turn.",
    `Tools used so far: ${tools}.`,
    "Do not call more tools unless a required research checklist item is still missing.",
    "Do not invent stats. If evidence is thin, say what is missing under Data & Reasoning.",
  ].join("\n");
}
