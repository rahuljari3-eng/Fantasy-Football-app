import type { LeagueTeam } from "../types.js";
import { LEAGUE_TEAMS } from "./leagueTeams.js";
import { MY_TEAM } from "./myTeam.js";

// Every team in the league, yours first. The app lets you pick any one of
// these as "the team you're managing" -- the roster builder, AI Coach, free
// agents, and trade analyzer all re-center on whichever team is selected.
export const ALL_TEAMS: LeagueTeam[] = [MY_TEAM, ...LEAGUE_TEAMS];

// The team selected by default on a fresh visit.
export const DEFAULT_TEAM_ID = MY_TEAM.id;
