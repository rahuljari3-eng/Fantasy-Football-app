import type { Player } from "../types";
import { MY_TEAM_PLAYERS } from "./myTeam";
import { FREE_AGENTS } from "./freeAgents";

// Every player in your own universe: your roster plus the free-agent pool.
// (Opponents' rosters live separately in leagueTeams.ts.)
export const PLAYERS: Player[] = [...MY_TEAM_PLAYERS, ...FREE_AGENTS];
