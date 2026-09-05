import type { LeagueTeam, Player } from "../types.ts";
import { LEAGUE_CONFIG } from "../config/league.ts";

// Your real 2026 roster (Ten Idiots League, ESPN league 973201555).
// Pulled live from the ESPN Fantasy API (Week 1 projections, actual PPR scoring rules).
// "tier" is derived locally from each player's ESPN ownership % (>=80 tier 1, >=40 tier
// 2, else tier 3) -- ESPN doesn't expose a tier field directly.
export const MY_TEAM_PLAYERS: Player[] = [
  { id: 4426515, name: "Puka Nacua", pos: "WR", team: "LAR", bye: 11, proj: 21.1, tier: 1, status: "Questionable" },
  { id: 4432665, name: "Brock Bowers", pos: "TE", team: "LV", bye: 13, proj: 15.6, tier: 1, status: "Healthy" },
  { id: 4427366, name: "Breece Hall", pos: "RB", team: "NYJ", bye: 13, proj: 16.5, tier: 1, status: "Questionable" },
  { id: 4372016, name: "Jaylen Waddle", pos: "WR", team: "DEN", bye: 10, proj: 12.2, tier: 1, status: "Healthy" },
  { id: 3915416, name: "DJ Moore", pos: "WR", team: "BUF", bye: 7, proj: 11.6, tier: 1, status: "Healthy" },
  { id: 4432710, name: "TreVeyon Henderson", pos: "RB", team: "NE", bye: 11, proj: 10.1, tier: 1, status: "Questionable" },
  { id: 4360761, name: "Michael Wilson", pos: "WR", team: "ARI", bye: 14, proj: 10.5, tier: 1, status: "Healthy" },
  { id: 12483, name: "Matthew Stafford", pos: "QB", team: "LAR", bye: 11, proj: 17.5, tier: 1, status: "Healthy" },
  { id: 4241416, name: "Chuba Hubbard", pos: "RB", team: "CAR", bye: 5, proj: 11.5, tier: 1, status: "Questionable" },
  { id: 4360569, name: "Jordan Mason", pos: "RB", team: "MIN", bye: 6, proj: 8.7, tier: 2, status: "Healthy" },
  { id: 2976212, name: "Stefon Diggs", pos: "WR", team: "WSH", bye: 7, proj: 9.7, tier: 1, status: "Healthy" },
  { id: -16007, name: "Broncos D/ST", pos: "DST", team: "DEN", bye: 10, proj: 5.9, tier: 1, status: "Healthy" },
  { id: 4686361, name: "Cam Little", pos: "K", team: "JAX", bye: 7, proj: 8.8, tier: 1, status: "Healthy" },
  { id: 4685247, name: "Braelon Allen", pos: "RB", team: "NYJ", bye: 13, proj: 4.6, tier: 3, status: "Healthy" },
  { id: 3929645, name: "Juwan Johnson", pos: "TE", team: "NO", bye: 8, proj: 8.8, tier: 2, status: "Healthy" },
  { id: 4429023, name: "MarShawn Lloyd", pos: "RB", team: "GB", bye: 11, proj: 12.9, tier: 2, status: "Healthy" },
];

// Which ESPN lineup slot each of your players was starting in, so your team
// can be treated as just another LeagueTeam (same shape as every opponent in
// leagueTeams.ts). Anyone not listed here is on the bench.
const MY_TEAM_LINEUP: Record<number, string> = {
  12483: "QB", // Matthew Stafford
  4427366: "RB", // Breece Hall
  4429023: "RB", // MarShawn Lloyd
  4426515: "WR", // Puka Nacua
  4372016: "WR", // Jaylen Waddle
  3915416: "FLEX", // DJ Moore
  4432665: "TE", // Brock Bowers
  [-16007]: "DST", // Broncos D/ST
  4686361: "K", // Cam Little
};

// Your team as a full LeagueTeam entry, so the app can select it or any
// opponent interchangeably as "the team you're managing". `id` must match
// ESPN's own numeric team id (not just be unique locally) -- syncRosterFromEspn
// in useFantasyApp looks up this id in the live ESPN lineup response, so a
// mismatch here means your team silently never picks up live ESPN changes.
export const MY_TEAM: LeagueTeam = {
  id: 10,
  name: LEAGUE_CONFIG.myTeamName,
  owner: LEAGUE_CONFIG.myOwnerName,
  roster: MY_TEAM_PLAYERS.map((p) => {
    const slot = MY_TEAM_LINEUP[p.id] ?? "BE";
    return { ...p, starter: slot !== "BE", slot };
  }),
};
