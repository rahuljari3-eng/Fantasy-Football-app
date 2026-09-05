# Roster Sensei — Agent Tools & Design

Design notes for the Chat with Roster Sensei agentic workflow: an OpenAI tool-calling loop that answers any fantasy football question by choosing tools, inspecting results, and composing a final answer when ready.

**Scope of this doc:** tools catalog + architecture pattern. Implementation comes later.

**Related code today**

- Chat UI shell: `src/pages/ChatPage.tsx`
- Pure math / ESPN clients: `src/lib/{scoring,rosterNeeds,tradeEngine,espn,news,teamRoster}.ts`
- League identity: `src/config/league.ts`
- Bundled snapshot: `src/data/*`
- Env template: `.env.example` → `OPENAI_API_KEY`

---

## Product intent

The bot should handle questions like:

- Start / sit and flex choices
- Waiver / free-agent adds
- Trade fairness and “what should I ask for?”
- Roster construction / positional needs
- Injury and news context
- Matchups, standings, “can I make the playoffs?”
- League scouting (“what’s on their bench?”)
- **Schedule literacy:** bye weeks, who a player faces next, soft/hard upcoming stretches, playoff-week slate

It is a **read-mostly companion**. It should reuse this app’s valuation and needs math so Sensei’s answers stay consistent with the Trade Analyzer, Free Agents, and AI Coach tabs. It should **not** submit lineups, claims, or trades to ESPN unless we explicitly add write tools later.

### Short-term *and* long-term by default

Sensei must be able to zoom between horizons without the user spelling out “think ROS”:

| Horizon | Typical questions | What the agent should pull |
|---------|-------------------|----------------------------|
| **This week** | Start/sit, stream DST/K, injury risk | Weekly proj, status, news, fantasy matchup, opponent this week |
| **Near term (2–4 weeks)** | Bye coverage, stash vs drop, streamers | Bye calendar, next N opponents, overlapping byes on the roster |
| **Rest of season** | Trades, keep/cut, “is this RB a need?” | `rosValue` / season horizon, schedule outlook, standings pressure |
| **Playoffs** | “Who helps weeks 15–17?” | Remaining slate difficulty, playoff-week opponents, bye already used |

**Design rule:** for any advice that outlives a single lineup set (waivers, trades, “should I hold X?”), the agent should *consider* calling schedule/bye tools — not only weekly projection — and say which horizon it’s optimizing for.

---

## Hard constraints

1. **`OPENAI_API_KEY` never ships to the browser.** Vite client bundles are public. The key stays server-side (Node process / serverless), loaded from `.env` (gitignored).
2. **Prefer wrapping existing `src/lib` pure functions** before inventing new scoring.
3. **ESPN ownership can be stale.** Projections / status / lineup slots refresh live; *who owns whom* still comes from `src/data/` until we add membership sync. The agent should say so when relevant.
4. **Cap the tool loop** (rounds + ESPN calls) so one chat turn can’t hammer APIs.

---

## Recommended architecture

```
Browser (ChatPage)
  │  POST /api/chat  { messages, leagueContext }
  │  (optional: SSE stream of tokens / tool traces)
  ▼
Node API (Hono or Express beside Vite; proxy /api → :8787)
  │  OPENAI_API_KEY, optional ESPN_S2 / SWID for private leagues
  │
  ├─ System prompt (Roster Sensei persona + tool rules)
  ├─ OpenAI Chat Completions / Responses API with tools
  │     loop: model → tool_calls → execute → append tool results → model …
  │     stop when model returns final text (or max rounds)
  └─ Tool registry
        ├─ Local tools  → src/lib + extracted helpers + src/data
        └─ Live tools   → ESPN fantasy + site APIs (server-side fetch)
```

### Why a small server (not client-side OpenAI)

| Approach | Verdict |
|----------|---------|
| Call OpenAI from the browser | **No** — exposes the API key |
| Vite-only + `VITE_OPENAI_API_KEY` | **No** — still public |
| Tiny local API + Vite proxy | **Yes** for this repo |
| Serverless function later | Fine once the tool registry is stable |

### League context (sent each turn from the client)

```ts
{
  managedTeamId: number;           // header team picker (default Sensei context)
  scoringPeriodId?: number;        // last known ESPN week
  tradeHorizon?: "week" | "season"; // UI hint only; trade asks still answer BOTH
  localLineup?: {                  // optional: builder edits in localStorage
    roster: Record<string, number | undefined>;
    bench: number[];
  };
}
```

Server merges this with `LEAGUE_CONFIG`, the data snapshot, and a short-TTL cache of the last ESPN projection overrides. If the user names another team in chat, the agent may override `managedTeamId` for that turn via tools / prompt reasoning and should state which team it’s using. If local vs ESPN lineup is ambiguous, the agent **asks** before assuming.

### Agentic workflow (clean loop)

1. **Ingest** user message + `leagueContext`.
2. **System rules (persona):**
   - Use tools for facts; don’t invent ownership, projections, byes, or opponents.
   - Always know the **current scoring period** (`get_league_context`) before giving weekly advice.
   - When comparing players or advising holds/adds/trades, factor **bye weeks** and **upcoming NFL opponents** when tools can provide them — don’t answer “start A over B” without checking if A is on bye or facing a brutal matchup if that data is available.
   - State the **horizon** in the answer (“this week only” vs “next 3 weeks” vs “ROS / playoffs”).
   - Cite uncertainty; if schedule data is missing, say so instead of guessing.
3. **Tool-calling loop** (max ~6–8 rounds):
   - Model picks zero or more tools.
   - Server validates args, runs tool, returns JSON (trimmed).
   - Model assesses results; may call more tools (e.g. compare → then schedule for both players → then finalize).
4. **Final answer** when the model stops calling tools — concise, actionable, fantasy-manager tone; weave schedule context into the recommendation, not as an afterthought dump. For trade fairness without a stated horizon, return **both week and ROS** grades.
5. **UI:** deliver one final assistant message plus a collapsed `N tools used` accordion (names of tools that ran).
6. **Optional (v1.5):** intent router that restricts the tool allowlist (e.g. start/sit → lineup + schedule tools) for speed/cost. Not required for first ship.

### Implementation sketch (later)

```
server/
  index.ts              # Hono app, /api/chat
  agent/
    runSenseiTurn.ts    # OpenAI loop
    systemPrompt.ts
    tools/
      registry.ts       # name → { schema, handler }
      local/*.ts        # wrap src/lib
      espn/*.ts         # new views
vite.config.ts          # proxy /api → localhost:8787
```

Share pure modules by importing from `../src/lib/...` on the server, or move shared math to a `shared/` folder if import paths get awkward. **Do not** import React hooks (`useFantasyApp`) into Node — extract pure helpers first.

### Safety

- Rate-limit `/api/chat` (per IP / session).
- Cap tool calls and ESPN fetches per turn.
- Cache ESPN GETs for 30–120s.
- Never return secrets (API key, cookies) to the client.
- No ESPN write APIs in v1.
- Optional debug: return a collapsed “tools used” trace in the UI for trust.

---

## What we can wrap today (existing code)

| Area | Module | Key exports |
|------|--------|-------------|
| Player value | `src/lib/scoring.ts` | `playerValue`, `rosValue`, `qualityScore`, `vorPoints`, … |
| Needs | `src/lib/rosterNeeds.ts` | `analyzeRosterNeeds` |
| Trades | `src/lib/tradeEngine.ts` | `packageValue`, `needAdjustedPackageValue`, `fairnessRatio`, `starGateOk`, `balancePackage`, … |
| ESPN fantasy | `src/lib/espn.ts` | `fetchEspnRosteredProjections`, `fetchEspnLineups`, `fetchEspnFreeAgentProjections` |
| News | `src/lib/news.ts` | `fetchLeagueNewsFeed` |
| Lineup map | `src/lib/teamRoster.ts` | `deriveAssignments`, `deriveAssignmentsFromEspnSlots` |
| Config | `src/config/league.ts`, `scoring.ts`, `trade.ts` | slots, replacement levels, fairness knobs |
| Snapshot | `src/data/*` | teams, FAs, default managed team |
| Bye week (static) | Each `Player.bye` on roster / FA records | Already on the snapshot — enough for “who is on bye week N?” without a new ESPN call |

**Not in the app yet (needed for real schedule IQ):** NFL opponent-by-week / home-away for each `proTeam` (ESPN `proTeamSchedules_wl` or equivalent). Bye alone is not enough for “who do they play the next three weeks?”

**Extract from `useFantasyApp` (don’t call the hook on the server):**

- League baseline + needy / strength positions
- `recommendedPickups` / `bestAvailableOverall`
- Coach trade suggestion pipeline
- `autoOptimize` lineup greedy fill
- Side package `tradeValue` (week/season + extra-piece discount)

---

## ESPN surface area

### Already used

Base: `ESPN_LEAGUE_BASE_URL` in `src/config/league.ts`  
(`…/ffl/seasons/{season}/segments/0/leagues/{leagueId}`)

| Call | Views / path | Used for |
|------|----------------|----------|
| Rostered projections | `mRoster`, `mTeam`, `mStatus` | Weekly proj + injury status |
| Lineups | `mRoster`, `mTeam` | Slot labels per team |
| Free agents | `/players?view=kona_player_info` + `x-fantasy-filter` | FA proj overlays |
| News | `site.api.espn.com/.../news` | Headlines |
| Injuries | `site.api.espn.com/.../injuries` | Injury blurbs |

Public/cookie-less GETs work for this league today from the browser; **agent tools should still fetch server-side**.

### Worth adding as tools (not in code yet)

| Capability | Typical ESPN view | Auth |
|------------|-------------------|------|
| Standings / records / PF | `mStandings`, `mTeam` | Cookies if private |
| Matchups / scoreboard | `mMatchup`, `mMatchupScore`, `mScoreboard` | Same |
| Live / box scores | `mBoxscore`, `mLiveScoring` | Same |
| League settings | `mSettings` | Same |
| Full ownership sync | parse all `mRoster` + FA | Same |
| Transactions | `mTransactions2` | Often cookies |
| Draft recap | `mDraftDetail` | Same |
| NFL schedule (opponents, H/A) | `proTeamSchedules_wl` (or site scoreboard by week) | Usually public — **priority for Sensei’s long-term IQ** |
| Message board | communication / messageboard | Cookies |

**Out of scope for v1:** write endpoints (set lineup, claim waiver, propose ESPN trade).

---

## Question categories → tools

| User ask | Primary tools |
|----------|----------------|
| Start / sit, flex | `compare_players`, `optimize_lineup`, `get_player_schedule`, `get_news_for_player` |
| “Is X on bye?” / bye coverage | `get_bye_calendar`, `get_my_roster`, `search_free_agents` |
| Waivers / must-adds | `analyze_roster_needs`, `recommend_pickups`, `get_schedule_outlook`, `search_free_agents` |
| Is this trade fair? (week *and* ROS) | `evaluate_trade` (both horizons), `get_schedule_outlook`, `get_player` |
| Suggest a trade | `suggest_trades`, `analyze_roster_needs`, `get_bye_calendar` |
| Where am I weak? | `analyze_roster_needs`, `get_my_roster`, `get_bye_calendar` |
| Injury / news | `get_news_feed`, `get_news_for_player`, `get_player` |
| Fantasy matchup / standings | `get_matchup`, `get_standings` |
| “Who do they play the next few weeks?” | `get_player_schedule`, `get_nfl_schedule` |
| Playoff stash / schedule smash | `get_schedule_outlook`, `get_playoff_weeks`, `get_standings` |
| What moved in the league? | `get_transactions`, `sync_rosters` |
| Scout an opponent | `list_teams`, `get_team_roster` |
| League rules / format | `get_league_context` |

---

## Tool catalog

Priorities: **P0** = ship with first agent loop · **P1** = next · **P2** = later.

### P0 — wrap what we already have

| Tool | Purpose | Inputs (sketch) | Outputs (sketch) | Source |
|------|---------|-----------------|------------------|--------|
| `get_league_context` | Name, scoring label, slots, managed team, week | — | Config + `scoringPeriodId` | `LEAGUE_CONFIG` + ESPN period |
| `list_teams` | All managers | — | `{ id, name, owner }[]` | `ALL_TEAMS` |
| `get_my_roster` | Managed team + slots | `teamId?` | Players, starter/bench, proj, status, **bye** | Data + lineup helpers + overrides |
| `get_team_roster` | Scout any team | `teamId` | Same shape | `LEAGUE_TEAMS` / live roster later |
| `get_player` | Resolve name or ESPN id | `query` or `playerId` | Player + owner + **bye** + values | Search pools |
| `get_bye_calendar` | Who’s on bye when | `teamId?`, `week?` | Players grouped by bye; flags for *this* week | `Player.bye` on roster/FA + current period |
| `analyze_roster_needs` | Holes vs league baseline | `teamId?` | Per-pos starter scores, needs, depth | `analyzeRosterNeeds` + baseline extract |
| `compare_players` | Start/sit style compare | `playerIds[]`, `horizon?` | Side-by-side proj / VOR / ROS / status / **bye** | `scoring.ts` + bye field |
| `optimize_lineup` | Best weekly lineup | `teamId?`, `pool?: "roster" \| "roster_plus_fa"` | Slot map + total; **exclude bye & Out** | Extract `autoOptimize` |
| `recommend_pickups` | Need-aware FA shortlist | `teamId?`, `limit?` | Position groups + reasons (+ bye notes) | FA recommend extract |
| `search_free_agents` | Browse FA pool | `pos?`, `q?`, `limit?` | Sorted FA list | `FREE_AGENTS` + overlays |
| `evaluate_trade` | Grade a package | `giveIds[]`, `getIds[]`, `opponentId?`, `horizon?` | Side values, ratio, star gate, notes | `tradeEngine` + scoring |
| `get_news_feed` | League-filtered news | `limit?`, `type?` | `NewsItem[]` | `news.ts` |

### P1 — schedule IQ + coach + live ESPN depth

Promote schedule tools early — this is what makes Sensei versatile beyond a projection parrot.

| Tool | Purpose | Inputs | Outputs | Source |
|------|---------|--------|---------|--------|
| `get_nfl_schedule` | Full NFL week or team slate | `week?`, `nflTeam?` | Games: home/away, opponent, date | **New** ESPN `proTeamSchedules_wl` (or site API) |
| `get_player_schedule` | One player’s remaining games | `playerId` or `query`, `fromWeek?` | Bye + **all remaining** opponents (H/A) through season end | Player.team + NFL schedule cache |
| `get_schedule_outlook` | Soft/hard stretch summary | `playerIds[]` or `teamId`, `fromWeek?`, `throughWeek?` | Per-player **remaining** opponents (default through season / playoffs); optional “ease” tags later | Schedule + optional rankings |
| `get_playoff_weeks` | League playoff window | — | Scoring periods treated as playoffs (settings or config e.g. 15–17) | **New** `mSettings` or `LEAGUE_CONFIG` |
| `suggest_trades` | Coach-style proposals | `teamId?`, `max?` | `TradeSuggestion[]` | Coach pipeline extract |
| `refresh_projections` | Pull live proj/status | — | Period, counts | `espn.ts` |
| `get_news_for_player` | One player’s headlines | `playerId` | `NewsItem[]` | Filter feed |
| `get_standings` | W-L, PF, rank | — | Standings rows | **New** ESPN `mStandings` / `mTeam` |
| `get_matchup` | Fantasy week matchups / scores | `week?`, `teamId?` | Matchup pairs | **New** ESPN `mMatchup*` |
| `sync_rosters` | Live who-owns-whom + FA set | — | Updated teams / FA ids | **New** full roster parse |

### P2 — league narrative & richer research

| Tool | Purpose | Inputs | Outputs | Source |
|------|---------|--------|---------|--------|
| `get_transactions` | Recent adds/drops/trades | `week?`, `limit?` | Transaction list | **New** `mTransactions2` |
| `get_draft_recap` | Draft board / pick history | — | Picks | **New** `mDraftDetail` |
| `get_defense_ranks` | Optional matchup context | `week?` or ROS | Positional ranks vs NFL defenses | External or derived — only if we want finer “smash spot” language |

### Explicitly not in v1

| Tool | Why hold |
|------|----------|
| `set_lineup` / `submit_waiver` / `propose_espn_trade` | Write-back, auth, irreversible; product decision required |
| Message-board scrape | Noise + cookies; low ROI first |

---

## Tool design conventions

Keep the registry boring and consistent:

1. **JSON Schema** per tool (OpenAI function parameters) with required fields and enums (`horizon: "week" | "season"`).
2. **Handlers return plain JSON** — small, typed DTOs. Truncate long lists (`limit` default 5–10).
3. **Errors are data:** `{ ok: false, error: "player_not_found" }` so the model can recover instead of crashing the turn.
4. **Ids over names internally;** `get_player` is the fuzzy name resolver.
5. **One concern per tool** — don’t ship a mega-`answer_fantasy_question` tool; the model is the orchestrator.
6. **Shared valuation:** every tool that prices players uses `playerValue` / `rosValue` / package rules from `src/lib`, not a second ad-hoc formula.
7. **Schedule fields travel with players:** roster/FA/player payloads should always include `bye`, `nflTeam`, and (when schedule cache is warm) `nextOpponents[]` so the model doesn’t need an extra call for trivial bye checks — but dedicated schedule tools still exist for multi-week / multi-player outlooks.
8. **Cache the NFL schedule** for the season (or at least remaining weeks) in memory/disk on the server; almost every long-term answer will hit it.

### Example: player schedule tool result

```json
{
  "ok": true,
  "playerId": 4426515,
  "name": "Puka Nacua",
  "nflTeam": "LAR",
  "bye": 11,
  "currentWeek": 4,
  "upcoming": [
    { "week": 4, "opponent": "SF", "home": false },
    { "week": 5, "opponent": "SEA", "home": true },
    { "week": 6, "opponent": "JAX", "home": false },
    { "week": 7, "bye": true }
  ]
}
```

Example trade tool result shape:

```json
{
  "ok": true,
  "horizon": "week",
  "giveValue": 112.4,
  "getValue": 118.1,
  "ratio": 1.05,
  "starGateOk": true,
  "verdict": "roughly_even",
  "notes": ["Receive side has a Questionable tag"]
}
```

---

## Suggested build order

### Done

1. ~~**Server skeleton**~~ — Hono API on `:8787`, Vite `/api` proxy, `POST /api/chat`, `OPENAI_API_KEY` server-only (`server/`).
2. ~~**ChatPage wiring**~~ — real OpenAI turn, loading state, collapsed **“N tools used”** accordion, `managedTeamId` from header.
3. ~~**Starter P0 tools (partial)**~~ — `get_league_context`, `list_teams`, `get_my_roster`, `get_bye_calendar` (enough to prove the loop).

### Still to do

4. **Remaining P0 tools** — needs analysis, compare players, evaluate_trade (**both horizons**), recommend_pickups, search FAs, news.
5. **Schedule IQ** — season schedule fetch + cache; `get_nfl_schedule` / `get_player_schedule` / `get_schedule_outlook` (**remaining weeks**).
6. **League ESPN** — standings, fantasy matchup, `sync_rosters`.
7. ~~**Production deploy path**~~ — Vercel serverless `api/[[...route]].ts` wraps the same Hono app (`server/app.ts`). Set `OPENAI_API_KEY` in Vercel env and redeploy (see `docs/vercel-redeploy-sensei.md`).
8. **Polish** — ask-when-unsure for lineup conflicts; chat persistence / multi-chat; richer traces; optional streaming later.

**Why only some tools so far:** intentional — ship the agent loop + a few high-value read tools first, confirm tool-calling + UI, then expand the registry without redesigning the architecture.


---

## Decisions (locked in)

1. **Team context** — Default to the **header’s selected team**. If the user **explicitly** names another league team in the prompt, Sensei may switch context for that turn (and should say which team it’s advising for).
2. **Lineup ground truth** — If local builder lineup and ESPN disagree (or it’s ambiguous), **ask the user** which to use rather than silently picking.
3. **Response UX** — **Wait for the final answer** (no token streaming in v1). Show a collapsed **“N tools used”** accordion (default **collapsed**); expand to list tool names (and light args/results later if useful).
4. **Trade horizon** — For fairness / trade asks without a stated horizon, Sensei answers **both week and rest-of-season**.
5. **Schedule depth** — Prefer **full remaining NFL schedule** (not just next 3–4 weeks) in schedule tools / cache, so ROS and playoff talk is grounded.
6. **Tool traces** — Yes, expandable; default unexpanded summary like `7 tools used`.
7. **First ship scope** — Incremental: **server + ChatPage wiring + core P0 tools (including bye calendar)**, then immediately **NFL schedule cache + remaining-weeks schedule tools**, then standings/matchup/ownership. Don’t block the first PR on every P1 ESPN view.
8. **Model** — Default **`gpt-4o-mini`** (env-overridable via `OPENAI_MODEL`). Good enough for tool calling + fantasy Q&A at low cost/latency; bump to a larger model later if reasoning quality dips.
9. **Conversations** — **v1 = single active thread** with full chat history sent each turn (capped). Multi-chat sidebar can come later without changing the API shape much.

---

## Model choice

**Recommendation for v1: `gpt-4o-mini`.**

| Criterion | Why mini works |
|-----------|----------------|
| Tool calling | Solid at picking/sequencing tools |
| Latency / cost | Tool loops are multi-round; mini stays cheap |
| Fantasy answers | Most quality comes from **tool results** (VOR, byes, schedules), not freeform NFL knowledge |
| Ops | Set `OPENAI_MODEL` in `.env` so swapping models is one line |

**When to upgrade** (e.g. `gpt-4o` or whatever current “standard” chat model is):

- Sensei mis-orders tools or ignores schedule data often
- Multi-step “compare three packages + ROS + playoffs” answers feel shallow
- You want stronger refusal/uncertainty behavior

Don’t put the model name only in client code — server reads `process.env.OPENAI_MODEL ?? "gpt-4o-mini"`.

---

## Chat context & multi-chat

### How context works (even for one chat)

Each `POST /api/chat` should send:

```ts
{
  messages: Array<{ role: "user" | "assistant"; content: string }>; // prior turns + new user msg
  leagueContext: { managedTeamId: number; scoringPeriodId?: number; localLineup?: ... };
}
```

Server builds the OpenAI payload as:

1. **System** — Sensei persona + tool rules (not stored in the UI thread)
2. **`messages`** — the conversation so far (user/assistant only; tool calls stay server-side within that turn’s loop)
3. **Tools** — registry schemas

So “remember what I asked earlier” = **include prior user/assistant messages**. Tool traces from past turns don’t need to be replayed unless we want that later.

**History cap (important):** don’t grow forever.

- Keep the **last N turns** (e.g. last 12–20 messages), or a rough token budget
- Optionally later: summarize older turns into one system/context blob (“User previously asked about Waivers for RB; prefers ROS trades”)

**Client persistence (v1):** store the single thread in `localStorage` (same pattern as roster edits) so refresh doesn’t wipe the chat. “New chat” button clears it.

### Multiple chats (later, not blocking)

Shape the data so multi-chat is easy later:

```ts
type ChatThread = {
  id: string;
  title: string;          // first user message, truncated — or "New chat"
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    toolsUsed?: string[]; // for the accordion on assistant msgs
  }>;
};
```

- **v1:** one thread (`activeChatId` fixed or a single key in storage)
- **v2:** sidebar list of threads; same `/api/chat` with that thread’s `messages`

No need for a database until you want sync across devices — localStorage (or IndexedDB) is enough for a personal league app.

### Within a single turn

The tool-calling loop is separate from chat history:

```
[system] + [history messages] + [new user message]
  → model may call tools (results appended only for this turn)
  → final assistant text
  → client appends assistant message (+ toolsUsed[]) to the thread
```

Next user question gets history **without** replaying old tool JSON (keeps tokens down; facts can be re-fetched via tools if needed).

---

## Open questions (still soft)

1. Exact playoff week window if `mSettings` is unavailable — default config to 15–17?
2. Private-league cookies (`ESPN_S2` / `SWID`) — add to `.env.example` only when needed.
3. How verbose should expanded tool traces be (names only vs names + short result summary)?

---

## Summary

Roster Sensei should be a **server-side OpenAI tool agent** that:

- Orchestrates a short tool loop over **existing Gridiron HQ math** (`scoring`, `rosterNeeds`, `tradeEngine`) and **ESPN read APIs**
- Starts with **P0 local tools** for start/sit, waivers, trades, news — including **bye awareness** from data we already store
- Treats **schedule literacy as core**, not a nice-to-have: upcoming opponents, bye coverage, ROS vs playoff horizons
- Adds **NFL schedule cache + standings / fantasy matchups / ownership sync** as P1 so answers stay season-accurate and long-term smart
- Keeps **`OPENAI_API_KEY` off the client** and **write-back off the table** until explicitly designed

That keeps the workflow clean: the model chooses tools; tools return facts (including *when* and *against whom*); the model writes a final answer that can think this week **and** the rest of the year.
