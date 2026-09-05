# Gridiron HQ

A fantasy football decision dashboard for your ESPN league — lineup building, free-agent scouting, trade analysis, and a heuristic AI Coach. Built with Vite + React + TypeScript.

Default setup: **Ten Idiots League** (ESPN `#973201555`, 2026), managing **Tush Pushers**. Read-mostly companion — it does **not** submit lineups, waivers, or trades back to ESPN.

## Running it

Requires **Node.js 18+** and an OpenAI key in a local `.env` (see `.env.example`).

```bash
cp .env.example .env   # then set OPENAI_API_KEY
npm install
npm run dev            # Vite (:5173) + Roster Sensei API (:8787)
```

`npm run dev` starts both:

- **Web** — `http://localhost:5173` (proxies `/api` → the API)
- **API** — `http://localhost:8787` (OpenAI tool loop; key stays server-side)

On **Vercel**, the same `/api/chat` route is a serverless function (`api/[[...route]].ts`) — no second process. Set `OPENAI_API_KEY` in the Vercel project env (see `docs/vercel-redeploy-sensei.md`).

Useful scripts:

```bash
npm run dev:web   # Vite only
npm run dev:api   # API only
npm run build     # type-check + production bundle → dist/
npm run preview   # serve the production build
```

## Features

| Tab | What it does |
|-----|----------------|
| **Build roster** | Fill starting slots from your team (and FAs); drag-and-drop; lineup edits persist in localStorage |
| **Free agents** | Need-aware pickup recommendations + browse/search the FA pool |
| **Lineup** | Starters + projected total; optional auto-optimize sandbox |
| **Trade analyzer** | Build give/get packages; week vs rest-of-season fairness (VOR / rank-based) |
| **AI Coach** | Position outlook vs league average + suggested trades (heuristic math, not an LLM) |
| **League** | Scout all 12 teams; jump into the trade analyzer |
| **Chat with Roster Sensei** | Agentic fantasy Q&A (OpenAI + tools); uses the header's selected team by default |

Use the header **team picker** to manage or scout any squad in the league.

## Refresh from ESPN

The **Refresh from ESPN** button updates, live from ESPN’s public APIs:

- Weekly projections and injury/status for rostered players and known free agents
- Current lineup slot assignments (starter / bench / IR)
- News and injury headlines

It does **not** yet rebuild *who owns whom*. Roster membership and the FA pool still come from the bundled snapshot under `src/data/`. After mid-season adds, drops, or trades, re-export/update that data (or the lists will drift until live membership sync lands).

Refresh calls ESPN from the browser. ESPN’s CORS headers currently allow this for the configured league; if that changes, the button surfaces an error instead of failing silently.

## Project layout

```
src/
  data/       Bundled ESPN snapshot: your team, league rosters, free agents
  config/     Tunable knobs:
                league.ts   — league identity, ESPN URL, slots/positions, colors
                scoring.ts  — player-valuation constants
                trade.ts    — trade fairness + AI Coach suggestion counts
                pages.ts    — tab bar (add / remove / reorder pages here)
  lib/        Pure functions: scoring, roster needs, trade engine, ESPN + news clients
  hooks/      State: useFantasyApp, useProjectionRefresh, useNewsFeed, useDragAndDrop
  components/ Shared UI (header, nav, badges, news modal, …)
  pages/      One file per tab — mostly markup; state comes from the `app` prop
  App.tsx     Header + active page
```

## Configuring it for your own league

1. Point `src/config/league.ts` at your ESPN league/season and rename your team.
2. Swap rosters and free agents under `src/data/`.
3. Tune valuation / trade aggressiveness in `src/config/scoring.ts` and `src/config/trade.ts`.
4. Add, remove, or reorder tabs in `src/config/pages.ts`.

## Notes

- The AI Coach tab is a **heuristic** engine (VOR, scarcity, injury discounts, need matching) — not an LLM. Roster Sensei is the LLM agent.
- Local roster edits are stored per team in localStorage; if ESPN’s lineup snapshot changes on refresh, ESPN wins for slot sync.
- The "Refresh from ESPN" button calls ESPN from the browser; Roster Sensei keeps **`OPENAI_API_KEY` on the server only**. See `docs/roster-sensei-agent-tools.md`.
- Ownership tiers in the snapshot are derived from ESPN ownership % at export time and are not refreshed live.
- Sensei tools today: league/roster/byes, player lookup, needs, compare, trade grading (week+ROS), FA search/recommendations, news. Schedule opponents and live ownership sync come next.
