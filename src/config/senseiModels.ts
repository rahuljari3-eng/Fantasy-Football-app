/** Allowlisted OpenAI chat models for Roster Sensei (client + server). */
export const SENSEI_MODELS = [
  {
    id: "gpt-4o-mini",
    label: "Mini",
    description: "Faster / cheaper — default",
  },
  {
    id: "gpt-4o",
    label: "4o",
    description: "Stronger tool picking & reasoning",
  },
] as const;

export type SenseiModelId = (typeof SENSEI_MODELS)[number]["id"];

export const DEFAULT_SENSEI_MODEL: SenseiModelId = "gpt-4o-mini";

export function isSenseiModelId(value: unknown): value is SenseiModelId {
  return typeof value === "string" && SENSEI_MODELS.some((m) => m.id === value);
}

/** Resolve model from UI preference, then optional server env fallback. */
export function resolveSenseiModel(
  preferred?: string | null,
  envFallback?: string | null
): SenseiModelId {
  if (isSenseiModelId(preferred)) return preferred;
  if (isSenseiModelId(envFallback)) return envFallback;
  return DEFAULT_SENSEI_MODEL;
}
