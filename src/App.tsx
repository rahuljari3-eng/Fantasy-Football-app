import { AppHeader } from "./components/AppHeader";
import { DragGhost } from "./components/DragGhost";
import { useFantasyApp } from "./hooks/useFantasyApp";
import { RosterBuilderPage } from "./pages/RosterBuilderPage";
import { FreeAgentsPage } from "./pages/FreeAgentsPage";
import { LineupPage } from "./pages/LineupPage";
import { TradeAnalyzerPage } from "./pages/TradeAnalyzerPage";
import { CoachPage } from "./pages/CoachPage";
import { LeaguePage } from "./pages/LeaguePage";
import { NewsPage } from "./pages/NewsPage";

// Which component renders for each tab id (config/pages.ts controls the nav
// bar itself -- this just has to stay in sync with the TabId union).
const PAGES = {
  roster: RosterBuilderPage,
  freeagents: FreeAgentsPage,
  lineup: LineupPage,
  trade: TradeAnalyzerPage,
  coach: CoachPage,
  league: LeaguePage,
  news: NewsPage,
};

export default function App() {
  const app = useFantasyApp();
  const Page = PAGES[app.tab];

  return (
    <div className="min-h-screen bg-[#000000] text-[#FFFFFF]" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <AppHeader
        tab={app.tab}
        onTabChange={app.setTab}
        rosterTotal={app.rosterTotal}
        refreshing={app.refreshing}
        refreshProgress={app.refreshProgress}
        refreshError={app.refreshError}
        lastRefreshed={app.lastRefreshed}
        onRefresh={app.refreshProjections}
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <Page app={app} />
      </div>

      <DragGhost player={app.dragPlayer} pos={app.dragPos} />
    </div>
  );
}
