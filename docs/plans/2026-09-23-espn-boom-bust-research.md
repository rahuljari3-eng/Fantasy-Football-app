---
date: 2026-09-23
topic: espn-boom-bust-research
status: researched-unavailable
---

# ESPN boom/bust research (Phase 5)

## Question

Can Roster Sensei quote ESPN Fantasy “boom / bust” percentages (or floor/ceiling %)?

## Method

Live probes against this league’s season endpoints (2026):

- `mRoster` / `mTeam` / `mStatus`
- `kona_player_info` (filtered player list)
- `kona_playercard` for top projected players (e.g. Jaxon Smith-Njigba)

Also checked community docs (`espn-api`, kona_playercard writeups, fflr).

## Result

**No boom/bust (or fantasy floor/ceiling %) fields** appear in returned JSON.

- Case-insensitive search for `boom` / `bust` / `floor` / `ceiling` / `stdDev` / `percentile` on playercard payloads: **all false**
- Interesting adjacent fields found: `outlooks` / `seasonOutlook` (text), `ownership.percentStarted`, occasional empty `variance: {}` on older proj lines — **not** boom/bust rates
- Documented playercard stats are `statSourceId` 0/1 applied totals, not distribution percentages

Conclusion: ESPN’s public fantasy read APIs used by this app **do not expose** boom/bust %. Those UI chips (if present in the ESPN app) are not available to us via these endpoints.

## Product decision

**Do not implement** boom/bust fields, tools, or proxy “boom/bust profile” substitutes. Prompt/tool notes may only say: never invent ESPN boom/bust %.

## Update (2026-09-28)

Superseded at the user's request by the app's **own** boom/bust rates, built from real game results rather than any ESPN field: `src/lib/boomBust.ts` (formula and calibration in its header), last season's games from Sleeper via `scripts/buildBoomBustHistory.ts`, this season's from `projectionHistory.json`. Shown in the player popup and as list badges; Sensei gets them as `boomBust` on player objects and must label them as the app's, never ESPN's.

Revised the same day to **weekly chances**: each player has fixed boom/bust bars from his season baseline, and this week's projection plus his past spread around projections give the chance of clearing each bar this week (see `src/lib/boomBust.ts`).
