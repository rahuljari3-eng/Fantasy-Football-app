// Ready-to-send trade pitch for the AI Coach's "Copy offer" button -- pasted
// into ESPN's league chat or a text, so it leads with what's in it for THEM.
import type { Player, TradeSuggestion } from "../types";

const names = (players: Player[]) => players.map((p) => `${p.name} (${p.pos})`).join(" + ");

export function buildTradeOffer(s: TradeSuggestion): string {
  const { theirNeedsHelped, theirGain } = s.fit;
  const pitch = theirNeedsHelped.length
    ? `It fills your ${theirNeedsHelped.join("/")} spot`
    : theirGain > 0
      ? "It makes your starting lineup a bit better"
      : "It gives you a solid piece";
  return `Hey ${s.teamName} — trade idea: I send ${names(s.give)} for ${names(s.get)}. ${pitch}. Interested?`;
}
