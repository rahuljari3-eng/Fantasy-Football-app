# Gridiron HQ

A fantasy football roster/trade/AI-coach dashboard for your ESPN league, built with Vite + React + TypeScript.

## Running it

```bash
npm install
npm run dev       # starts the dev server (usually http://localhost:5173)
npm run build     # type-checks and builds a production bundle to dist/
npm run preview   # serves the production build locally
```

## Project layout

```
src/
  data/       Your league's data: rosters, free agents, news feed.
  config/     Every tunable knob, grouped by concern:
                league.ts   — league identity, ESPN URL, slots/positions, colors
                scoring.ts  — player-valuation constants (tiers, injury discounts, ...)
                trade.ts    — trade-fairness band, AI Coach suggestion counts
                pages.ts    — the tab bar itself (add/remove/reorder a page here)
  lib/        Pure functions: scoring math, roster-needs analysis, trade
              fairness, ESPN API parsing, formatting helpers. No React, no state.
  hooks/      Stateful logic: useFantasyApp (the app's single source of truth),
              plus useProjectionRefresh and useDragAndDrop as focused sub-hooks.
  components/ Small reusable UI pieces shared across pages (badges, nav, header).
  pages/      One file per tab (RosterBuilderPage, TradeAnalyzerPage, ...). Each
              receives the full app state as a prop and stays focused on markup.
  App.tsx     Wires the header + active page together.
```

## Configuring it for your own league

Point the app at a different ESPN league/season, rename your team, or change
the scoring format label — all in `src/config/league.ts`. Swap in your own
roster and opponents' rosters in `src/data/`. Tune how aggressively the AI
Coach values tiers, injuries, or trade fairness in `src/config/scoring.ts` and
`src/config/trade.ts`. Add, remove, or reorder tabs in `src/config/pages.ts`.

## Notes

- The "Refresh from ESPN" button calls ESPN's public read API directly from
  the browser, which works because ESPN's CORS headers reflect the request's
  origin for this league. If ESPN ever changes that, the button will show an
  error rather than silently going stale.
- `src/data/news.ts` is a static snapshot — wire up a real feed (Sleeper,
  ESPN, etc.) there to make the News tab live.
