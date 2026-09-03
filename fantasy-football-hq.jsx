import React, { useState, useMemo, useEffect, useRef } from "react";
import { Shield, Repeat, Newspaper, Users, UserPlus, TrendingUp, TrendingDown, AlertTriangle, X, Plus, ChevronRight, Trophy, Activity, Sparkles, ArrowUpFromLine, ArrowDownToLine, RefreshCw } from "lucide-react";

// ---------- YOUR REAL 2026 ROSTER (Ten Idiots League, ESPN league 973201555) ----------
// Pulled live from the ESPN Fantasy API (Week 1 projections, actual PPR scoring rules).
// "tier" is derived locally from each player's ESPN ownership % (>=80 tier 1, >=40 tier 2, else tier 3) -- ESPN doesn't expose a tier field directly.
const MY_TEAM_PLAYERS = [
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

// ---------- REAL AVAILABLE FREE AGENTS (for trades / waiver browsing) ----------
// Currently unrostered in your league, pulled live from ESPN and sorted by projection.
const PLAYERS = [
  ...MY_TEAM_PLAYERS,
  { id: 4432577, name: "C.J. Stroud", pos: "QB", team: "HOU", bye: 8, proj: 16.2, tier: 3, status: "Healthy" },
  { id: 3046779, name: "Jared Goff", pos: "QB", team: "DET", bye: 6, proj: 15.8, tier: 2, status: "Healthy" },
  { id: 4685720, name: "Bryce Young", pos: "QB", team: "CAR", bye: 5, proj: 15.7, tier: 3, status: "Healthy" },
  { id: 4036378, name: "Jordan Love", pos: "QB", team: "GB", bye: 11, proj: 15.3, tier: 2, status: "Healthy" },
  { id: 4242512, name: "Malik Willis", pos: "QB", team: "MIA", bye: 6, proj: 15.1, tier: 3, status: "Healthy" },
  { id: 8439, name: "Aaron Rodgers", pos: "QB", team: "PIT", bye: 9, proj: 14.8, tier: 3, status: "Healthy" },
  { id: 14880, name: "Kirk Cousins", pos: "QB", team: "LV", bye: 13, proj: 14.7, tier: 3, status: "Healthy" },
  { id: 4360689, name: "Tyler Shough", pos: "QB", team: "NO", bye: 8, proj: 14.2, tier: 2, status: "Healthy" },
  { id: 3912547, name: "Sam Darnold", pos: "QB", team: "SEA", bye: 11, proj: 14.0, tier: 3, status: "Healthy" },
  { id: 15864, name: "Geno Smith", pos: "QB", team: "NYJ", bye: 13, proj: 13.8, tier: 3, status: "Healthy" },
  { id: 4688380, name: "Cam Ward", pos: "QB", team: "TEN", bye: 9, proj: 13.6, tier: 3, status: "Healthy" },
  { id: 2578570, name: "Jacoby Brissett", pos: "QB", team: "ARI", bye: 14, proj: 13.2, tier: 3, status: "Healthy" },
  { id: 3122840, name: "Deshaun Watson", pos: "QB", team: "CLE", bye: 11, proj: 12.6, tier: 3, status: "Healthy" },
  { id: 4241479, name: "Tua Tagovailoa", pos: "QB", team: "ATL", bye: 11, proj: 10.7, tier: 3, status: "Healthy" },
  { id: 4569559, name: "Devaughn Vele", pos: "WR", team: "NO", bye: 8, proj: 9.3, tier: 3, status: "Healthy" },
  { id: 17372, name: "Chris Boswell", pos: "K", team: "PIT", bye: 9, proj: 9.0, tier: 3, status: "Healthy" },
  { id: 3050478, name: "Jake Elliott", pos: "K", team: "PHI", bye: 10, proj: 8.5, tier: 3, status: "Healthy" },
  { id: 4697745, name: "Tyler Loop", pos: "K", team: "BAL", bye: 13, proj: 8.5, tier: 2, status: "Healthy" },
  { id: 3117256, name: "Dalton Schultz", pos: "TE", team: "HOU", bye: 8, proj: 8.4, tier: 3, status: "Healthy" },
  { id: 3150744, name: "Chase McLaughlin", pos: "K", team: "TB", bye: 10, proj: 8.4, tier: 3, status: "Healthy" },
  { id: 4361411, name: "Pat Freiermuth", pos: "TE", team: "PIT", bye: 9, proj: 8.4, tier: 3, status: "Healthy" },
  { id: 3046439, name: "Hunter Henry", pos: "TE", team: "NE", bye: 11, proj: 8.3, tier: 2, status: "Healthy" },
  { id: 4586312, name: "Jaylin Noel", pos: "WR", team: "HOU", bye: 8, proj: 8.3, tier: 3, status: "Questionable" },
  { id: 4869461, name: "Trey Smack", pos: "K", team: "GB", bye: 11, proj: 8.3, tier: 3, status: "Healthy" },
  { id: 4571557, name: "Spencer Shrader", pos: "K", team: "IND", bye: 13, proj: 8.2, tier: 3, status: "Healthy" },
  { id: 4249087, name: "Matt Gay", pos: "K", team: "LV", bye: 13, proj: 8.1, tier: 3, status: "Healthy" },
  { id: 4430539, name: "Brenton Strange", pos: "TE", team: "JAX", bye: 7, proj: 8.1, tier: 3, status: "Healthy" },
  { id: 4597500, name: "Adonai Mitchell", pos: "WR", team: "NYJ", bye: 13, proj: 8.1, tier: 3, status: "Healthy" },
  { id: 5082424, name: "Dominic Zvada", pos: "K", team: "NYG", bye: 8, proj: 8.1, tier: 3, status: "Healthy" },
  { id: 10621, name: "Nick Folk", pos: "K", team: "ATL", bye: 11, proj: 7.8, tier: 3, status: "Healthy" },
  { id: 4568263, name: "Ryan Fitzgerald", pos: "K", team: "CAR", bye: 5, proj: 7.8, tier: 3, status: "Healthy" },
  { id: 3051909, name: "Daniel Carlson", pos: "K", team: "NO", bye: 8, proj: 7.7, tier: 3, status: "Healthy" },
  { id: 2985659, name: "Wil Lutz", pos: "K", team: "DEN", bye: 10, proj: 7.6, tier: 3, status: "Healthy" },
  { id: 3124084, name: "Joey Slye", pos: "K", team: "TEN", bye: 9, proj: 7.6, tier: 3, status: "Healthy" },
  { id: 4243371, name: "Riley Patterson", pos: "K", team: "MIA", bye: 6, proj: 7.6, tier: 3, status: "Healthy" },
  { id: 3917232, name: "Tyler Bass", pos: "K", team: "BUF", bye: 7, proj: 7.5, tier: 3, status: "Healthy" },
  { id: 4686728, name: "Gunnar Helm", pos: "TE", team: "TEN", bye: 9, proj: 7.5, tier: 3, status: "Healthy" },
  { id: 5081335, name: "Drew Stevens", pos: "K", team: "WSH", bye: 7, proj: 7.4, tier: 3, status: "Healthy" },
  { id: 4360939, name: "Rashod Bateman", pos: "WR", team: "BAL", bye: 13, proj: 7.3, tier: 3, status: "Healthy" },
  { id: 4428850, name: "Dontayvion Wicks", pos: "WR", team: "PHI", bye: 10, proj: 7.3, tier: 3, status: "Healthy" },
  { id: 2576925, name: "Darren Waller", pos: "TE", team: "CAR", bye: 5, proj: 7.1, tier: 3, status: "Healthy" },
  { id: 4258620, name: "Andre Szmyt", pos: "K", team: "CLE", bye: 11, proj: 7.1, tier: 3, status: "Healthy" },
  { id: 4367209, name: "Greg Dulcich", pos: "TE", team: "MIA", bye: 6, proj: 7.1, tier: 3, status: "Healthy" },
  { id: 4259619, name: "Blake Grupe", pos: "K", team: "NYJ", bye: 13, proj: 7.0, tier: 3, status: "Healthy" },
  { id: 4363538, name: "Chad Ryland", pos: "K", team: "ARI", bye: 14, proj: 7.0, tier: 3, status: "Healthy" },
  { id: 4569603, name: "Malik Washington", pos: "WR", team: "MIA", bye: 6, proj: 6.9, tier: 3, status: "Healthy" },
  { id: 4569923, name: "Andy Borregales", pos: "K", team: "NE", bye: 11, proj: 6.9, tier: 3, status: "Healthy" },
  { id: 4360635, name: "Chig Okonkwo", pos: "TE", team: "WSH", bye: 7, proj: 6.8, tier: 3, status: "Healthy" },
  { id: 4685261, name: "Germie Bernard", pos: "WR", team: "PIT", bye: 9, proj: 6.8, tier: 3, status: "Healthy" },
  { id: 4869645, name: "Caleb Douglas", pos: "WR", team: "MIA", bye: 6, proj: 6.8, tier: 3, status: "Healthy" },
  { id: -16020, name: "Jets D/ST", pos: "DST", team: "NYJ", bye: 13, proj: 6.7, tier: 3, status: "Healthy" },
  { id: 3886598, name: "Jauan Jennings", pos: "WR", team: "MIN", bye: 6, proj: 6.7, tier: 3, status: "Healthy" },
  { id: 4576297, name: "AJ Barner", pos: "TE", team: "SEA", bye: 11, proj: 6.6, tier: 3, status: "Healthy" },
  { id: 3123076, name: "David Njoku", pos: "TE", team: "LAC", bye: 7, proj: 6.5, tier: 3, status: "Healthy" },
  { id: 4429835, name: "George Holani", pos: "RB", team: "SEA", bye: 11, proj: 6.4, tier: 3, status: "Healthy" },
  { id: 4243331, name: "Cade Otton", pos: "TE", team: "TB", bye: 10, proj: 6.3, tier: 3, status: "Healthy" },
  { id: 2977187, name: "Cooper Kupp", pos: "WR", team: "SEA", bye: 11, proj: 6.2, tier: 3, status: "Healthy" },
  { id: 4383429, name: "Jacob Saylors", pos: "RB", team: "DET", bye: 6, proj: 6.2, tier: 3, status: "Healthy" },
  { id: 3051876, name: "Evan Engram", pos: "TE", team: "DEN", bye: 10, proj: 6.1, tier: 3, status: "Healthy" },
  { id: 4599739, name: "Kendre Miller", pos: "RB", team: "NO", bye: 8, proj: 6.1, tier: 3, status: "Questionable" },
];

// ---------- REAL LEAGUE ROSTERS (12-team "Ten Idiots League", ESPN league 973201555) ----------
// Pulled live from ESPN. "starter"/"slot" reflect each manager's ACTUAL lineup (ESPN's
// own lineupSlotId), not a reconstruction -- this is really who they're starting.
const LEAGUE_TEAMS = [
  { id: 1, name: "Mccafricanamericans", owner: "Rishi Pungaliya", roster: [
    { id: 4429160, name: "De'Von Achane", pos: "RB", team: "MIA", proj: 18.2, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "RB" },
    { id: 4890973, name: "Ashton Jeanty", pos: "RB", team: "LV", proj: 18.1, tier: 1, status: "Questionable", bye: 13, starter: true, slot: "RB" },
    { id: 4241478, name: "DeVonta Smith", pos: "WR", team: "PHI", proj: 14.8, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "WR" },
    { id: 4567750, name: "Emeka Egbuka", pos: "WR", team: "TB", proj: 14.0, tier: 1, status: "Questionable", bye: 10, starter: true, slot: "WR" },
    { id: 4431459, name: "Tyler Warren", pos: "TE", team: "IND", proj: 12.2, tier: 1, status: "Questionable", bye: 13, starter: true, slot: "TE" },
    { id: 4040715, name: "Jalen Hurts", pos: "QB", team: "PHI", proj: 21.1, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "QB" },
    { id: 4360078, name: "Alec Pierce", pos: "WR", team: "IND", proj: 9.7, tier: 1, status: "Questionable", bye: 13, starter: false, slot: "BE" },
    { id: 4038815, name: "Rico Dowdle", pos: "RB", team: "PIT", proj: 12.5, tier: 1, status: "Healthy", bye: 9, starter: true, slot: "FLEX" },
    { id: 4686658, name: "Mike Washington Jr.", pos: "RB", team: "LV", proj: 6.8, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 4870795, name: "Makai Lemon", pos: "WR", team: "PHI", proj: 8.5, tier: 2, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 4568490, name: "RJ Harvey", pos: "RB", team: "DEN", proj: 8.5, tier: 2, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 4426385, name: "Zach Charbonnet", pos: "RB", team: "SEA", proj: 0.0, tier: 2, status: "Out", bye: 11, starter: false, slot: "IR" },
    { id: 4428718, name: "Tre Tucker", pos: "WR", team: "LV", proj: 9.1, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 4689936, name: "Jake Bates", pos: "K", team: "DET", proj: 8.7, tier: 2, status: "Healthy", bye: 6, starter: true, slot: "K" },
    { id: -16024, name: "Chargers D/ST", pos: "DST", team: "LAC", proj: 7.5, tier: 2, status: "Healthy", bye: 7, starter: true, slot: "DST" },
    { id: 3149687, name: "Chris Brooks", pos: "RB", team: "GB", proj: 7.7, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4723820, name: "Omar Cooper Jr.", pos: "WR", team: "NYJ", proj: 5.7, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
  ]},
  { id: 2, name: "Yorkin'  it in Loveland", owner: "Vivek Garg", roster: [
    { id: 4242335, name: "Jonathan Taylor", pos: "RB", team: "IND", proj: 17.8, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "RB" },
    { id: 4426502, name: "Drake London", pos: "WR", team: "ATL", proj: 15.1, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "WR" },
    { id: 4047365, name: "Josh Jacobs", pos: "RB", team: "GB", proj: 0.0, tier: 1, status: "DAY_TO_DAY", bye: 11, starter: false, slot: "BE" },
    { id: 4685472, name: "Tetairoa McMillan", pos: "WR", team: "CAR", proj: 14.8, tier: 1, status: "Healthy", bye: 5, starter: true, slot: "WR" },
    { id: 4723086, name: "Colston Loveland", pos: "TE", team: "CHI", proj: 12.0, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "TE" },
    { id: 3128429, name: "Courtland Sutton", pos: "WR", team: "DEN", proj: 11.7, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "FLEX" },
    { id: 3915511, name: "Joe Burrow", pos: "QB", team: "CIN", proj: 18.2, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "QB" },
    { id: 4432773, name: "Brian Thomas Jr.", pos: "WR", team: "JAX", proj: 10.1, tier: 1, status: "Healthy", bye: 7, starter: false, slot: "BE" },
    { id: 4241985, name: "J.K. Dobbins", pos: "RB", team: "DEN", proj: 9.5, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "RB" },
    { id: 4429025, name: "Quentin Johnston", pos: "WR", team: "LAC", proj: 10.4, tier: 2, status: "Healthy", bye: 7, starter: false, slot: "BE" },
    { id: 4697815, name: "Rachaad White", pos: "RB", team: "WSH", proj: 8.9, tier: 2, status: "Questionable", bye: 7, starter: false, slot: "BE" },
    { id: 4362619, name: "Chris Rodriguez Jr.", pos: "RB", team: "JAX", proj: 4.8, tier: 3, status: "Healthy", bye: 7, starter: false, slot: "BE" },
    { id: -16026, name: "Seahawks D/ST", pos: "DST", team: "SEA", proj: 7.1, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "DST" },
    { id: 4430834, name: "Jalen McMillan", pos: "WR", team: "TB", proj: 8.2, tier: 3, status: "Questionable", bye: 10, starter: false, slot: "BE" },
    { id: 17427, name: "Cairo Santos", pos: "K", team: "CHI", proj: 8.3, tier: 3, status: "Healthy", bye: 10, starter: true, slot: "K" },
    { id: 4819231, name: "Kaleb Johnson", pos: "RB", team: "GB", proj: 1.3, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
  ]},
  { id: 3, name: "Gibbs me head", owner: "Shriyan Gote", roster: [
    { id: 4429795, name: "Jahmyr Gibbs", pos: "RB", team: "DET", proj: 21.7, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "RB" },
    { id: 4361307, name: "Trey McBride", pos: "TE", team: "ARI", proj: 14.4, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "TE" },
    { id: 4258173, name: "Nico Collins", pos: "WR", team: "HOU", proj: 15.6, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "WR" },
    { id: 3121422, name: "Terry McLaurin", pos: "WR", team: "WSH", proj: 12.3, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "FLEX" },
    { id: 4871023, name: "Carnell Tate", pos: "WR", team: "TEN", proj: 12.0, tier: 1, status: "Questionable", bye: 9, starter: false, slot: "BE" },
    { id: 4678008, name: "Jonathon Brooks", pos: "RB", team: "CAR", proj: 11.5, tier: 1, status: "Questionable", bye: 5, starter: true, slot: "RB" },
    { id: 4047650, name: "DK Metcalf", pos: "WR", team: "PIT", proj: 12.2, tier: 1, status: "Questionable", bye: 9, starter: true, slot: "WR" },
    { id: 4038941, name: "Justin Herbert", pos: "QB", team: "LAC", proj: 19.0, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "QB" },
    { id: 4569587, name: "Wan'Dale Robinson", pos: "WR", team: "TEN", proj: 10.4, tier: 1, status: "Questionable", bye: 9, starter: false, slot: "BE" },
    { id: 3042519, name: "Aaron Jones Sr.", pos: "RB", team: "MIN", proj: 10.3, tier: 1, status: "Healthy", bye: 6, starter: false, slot: "BE" },
    { id: 4362249, name: "Jayden Reed", pos: "WR", team: "GB", proj: 10.2, tier: 2, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4241463, name: "Jerry Jeudy", pos: "WR", team: "CLE", proj: 8.1, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4034949, name: "Eddy Pineiro", pos: "K", team: "SF", proj: 8.7, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "K" },
    { id: 4570037, name: "Terrance Ferguson", pos: "TE", team: "LAR", proj: 8.1, tier: 3, status: "Questionable", bye: 11, starter: false, slot: "BE" },
    { id: 4361529, name: "Isiah Pacheco", pos: "RB", team: "DET", proj: 0.0, tier: 2, status: "IR", bye: 6, starter: false, slot: "IR" },
    { id: -16010, name: "Titans D/ST", pos: "DST", team: "TEN", proj: 6.8, tier: 3, status: "Healthy", bye: 9, starter: true, slot: "DST" },
  ]},
  { id: 4, name: "Amon Drugs", owner: "Manish Kavuri", roster: [
    { id: 4374302, name: "Amon-Ra St. Brown", pos: "WR", team: "DET", proj: 18.8, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "WR" },
    { id: 3043078, name: "Derrick Henry", pos: "RB", team: "BAL", proj: 16.4, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "RB" },
    { id: 4426354, name: "George Pickens", pos: "WR", team: "DAL", proj: 14.7, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "WR" },
    { id: 4696981, name: "Cam Skattebo", pos: "RB", team: "NYG", proj: 13.7, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "RB" },
    { id: 4426388, name: "Jameson Williams", pos: "WR", team: "DET", proj: 12.1, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "FLEX" },
    { id: 4569173, name: "Rhamondre Stevenson", pos: "RB", team: "NE", proj: 10.5, tier: 1, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 3040151, name: "George Kittle", pos: "TE", team: "SF", proj: 8.4, tier: 1, status: "Questionable", bye: 8, starter: false, slot: "BE" },
    { id: 4361741, name: "Brock Purdy", pos: "QB", team: "SF", proj: 15.5, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "QB" },
    { id: 4688813, name: "Josh Downs", pos: "WR", team: "IND", proj: 9.1, tier: 2, status: "Questionable", bye: 13, starter: false, slot: "BE" },
    { id: 3121023, name: "Dallas Goedert", pos: "TE", team: "PHI", proj: 10.9, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "TE" },
    { id: 4366031, name: "Tank Dell", pos: "WR", team: "HOU", proj: 0.0, tier: 3, status: "IR", bye: 8, starter: false, slot: "BE" },
    { id: 4428557, name: "Tyjae Spears", pos: "RB", team: "TEN", proj: 9.4, tier: 2, status: "Healthy", bye: 9, starter: false, slot: "BE" },
    { id: -16033, name: "Ravens D/ST", pos: "DST", team: "BAL", proj: 6.8, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "DST" },
    { id: 2971573, name: "Ka'imi Fairbairn", pos: "K", team: "HOU", proj: 9.8, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "K" },
    { id: 4832800, name: "Denzel Boston", pos: "WR", team: "CLE", proj: 8.3, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4360516, name: "Tyrone Tracy Jr.", pos: "RB", team: "NYG", proj: 2.4, tier: 3, status: "Questionable", bye: 8, starter: false, slot: "BE" },
  ]},
  { id: 5, name: "I Chase Brown Kids", owner: "Sachit Sinha / Sachit Sinha", roster: [
    { id: 4262921, name: "Justin Jefferson", pos: "WR", team: "MIN", proj: 17.1, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "WR" },
    { id: 4362238, name: "Chase Brown", pos: "RB", team: "CIN", proj: 16.0, tier: 1, status: "Healthy", bye: 6, starter: true, slot: "RB" },
    { id: 4569618, name: "Garrett Wilson", pos: "WR", team: "NYJ", proj: 14.8, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "WR" },
    { id: 4361579, name: "Javonte Williams", pos: "RB", team: "DAL", proj: 15.2, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "RB" },
    { id: 4426348, name: "Jayden Daniels", pos: "QB", team: "WSH", proj: 16.8, tier: 1, status: "Healthy", bye: 7, starter: false, slot: "BE" },
    { id: 4035538, name: "David Montgomery", pos: "RB", team: "HOU", proj: 12.7, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "FLEX" },
    { id: 16737, name: "Mike Evans", pos: "WR", team: "SF", proj: 10.6, tier: 1, status: "Questionable", bye: 8, starter: false, slot: "BE" },
    { id: 4572680, name: "Tucker Kraft", pos: "TE", team: "GB", proj: 9.1, tier: 1, status: "Questionable", bye: 11, starter: true, slot: "TE" },
    { id: 3116165, name: "Chris Godwin Jr.", pos: "WR", team: "TB", proj: 9.7, tier: 2, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 4575131, name: "Jacory Croskey-Merritt", pos: "RB", team: "WSH", proj: 8.3, tier: 2, status: "Questionable", bye: 7, starter: false, slot: "BE" },
    { id: 4361050, name: "Isaiah Likely", pos: "TE", team: "NYG", proj: 9.4, tier: 1, status: "Healthy", bye: 8, starter: false, slot: "BE" },
    { id: 4360234, name: "Evan McPherson", pos: "K", team: "CIN", proj: 8.5, tier: 3, status: "Healthy", bye: 6, starter: true, slot: "K" },
    { id: -16008, name: "Lions D/ST", pos: "DST", team: "DET", proj: 7.4, tier: 2, status: "Healthy", bye: 6, starter: true, slot: "DST" },
    { id: 4912218, name: "Cyrus Allen", pos: "WR", team: "KC", proj: 2.9, tier: 3, status: "Healthy", bye: 5, starter: false, slot: "BE" },
    { id: 4360310, name: "Trevor Lawrence", pos: "QB", team: "JAX", proj: 17.0, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "QB" },
    { id: 4240603, name: "Malik Davis", pos: "RB", team: "DAL", proj: 3.4, tier: 3, status: "Healthy", bye: 14, starter: false, slot: "BE" },
  ]},
  { id: 6, name: "Kareem Pies", owner: "Anish Deshpande", roster: [
    { id: 4430878, name: "Jaxon Smith-Njigba", pos: "WR", team: "SEA", proj: 18.9, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "WR" },
    { id: 4430737, name: "Kyren Williams", pos: "RB", team: "LAR", proj: 13.7, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "RB" },
    { id: 4596448, name: "Bucky Irving", pos: "RB", team: "TB", proj: 12.4, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "RB" },
    { id: 4431452, name: "Drake Maye", pos: "QB", team: "NE", proj: 16.2, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "QB" },
    { id: 15847, name: "Travis Kelce", pos: "TE", team: "KC", proj: 9.8, tier: 1, status: "Healthy", bye: 5, starter: true, slot: "TE" },
    { id: 3916148, name: "Tony Pollard", pos: "RB", team: "TEN", proj: 11.5, tier: 1, status: "Healthy", bye: 9, starter: false, slot: "BE" },
    { id: 4710714, name: "De'Zhaun Stribling", pos: "WR", team: "SF", proj: 9.6, tier: 2, status: "Questionable", bye: 8, starter: false, slot: "BE" },
    { id: 4242355, name: "Jake Ferguson", pos: "TE", team: "DAL", proj: 9.8, tier: 1, status: "Healthy", bye: 14, starter: false, slot: "BE" },
    { id: 4032473, name: "Rashid Shaheed", pos: "WR", team: "SEA", proj: 8.4, tier: 2, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: -16034, name: "Texans D/ST", pos: "DST", team: "HOU", proj: 5.2, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "DST" },
    { id: 4241474, name: "Brian Robinson Jr.", pos: "RB", team: "ATL", proj: 5.0, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 3052587, name: "Baker Mayfield", pos: "QB", team: "TB", proj: 16.2, tier: 2, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 4362081, name: "Cameron Dicker", pos: "K", team: "LAC", proj: 10.3, tier: 1, status: "Questionable", bye: 7, starter: true, slot: "K" },
    { id: 4382466, name: "Jalen Nailor", pos: "WR", team: "LV", proj: 8.2, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 4685278, name: "Luther Burden III", pos: "WR", team: "CHI", proj: 12.0, tier: 1, status: "Questionable", bye: 10, starter: true, slot: "WR" },
    { id: 4239996, name: "Travis Etienne Jr.", pos: "RB", team: "NO", proj: 15.0, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "FLEX" },
  ]},
  { id: 7, name: "ConkInSon", owner: "Aryan Makhija", roster: [
    { id: 4379399, name: "James Cook III", pos: "RB", team: "BUF", proj: 14.9, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "RB" },
    { id: 3929630, name: "Saquon Barkley", pos: "RB", team: "PHI", proj: 17.7, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "RB" },
    { id: 4612826, name: "Ladd McConkey", pos: "WR", team: "LAC", proj: 13.8, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "WR" },
    { id: 4035687, name: "Michael Pittman Jr.", pos: "WR", team: "PIT", proj: 12.3, tier: 1, status: "Questionable", bye: 9, starter: true, slot: "WR" },
    { id: 4248528, name: "Christian Watson", pos: "WR", team: "GB", proj: 11.1, tier: 1, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4431611, name: "Caleb Williams", pos: "QB", team: "CHI", proj: 16.3, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "QB" },
    { id: 3126486, name: "Deebo Samuel Sr.", pos: "WR", team: "SF", proj: 8.9, tier: 2, status: "Healthy", bye: 8, starter: false, slot: "BE" },
    { id: 4429059, name: "Woody Marks", pos: "RB", team: "HOU", proj: 8.3, tier: 2, status: "Healthy", bye: 8, starter: false, slot: "BE" },
    { id: 4036133, name: "T.J. Hockenson", pos: "TE", team: "MIN", proj: 9.2, tier: 2, status: "Healthy", bye: 6, starter: true, slot: "TE" },
    { id: -16014, name: "Rams D/ST", pos: "DST", team: "LAR", proj: 6.2, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "DST" },
    { id: 4567104, name: "Will Reichard", pos: "K", team: "MIN", proj: 8.4, tier: 3, status: "Healthy", bye: 6, starter: true, slot: "K" },
    { id: 4428331, name: "Rashee Rice", pos: "WR", team: "KC", proj: 14.4, tier: 1, status: "Healthy", bye: 5, starter: true, slot: "FLEX" },
    { id: 4695883, name: "Jalen Coker", pos: "WR", team: "CAR", proj: 9.2, tier: 2, status: "Healthy", bye: 5, starter: false, slot: "BE" },
    { id: 4702555, name: "Jonah Coleman", pos: "RB", team: "DEN", proj: 4.1, tier: 3, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 4696044, name: "Kaelon Black", pos: "RB", team: "SF", proj: 3.1, tier: 3, status: "Healthy", bye: 8, starter: false, slot: "BE" },
    { id: 4429022, name: "Kayshon Boutte", pos: "WR", team: "HOU", proj: 8.8, tier: 3, status: "Healthy", bye: 8, starter: false, slot: "BE" },
  ]},
  { id: 9, name: "Warner, I Barely Know Her", owner: "Ryan Brahan", roster: [
    { id: 4241389, name: "CeeDee Lamb", pos: "WR", team: "DAL", proj: 17.2, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "WR" },
    { id: 4567048, name: "Kenneth Walker III", pos: "RB", team: "KC", proj: 14.7, tier: 1, status: "Healthy", bye: 5, starter: true, slot: "RB" },
    { id: 4429615, name: "Zay Flowers", pos: "WR", team: "BAL", proj: 14.2, tier: 1, status: "Questionable", bye: 13, starter: true, slot: "WR" },
    { id: 4685702, name: "Quinshon Judkins", pos: "RB", team: "CLE", proj: 13.2, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "RB" },
    { id: 4685512, name: "Jadarian Price", pos: "RB", team: "SEA", proj: 13.6, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "FLEX" },
    { id: 4360248, name: "Kyle Pitts Sr.", pos: "TE", team: "ATL", proj: 10.4, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "TE" },
    { id: 4689114, name: "Jaxson Dart", pos: "QB", team: "NYG", proj: 18.5, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "QB" },
    { id: 3916433, name: "Jakobi Meyers", pos: "WR", team: "JAX", proj: 10.4, tier: 1, status: "Questionable", bye: 7, starter: false, slot: "BE" },
    { id: 4683062, name: "Xavier Worthy", pos: "WR", team: "KC", proj: 9.5, tier: 2, status: "Healthy", bye: 5, starter: false, slot: "BE" },
    { id: 4608686, name: "Kyle Monangai", pos: "RB", team: "CHI", proj: 10.3, tier: 2, status: "Questionable", bye: 10, starter: false, slot: "BE" },
    { id: 5083315, name: "Kenyon Sadiq", pos: "TE", team: "NYJ", proj: 5.1, tier: 2, status: "Questionable", bye: 13, starter: false, slot: "BE" },
    { id: 3054850, name: "Alvin Kamara", pos: "RB", team: "NO", proj: 0.0, tier: 2, status: "Questionable", bye: 8, starter: false, slot: "BE" },
    { id: -16023, name: "Steelers D/ST", pos: "DST", team: "PIT", proj: 7.5, tier: 1, status: "Healthy", bye: 9, starter: true, slot: "DST" },
    { id: 2473037, name: "Jason Myers", pos: "K", team: "SEA", proj: 9.4, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "K" },
    { id: 15818, name: "Keenan Allen", pos: "WR", team: "IND", proj: 7.2, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 3917792, name: "Daniel Jones", pos: "QB", team: "IND", proj: 15.2, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
  ]},
  { id: 11, name: "Aura Jones Jr.", owner: "Harshith Yallampalli", roster: [
    { id: 4362628, name: "Ja'Marr Chase", pos: "WR", team: "CIN", proj: 19.9, tier: 1, status: "Questionable", bye: 6, starter: true, slot: "WR" },
    { id: 4870808, name: "Jeremiyah Love", pos: "RB", team: "ARI", proj: 14.7, tier: 1, status: "Questionable", bye: 14, starter: true, slot: "RB" },
    { id: 3918298, name: "Josh Allen", pos: "QB", team: "BUF", proj: 19.3, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "QB" },
    { id: 16800, name: "Davante Adams", pos: "WR", team: "LAR", proj: 13.8, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "WR" },
    { id: 5083076, name: "Harold Fannin Jr.", pos: "TE", team: "CLE", proj: 11.1, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "TE" },
    { id: 4432708, name: "Marvin Harrison Jr.", pos: "WR", team: "ARI", proj: 11.5, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "FLEX" },
    { id: 4371733, name: "Kenny Gainwell", pos: "RB", team: "TB", proj: 10.8, tier: 1, status: "Healthy", bye: 10, starter: false, slot: "BE" },
    { id: 2577417, name: "Dak Prescott", pos: "QB", team: "DAL", proj: 16.7, tier: 1, status: "Healthy", bye: 14, starter: false, slot: "BE" },
    { id: 3139477, name: "Patrick Mahomes", pos: "QB", team: "KC", proj: 15.5, tier: 1, status: "Questionable", bye: 5, starter: false, slot: "BE" },
    { id: 4361432, name: "Romeo Doubs", pos: "WR", team: "NE", proj: 8.2, tier: 2, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: -16021, name: "Eagles D/ST", pos: "DST", team: "PHI", proj: 6.3, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "DST" },
    { id: 4574716, name: "Harrison Mevis", pos: "K", team: "LAR", proj: 9.4, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "K" },
    { id: 3925357, name: "Calvin Ridley", pos: "WR", team: "TEN", proj: 8.1, tier: 3, status: "Healthy", bye: 9, starter: false, slot: "BE" },
    { id: 4259545, name: "D'Andre Swift", pos: "RB", team: "CHI", proj: 12.3, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "RB" },
    { id: 4373626, name: "Tyler Allgeier", pos: "RB", team: "ARI", proj: 6.8, tier: 3, status: "Healthy", bye: 14, starter: false, slot: "BE" },
    { id: 4880281, name: "Jordyn Tyson", pos: "WR", team: "NO", proj: 0.0, tier: 2, status: "IR", bye: 8, starter: false, slot: "BE" },
  ]},
  { id: 12, name: "Njigba\u2019s in Paris", owner: "Kevin Korukonda / Aashwin Makhija", roster: [
    { id: 3117251, name: "Christian McCaffrey", pos: "RB", team: "SF", proj: 18.4, tier: 1, status: "Questionable", bye: 8, starter: true, slot: "RB" },
    { id: 4685382, name: "Omarion Hampton", pos: "RB", team: "LAC", proj: 17.6, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "RB" },
    { id: 4595348, name: "Malik Nabers", pos: "WR", team: "NYG", proj: 13.8, tier: 1, status: "Questionable", bye: 8, starter: true, slot: "WR" },
    { id: 3916387, name: "Lamar Jackson", pos: "QB", team: "BAL", proj: 19.1, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "QB" },
    { id: 4432620, name: "Parker Washington", pos: "WR", team: "JAX", proj: 10.8, tier: 1, status: "Healthy", bye: 7, starter: true, slot: "FLEX" },
    { id: 4701936, name: "Matthew Golden", pos: "WR", team: "GB", proj: 11.1, tier: 1, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4429205, name: "Jordan Addison", pos: "WR", team: "MIN", proj: 9.9, tier: 1, status: "Healthy", bye: 6, starter: false, slot: "BE" },
    { id: 4429096, name: "Blake Corum", pos: "RB", team: "LAR", proj: 9.4, tier: 2, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4385690, name: "Dalton Kincaid", pos: "TE", team: "BUF", proj: 8.7, tier: 2, status: "Healthy", bye: 7, starter: true, slot: "TE" },
    { id: 4870653, name: "KC Concepcion", pos: "WR", team: "CLE", proj: 9.1, tier: 2, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 4596334, name: "Keaton Mitchell", pos: "RB", team: "LAC", proj: 6.2, tier: 3, status: "Questionable", bye: 7, starter: false, slot: "BE" },
    { id: 4870847, name: "Ja'Kobi Lane", pos: "WR", team: "BAL", proj: 6.5, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 3953687, name: "Brandon Aubrey", pos: "K", team: "DAL", proj: 9.9, tier: 1, status: "Healthy", bye: 14, starter: true, slot: "K" },
    { id: -16030, name: "Jaguars D/ST", pos: "DST", team: "JAX", proj: 8.2, tier: 2, status: "Healthy", bye: 7, starter: true, slot: "DST" },
    { id: 4239993, name: "Tee Higgins", pos: "WR", team: "CIN", proj: 13.0, tier: 1, status: "Questionable", bye: 6, starter: true, slot: "WR" },
  ]},
  { id: 13, name: "BiBo Samuels", owner: "Aryan Dua", roster: [
    { id: 4430807, name: "Bijan Robinson", pos: "RB", team: "ATL", proj: 19.3, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "RB" },
    { id: 4361370, name: "Chris Olave", pos: "WR", team: "NO", proj: 14.8, tier: 1, status: "Healthy", bye: 8, starter: true, slot: "WR" },
    { id: 4047646, name: "A.J. Brown", pos: "WR", team: "NE", proj: 14.3, tier: 1, status: "Healthy", bye: 11, starter: true, slot: "WR" },
    { id: 4882093, name: "Bhayshul Tuten", pos: "RB", team: "JAX", proj: 12.9, tier: 1, status: "Questionable", bye: 7, starter: true, slot: "RB" },
    { id: 4431299, name: "Rome Odunze", pos: "WR", team: "CHI", proj: 12.4, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "FLEX" },
    { id: 4430027, name: "Sam LaPorta", pos: "TE", team: "DET", proj: 11.0, tier: 1, status: "Questionable", bye: 6, starter: false, slot: "BE" },
    { id: 4569987, name: "Jaylen Warren", pos: "RB", team: "PIT", proj: 12.6, tier: 1, status: "Healthy", bye: 9, starter: false, slot: "BE" },
    { id: 4426338, name: "Bo Nix", pos: "QB", team: "DEN", proj: 16.2, tier: 1, status: "Healthy", bye: 10, starter: true, slot: "QB" },
    { id: 4373678, name: "Khalil Shakir", pos: "WR", team: "BUF", proj: 9.5, tier: 2, status: "Questionable", bye: 7, starter: false, slot: "BE" },
    { id: 4685415, name: "Travis Hunter", pos: "WR", team: "JAX", proj: 6.1, tier: 2, status: "Healthy", bye: 7, starter: false, slot: "BE" },
    { id: 3116365, name: "Mark Andrews", pos: "TE", team: "BAL", proj: 10.1, tier: 1, status: "Healthy", bye: 13, starter: true, slot: "TE" },
    { id: 3917315, name: "Kyler Murray", pos: "QB", team: "MIN", proj: 16.4, tier: 2, status: "Healthy", bye: 6, starter: false, slot: "BE" },
    { id: 4038441, name: "Justice Hill", pos: "RB", team: "BAL", proj: 7.2, tier: 3, status: "Healthy", bye: 13, starter: false, slot: "BE" },
    { id: 5081397, name: "Dylan Sampson", pos: "RB", team: "CLE", proj: 5.0, tier: 3, status: "Healthy", bye: 11, starter: false, slot: "BE" },
    { id: 3055899, name: "Harrison Butker", pos: "K", team: "KC", proj: 8.5, tier: 1, status: "Healthy", bye: 5, starter: true, slot: "K" },
    { id: -16012, name: "Chiefs D/ST", pos: "DST", team: "KC", proj: 5.4, tier: 3, status: "Healthy", bye: 5, starter: true, slot: "DST" },
  ]},
];

// Flat array of every rostered player across the league, tagged with their fantasy team,
// for use in the Trade Analyzer opponent-side picker.
const ALL_LEAGUE_PLAYERS = LEAGUE_TEAMS.flatMap(t => t.roster.map(p => ({ ...p, fantasyTeamId: t.id, fantasyTeamName: t.name })));

// Real injury/news feed, pulled live for players actually rostered across your league.
// Snapshot as of Aug 31, 2026 — this is not a continuously auto-refreshing feed (the
// artifact has no live internet access), so re-run "update injury news" for the latest.
const NEWS_FEED = [
  { id: 1, type: "Injury", player: "Puka Nacua", team: "LAR", headline: "Dealing with soreness in his psoas/groin; Rams are being cautious but he's trending toward playing Week 1 (Sept 10 vs SF).", time: "Aug 31" },
  { id: 2, type: "Injury", player: "Breece Hall", team: "NYJ", headline: "Non-contact groin strain suffered in practice; team expected a 2-3 week absence but says he's on track for the season opener.", time: "Aug 31" },
  { id: 3, type: "Injury", player: "Jeremiyah Love", team: "ARI", headline: "Left his preseason debut with a high-ankle sprain; ruled out of practice and Week 2 preseason action, Week 1 availability in question.", time: "Aug 31" },
  { id: 4, type: "Injury", player: "Chuba Hubbard", team: "CAR", headline: "Hamstring issue but on track for Week 1; expect a committee with Jonathon Brooks to open the season.", time: "Aug 30" },
  { id: 5, type: "Injury", player: "Sam LaPorta", team: "DET", headline: "Returned to practice Aug 25 after a hip injury sidelined him since Aug 17; still working back from last year's season-ending back injury.", time: "Aug 25" },
  { id: 6, type: "Injury", player: "Marvin Harrison Jr.", team: "ARI", headline: "Left a practice early with cramping but was back in the mix the next day; otherwise appears fully healthy entering the season.", time: "Aug 26" },
  { id: 7, type: "Injury", player: "Alec Pierce", team: "IND", headline: "Activated off the PUP list Aug 27; said his goal is to be ready for Week 1, worth monitoring alongside Daniel Jones' Achilles recovery.", time: "Aug 27" },
  { id: 8, type: "Injury", player: "Malik Nabers", team: "NYG", headline: "Practicing without a non-contact jersey and taking part in 11-on-11 drills, a good sign in his return from a torn ACL; on track for Week 1.", time: "Aug 25" },
  { id: 9, type: "Injury", player: "Kyle Monangai", team: "CHI", headline: "Reportedly suffered a hyperextended knee in practice; expected to miss multiple weeks, putting his Week 1 status in doubt.", time: "Aug 30" },
  { id: 10, type: "Injury", player: "Patrick Mahomes", team: "KC", headline: "Hasn't missed a camp practice coming off his torn ACL, but coach Andy Reid hasn't confirmed Week 1 status; expect somewhat reduced rushing upside.", time: "Aug 29" },
  { id: 11, type: "Injury", player: "Mike Evans", team: "SF", headline: "Dealing with a groin issue on the 49ers' initial 53-man roster; several banged-up teammates could return to practice this week per Kyle Shanahan.", time: "Aug 30" },
  { id: 12, type: "News", player: "League Wire", team: "—", headline: "Texans traded for WR Kayshon Boutte after Jayden Higgins was lost for the season to a torn ACL — worth monitoring if you're rostering any Houston pass-catchers.", time: "Aug 26" },
];

const POS_COLORS = {
  QB: "bg-red-500/20 text-red-300 border-red-500/40",
  RB: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  WR: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  TE: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  DST: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  K: "bg-pink-500/20 text-pink-300 border-pink-500/40",
};

// League format: PPR, 1 QB / 2 RB / 2 WR / 1 TE / 1 FLEX / 1 D/ST / 1 K
const SLOTS = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "DST", "K"];
const SLOT_ELIGIBILITY = {
  QB: ["QB"], RB1: ["RB"], RB2: ["RB"], WR1: ["WR"], WR2: ["WR"],
  TE: ["TE"], FLEX: ["RB", "WR", "TE"], DST: ["DST"], K: ["K"],
};

function statusColor(status) {
  if (status === "Out" || status === "Doubtful") return "text-red-400";
  if (status === "Questionable") return "text-amber-400";
  return "text-emerald-400";
}

function statusDot(status) {
  if (status === "Out" || status === "Doubtful") return "bg-red-400";
  if (status === "Questionable") return "bg-amber-400";
  return "bg-emerald-400";
}

// ---------- AI COACH: roster-needs analysis + trade-suggestion engine ----------
// Heuristic, not a live model call: it scores your roster position-by-position
// by the *quality* of the players there — projection + tier scarcity premium,
// discounted for current injury risk — not just how many bodies you have.
// It then compares that score to the league-wide average at that position and
// scans every other team's roster for a trade where their surplus fills your
// need and your surplus fills theirs.
const POSITIONS = ["QB", "RB", "WR", "TE", "DST", "K"];
const REQUIRED_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 };

function tierBonus(p) {
  return p.tier === 1 ? 6 : p.tier === 2 ? 2 : 0;
}

// A true difference-maker isn't worth "the sum of two decent players who add up
// to the same points" — real managers won't give up a stud for role players even
// at raw point parity, because that production can't be split or replicated.
// tierBonus above is flat and linear, so on its own it can't capture this: two
// tier-2 players can numerically out-total one tier-1 star. This adds a premium
// that grows QUADRATICALLY once weekly projection clears an "elite" threshold,
// so the gap between one true stud and several merely-good players widens the
// higher the stud's own production goes — something flat per-tier bonuses can't do.
const ELITE_PROJ_THRESHOLD = 18;
const SCARCITY_COEFFICIENT = 0.15;
function scarcityBonus(p) {
  const excess = Math.max(0, p.proj - ELITE_PROJ_THRESHOLD);
  return excess * excess * SCARCITY_COEFFICIENT;
}
function playerValue(p) {
  return p.proj + tierBonus(p) + scarcityBonus(p);
}

// Injury discount applied on top of playerValue so a banged-up "elite" player
// doesn't get counted at full strength when judging how good a position group is.
function injuryDiscount(status) {
  if (status === "Out") return 0.4;
  if (status === "Doubtful") return 0.65;
  if (status === "Questionable") return 0.9;
  return 1;
}
function qualityScore(p) {
  return playerValue(p) * injuryDiscount(p.status);
}

// A locked-in starter is worth more to a team than a bench player with similar
// raw projection — it occupies a scarce lineup slot and represents guaranteed
// weekly production, not a speculative flex piece. This premium is what stops
// the trade engine from treating "two decent bench guys" as equal to "one
// starter" just because their point totals happen to add up the same way.
function starterPremium(tier) {
  return tier === 1 ? 8 : tier === 2 ? 4 : 2;
}
function isPlayerStarter(player, needsObj) {
  const posNeeds = needsObj[player.pos];
  return !!posNeeds && posNeeds.starters.some((p) => p.id === player.id);
}
function starterAdjustedValue(player, isStarting) {
  return playerValue(player) + (isStarting ? starterPremium(player.tier) : 0);
}

// ---------- Rest-of-season value estimate ----------
// Projects a 16-game season total (17 weeks minus one bye) from the same weekly
// projection, then adjusts it for two things a single week's number can't capture:
// 1) tier trajectory — elite players tend to hold or grow their role over a season,
//    while deep bench/flex players carry more bust risk across 16 games than in
//    any one week.
// 2) current injury status — a "Questionable" tag barely dents a season outlook,
//    but "Doubtful"/"Out" implies real missed-time risk if it lingers.
// This is a heuristic scaling of the same weekly proj, not an independently
// modeled season projection (e.g. it won't catch a role change mid-season).
const ROS_WEEKS = 16;
function rosStatusMultiplier(status) {
  if (status === "Out") return 0.75;
  if (status === "Doubtful") return 0.85;
  if (status === "Questionable") return 0.97;
  return 1;
}
function rosTierTrend(tier) {
  return tier === 1 ? 1.05 : tier === 2 ? 1.0 : 0.92;
}
function rosValue(p) {
  return (p.proj + scarcityBonus(p)) * ROS_WEEKS * rosStatusMultiplier(p.status) * rosTierTrend(p.tier);
}

function analyzeRosterNeeds(playersList) {
  const needs = {};
  POSITIONS.forEach((pos) => {
    const ps = playersList
      .filter((p) => p.pos === pos)
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .sort((a, b) => b.qScore - a.qScore);

    const required = REQUIRED_STARTERS[pos];
    const starters = ps.slice(0, required);
    const bench = ps.slice(required);

    // Starter quality score: sum of the injury-adjusted value of the players who'd
    // actually start here, divided by REQUIRED slots (not starters.length) — so a
    // missing starter drags the score down just as much as a weak one would.
    const starterScore = starters.reduce((s, p) => s + p.qScore, 0) / required;

    // Tradeable depth: bench players good enough (tier 1-2, not currently Out) that
    // another team would actually want them — this is what "surplus" really means,
    // not just having bodies on the roster.
    const tradeableDepth = bench.filter((p) => p.tier <= 2 && p.status !== "Out").sort((a, b) => b.qScore - a.qScore);

    needs[pos] = {
      pos,
      players: ps,
      count: ps.length,
      starters,
      weakestStarter: starters.length ? starters[starters.length - 1] : null,
      starterScore,
      hasEnoughBodies: ps.length >= required,
      tradeableDepth,
    };
  });
  return needs;
}

function newsTypeColor(type) {
  switch (type) {
    case "Injury": return "bg-red-500/15 text-red-300 border-red-500/30";
    case "Waiver": return "bg-teal-500/15 text-teal-300 border-teal-500/30";
    case "Trade": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default: return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
}

function newsTypeIcon(type) {
  switch (type) {
    case "Injury": return AlertTriangle;
    case "Waiver": return TrendingUp;
    case "Trade": return Repeat;
    default: return Newspaper;
  }
}

// ---------- Direct ESPN API access for the "Refresh projections" button ----------
// ESPN's read host (lm-api-reads.fantasy.espn.com) sends CORS headers that reflect
// the request's actual Origin, so this artifact can call it directly from the
// browser for this league — no server-side tool needed for a refresh.
const ESPN_LEAGUE_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/973201555";
const ESPN_INJURY_LABEL_MAP = {
  ACTIVE: "Healthy",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  INJURY_RESERVE: "IR",
  SUSPENSION: "Suspended",
  NORMAL: "Healthy",
};
function extractEspnProjection(stats, scoringPeriodId) {
  const match = (stats || []).find((s) => s.statSourceId === 1 && s.scoringPeriodId === scoringPeriodId);
  return match ? Math.round((match.appliedTotal ?? 0) * 10) / 10 : null;
}

export default function App() {
  const [tab, setTab] = useState("roster");
  // Preloaded with your real Tush Pushers lineup (ESPN league 973201555, pulled live).
  const [roster, setRoster] = useState({
    QB: 12483,      // Matthew Stafford
    RB1: 4427366,   // Breece Hall
    RB2: 4241416,   // Chuba Hubbard
    WR1: 4426515,   // Puka Nacua
    WR2: 4372016,   // Jaylen Waddle
    FLEX: 3915416,  // DJ Moore
    TE: 4432665,    // Brock Bowers
    DST: -16007,    // Broncos D/ST
    K: 4686361,     // Cam Little
  });
  const [bench, setBench] = useState([4432710, 4360761, 4360569, 2976212, 4685247, 3929645, 4429023]);
  // bench: TreVeyon Henderson, Michael Wilson, Jordan Mason, Stefon Diggs, Braelon Allen, Juwan Johnson, MarShawn Lloyd
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [tradeGive, setTradeGive] = useState([]);
  const [tradeGet, setTradeGet] = useState([]);
  const [tradeHorizon, setTradeHorizon] = useState("week"); // "week" | "season" value mode for the Trade Analyzer
  const [selectedLeagueTeam, setSelectedLeagueTeam] = useState(null); // League tab drill-down
  const [tradeOpponentId, setTradeOpponentId] = useState(null); // Trade analyzer: which real team you're trading with
  const [dragOverTarget, setDragOverTarget] = useState(null); // slot name or "bench"
  const [dragPlayer, setDragPlayer] = useState(null); // player object currently being dragged
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(null); // mirrors dragPlayer for use inside event listeners

  // ---------- Live projection refresh ----------
  // projectionOverrides maps a player's real ESPN id -> { proj, status }. Keying by
  // id (not name) means no ambiguity/collision risk and lines up exactly with the
  // ids already baked into MY_TEAM_PLAYERS/LEAGUE_TEAMS/PLAYERS from the live pull.
  // Every place that reads player data below reads from the "effective*" arrays,
  // which are the base PLAYERS/LEAGUE_TEAMS data with overrides applied on top —
  // so a refresh updates rosters, trade values, and the AI Coach everywhere at once.
  const [projectionOverrides, setProjectionOverrides] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [refreshProgress, setRefreshProgress] = useState(null); // { done, total } while a multi-batch refresh runs

  useEffect(() => {
    (async () => {
      try {
        const stored = await window.storage.get("projection-overrides", false);
        if (stored && stored.value) setProjectionOverrides(JSON.parse(stored.value));
      } catch (e) {
        // no saved overrides yet — fine, just start with the base data
      }
      try {
        const meta = await window.storage.get("projection-overrides-meta", false);
        if (meta && meta.value) setLastRefreshed(JSON.parse(meta.value).lastRefreshed || null);
      } catch (e) {
        // no metadata yet
      }
    })();
  }, []);

  function applyOverride(player) {
    const ov = projectionOverrides[player.id];
    if (!ov) return player;
    return {
      ...player,
      proj: ov.proj != null ? ov.proj : player.proj,
      status: ov.status || player.status,
    };
  }

  const effectivePlayers = useMemo(() => PLAYERS.map(applyOverride), [projectionOverrides]);
  const effectiveLeagueTeams = useMemo(
    () => LEAGUE_TEAMS.map((t) => ({ ...t, roster: t.roster.map(applyOverride) })),
    [projectionOverrides]
  );
  const effectiveAllLeaguePlayers = useMemo(
    () => effectiveLeagueTeams.flatMap((t) => t.roster.map((p) => ({ ...p, fantasyTeamId: t.id, fantasyTeamName: t.name }))),
    [effectiveLeagueTeams]
  );
  const effectiveMyTeamPlayers = useMemo(() => MY_TEAM_PLAYERS.map(applyOverride), [projectionOverrides]);

  // Every player actually on a roster anywhere — your team, and all 11 opponents —
  // deduped by name. Only used by the AI-search fallback path below (the direct
  // ESPN path doesn't need names — it matches by id).
  function getAllRosteredPlayerNames() {
    const names = new Set();
    PLAYERS.forEach((p) => names.add(p.name));
    ALL_LEAGUE_PLAYERS.forEach((p) => names.add(p.name));
    return Array.from(names);
  }

  // Primary path: pull real Week-N projections (and current injury status) directly
  // from ESPN for every ROSTERED player across all 12 teams in one request. This is
  // ESPN's own number, not a web-search estimate, so it's exactly as accurate as the
  // initial live pull that built this roster in the first place.
  async function fetchEspnRosteredProjections() {
    const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam&view=mStatus`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
    const data = await res.json();
    const period = data.scoringPeriodId;
    const fresh = {};
    (data.teams || []).forEach((t) => {
      (t.roster?.entries || []).forEach((e) => {
        const player = e.playerPoolEntry?.player;
        if (!player) return;
        const proj = extractEspnProjection(player.stats, period);
        if (proj != null) {
          fresh[player.id] = { proj, status: ESPN_INJURY_LABEL_MAP[player.injuryStatus] || player.injuryStatus || "Healthy" };
        }
      });
    });
    return { fresh, period, count: Object.keys(fresh).length };
  }

  // Same idea, but for the free-agent pool (the Free Agents tab) — a separate ESPN
  // endpoint, since /players (not team rosters) is where unrostered players live.
  async function fetchEspnFreeAgentProjections(period) {
    const filter = {
      players: {
        limit: 300,
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    };
    const res = await fetch(`${ESPN_LEAGUE_BASE_URL}/players?view=kona_player_info`, {
      headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
    });
    if (!res.ok) throw new Error(`ESPN free-agent request failed (${res.status})`);
    const data = await res.json();
    const fresh = {};
    (Array.isArray(data) ? data : []).forEach((entry) => {
      const player = entry.player || entry;
      if (!player) return;
      const proj = extractEspnProjection(player.stats, period);
      if (proj != null) {
        fresh[player.id] = { proj, status: ESPN_INJURY_LABEL_MAP[player.injuryStatus] || player.injuryStatus || "Healthy" };
      }
    });
    return fresh;
  }

  // Fallback path only: used if ESPN's API ever stops answering directly from the
  // browser (CORS policy change, endpoint move, etc.) — same web-search approach
  // this refresh used before, kept so the button degrades gracefully instead of
  // just breaking outright. Estimates, not ESPN's own numbers, so it's a step down
  // in accuracy versus the primary path above.
  async function fetchProjectionsForBatch(names) {
    const prompt =
      'For each of the following NFL players, search the web and find their current fantasy football point projection for the upcoming or current week, using full-PPR scoring (1 point per reception, standard yardage and touchdown scoring, e.g. FantasyPros-style consensus). If a specific player has no notable current projection (e.g. deep bench, practice squad), give your best reasonable estimate based on their depth-chart role rather than skipping them. Players to look up:\n' +
      names.join(", ") +
      '\n\nRespond with ONLY a raw JSON array — no markdown code fences, no explanation, no text before or after. Each entry must look like: {"name": "Full Player Name", "proj": 12.3}. Use the exact player names given above, unmodified, as the "name" field so they can be matched back.';

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();

    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Couldn't find projection data in the response");
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) throw new Error("Unexpected response format");
    return parsed;
  }

  async function refreshViaAiSearchFallback() {
    const allNames = getAllRosteredPlayerNames();
    const BATCH_SIZE = 20;
    const batches = [];
    for (let i = 0; i < allNames.length; i += BATCH_SIZE) batches.push(allNames.slice(i, i + BATCH_SIZE));

    setRefreshProgress({ done: 0, total: batches.length });
    const byName = {};
    let anySucceeded = false;
    let lastErr = null;

    for (let i = 0; i < batches.length; i++) {
      try {
        const parsed = await fetchProjectionsForBatch(batches[i]);
        parsed.forEach((entry) => {
          if (entry && typeof entry.name === "string" && typeof entry.proj === "number") {
            byName[entry.name] = entry.proj;
          }
        });
        anySucceeded = true;
      } catch (err) {
        lastErr = err;
      }
      setRefreshProgress({ done: i + 1, total: batches.length });
    }

    if (!anySucceeded) throw lastErr || new Error("Refresh failed — try again in a moment.");

    // Fallback data is name-keyed (web search doesn't know ESPN ids) — translate
    // back to id-keyed overrides by matching against every known player's name.
    const fresh = {};
    [...PLAYERS, ...ALL_LEAGUE_PLAYERS].forEach((p) => {
      if (byName[p.name] != null) fresh[p.id] = { proj: byName[p.name] };
    });
    return { fresh, partial: !!lastErr, matchedNames: Object.keys(byName).length, totalNames: allNames.length };
  }

  async function refreshProjections() {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshProgress({ done: 0, total: 2 });

    let fresh = {};
    let usedFallback = false;

    try {
      const rostered = await fetchEspnRosteredProjections();
      fresh = { ...fresh, ...rostered.fresh };
      setRefreshProgress({ done: 1, total: 2 });

      try {
        const freeAgents = await fetchEspnFreeAgentProjections(rostered.period);
        fresh = { ...fresh, ...freeAgents };
      } catch (faErr) {
        // Free-agent refresh failing shouldn't block the more important rostered-player update.
      }
      setRefreshProgress({ done: 2, total: 2 });
    } catch (espnErr) {
      // Direct ESPN path failed entirely (CORS/network/etc.) — fall back to AI search.
      usedFallback = true;
      try {
        const result = await refreshViaAiSearchFallback();
        fresh = result.fresh;
        if (result.partial) {
          setRefreshError(`ESPN's API wasn't reachable, so this used web-search estimates instead — matched ${result.matchedNames}/${result.totalNames} players.`);
        }
      } catch (fallbackErr) {
        setRefreshing(false);
        setRefreshProgress(null);
        setRefreshError(fallbackErr.message || "Refresh failed — try again in a moment.");
        return;
      }
    }

    const merged = { ...projectionOverrides, ...fresh };
    setProjectionOverrides(merged);
    const nowIso = new Date().toISOString();
    setLastRefreshed(nowIso);
    try {
      await window.storage.set("projection-overrides", JSON.stringify(merged), false);
      await window.storage.set(
        "projection-overrides-meta",
        JSON.stringify({ lastRefreshed: nowIso, count: Object.keys(fresh).length, source: usedFallback ? "web-search" : "espn" }),
        false
      );
    } catch (storageErr) {
      console.error("Couldn't save refreshed projections", storageErr);
    }
    if (!usedFallback && Object.keys(fresh).length === 0) {
      setRefreshError("ESPN returned no projection data — try again in a moment.");
    }

    setRefreshing(false);
    setRefreshProgress(null);
  }

  const usedIds = useMemo(() => {
    const s = new Set(Object.values(roster).filter(Boolean));
    bench.forEach((id) => s.add(id));
    return s;
  }, [roster, bench]);

  const availablePlayers = useMemo(() => {
    return effectivePlayers.filter((p) => !usedIds.has(p.id))
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [usedIds, posFilter, search, effectivePlayers]);

  function playerById(id) {
    return effectivePlayers.find((p) => p.id === id) || effectiveAllLeaguePlayers.find((p) => p.id === id);
  }

  // Whether a player is a locked-in starter on WHICHEVER team currently rosters
  // them — your own team if it's one of your players (no fantasyTeamId), or the
  // specific opponent's team if it's a league player (tagged via ALL_LEAGUE_PLAYERS).
  // Needed so the manual Trade Analyzer prices starters the same way the AI Coach's
  // auto-generated suggestions do, instead of treating every player as bench-only.
  function isStartingForOwner(p) {
    if (p.fantasyTeamId == null) return isPlayerStarter(p, myNeeds);
    const theirTeam = effectiveLeagueTeams.find((t) => t.id === p.fantasyTeamId);
    if (!theirTeam) return false;
    return isPlayerStarter(p, analyzeRosterNeeds(theirTeam.roster));
  }

  // ---------- AI Coach: your current needs + generated trade suggestions ----------
  const myPlayers = useMemo(() => Array.from(usedIds).map(playerById).filter(Boolean), [usedIds]);

  // League baseline = the average starter quality score at each position across
  // every team in the league (all 11 opponents + you), so "need" and "strength"
  // are judged relative to what a typical starter actually looks like this season.
  const leagueBaseline = useMemo(() => {
    const baseline = {};
    const allRosters = [...effectiveLeagueTeams.map((t) => t.roster), myPlayers];
    POSITIONS.forEach((pos) => {
      const scores = allRosters.map((roster) => analyzeRosterNeeds(roster)[pos].starterScore).filter((s) => s > 0);
      baseline[pos] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    });
    return baseline;
  }, [myPlayers, effectiveLeagueTeams]);

  const myNeeds = useMemo(() => analyzeRosterNeeds(myPlayers), [myPlayers]);

  // A position is a "need" if you're missing a starter outright, or your starter
  // quality score sits meaningfully (15%+) below the league-average starter there —
  // this catches a Tier-3, banged-up starter that a raw headcount would've missed.
  const needyPositions = useMemo(() => {
    return POSITIONS.filter((pos) => {
      const n = myNeeds[pos];
      if (!n.hasEnoughBodies) return true;
      if (!leagueBaseline[pos]) return false;
      return n.starterScore < leagueBaseline[pos] * 0.85;
    });
  }, [myNeeds, leagueBaseline]);

  // A position is a "strength" you can trade from if your starter score is well
  // above league average AND you actually have quality bench depth sitting behind
  // those starters (not just extra bodies).
  const strengthPositions = useMemo(
    () =>
      POSITIONS.filter((pos) => {
        const n = myNeeds[pos];
        if (!leagueBaseline[pos]) return false;
        return n.starterScore > leagueBaseline[pos] * 1.1 && n.tradeableDepth.length > 0;
      }),
    [myNeeds, leagueBaseline]
  );

  // ---------- Free Agents tab: players on no roster, recommended against your needs ----------
  const [faPosFilter, setFaPosFilter] = useState("ALL");
  const [faSearch, setFaSearch] = useState("");

  // Every player who isn't rostered by you or anyone else in the league, i.e. a
  // genuine add candidate — unfiltered, so recommendations always see the full pool
  // regardless of whatever the browse list below is currently filtered/searched to.
  const freeAgentPool = useMemo(
    () => effectivePlayers.filter((p) => !usedIds.has(p.id)),
    [effectivePlayers, usedIds]
  );

  // Needy positions ranked worst-relative-to-league-average first, so the top of the
  // recommendations panel is always your single biggest hole, not just QB-first order.
  const needyPositionsRanked = useMemo(() => {
    return [...needyPositions].sort((a, b) => {
      const relA = leagueBaseline[a] ? myNeeds[a].starterScore / leagueBaseline[a] : 0;
      const relB = leagueBaseline[b] ? myNeeds[b].starterScore / leagueBaseline[b] : 0;
      return relA - relB;
    });
  }, [needyPositions, myNeeds, leagueBaseline]);

  function needReason(pos) {
    const n = myNeeds[pos];
    if (!n.hasEnoughBodies) {
      return `You don't have enough ${pos}s to fill your required starting slot${REQUIRED_STARTERS[pos] > 1 ? "s" : ""}.`;
    }
    const base = leagueBaseline[pos];
    if (base) {
      const pctBelow = Math.round((1 - n.starterScore / base) * 100);
      return `Your starting ${pos} production is ~${Math.max(pctBelow, 1)}% below the league-average starter there.`;
    }
    return `${pos} is a relative weak spot on your roster.`;
  }

  // Top 3 available free agents at each needy position, best qualityScore first —
  // qualityScore already folds in tier and current injury status, not just raw proj.
  const recommendedPickups = useMemo(() => {
    return needyPositionsRanked.map((pos) => ({
      pos,
      reason: needReason(pos),
      candidates: freeAgentPool
        .filter((p) => p.pos === pos)
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .sort((a, b) => b.qScore - a.qScore)
        .slice(0, 3),
    })).filter((group) => group.candidates.length > 0);
  }, [needyPositionsRanked, freeAgentPool, myNeeds, leagueBaseline]);

  // Fallback when nothing qualifies as a "need": just surface the best overall
  // available players so the tab is never empty.
  const bestAvailableOverall = useMemo(
    () => [...freeAgentPool].map((p) => ({ ...p, qScore: qualityScore(p) })).sort((a, b) => b.qScore - a.qScore).slice(0, 6),
    [freeAgentPool]
  );

  const browsableFreeAgents = useMemo(() => {
    return freeAgentPool
      .filter((p) => (faPosFilter === "ALL" ? true : p.pos === faPosFilter))
      .filter((p) => p.name.toLowerCase().includes(faSearch.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [freeAgentPool, faPosFilter, faSearch]);


  // Fairness band for every suggestion: net value (what you get minus what you
  // give) must land between -1.5 (you can give up a little) and +3 (favors you,
  // but not absurdly). If a single-for-single swap doesn't fit, the engine will
  // try adding a small second piece to either side to land inside the band —
  // real trades are often 2-for-1 or 1-for-2, not just 1-for-1.
  const TRADE_BAND_MIN = -1.5;
  const TRADE_BAND_MAX = 3;

  // Consolidating several players into one (or vice versa) isn't just "add up the
  // points" — whichever side ends up sending MORE pieces is trading quantity for a
  // scarcer, harder-to-replicate asset, and real managers demand a real premium for
  // that, not just rough point parity. Without this, "two average players roughly
  // equal one superstar's point total" reads as a fair trade, which it isn't — no
  // one gives up a true difference-maker for role players just because the raw
  // totals happen to be close. Each extra piece on one side shifts the required
  // band that many points against the side sending more pieces.
  const CONSOLIDATION_PENALTY_PER_EXTRA_PIECE = 5;
  function consolidationPenalty(giveCount, getCount) {
    return Math.abs(giveCount - getCount) * CONSOLIDATION_PENALTY_PER_EXTRA_PIECE;
  }
  // diff = getVal - giveVal, from the give-side's perspective. Shifts the required
  // band by the penalty, in whichever direction disadvantages the side sending more
  // pieces (they need a bigger positive diff to justify consolidating into fewer,
  // bigger assets; the side sending fewer, bigger pieces has its ceiling tightened
  // so it can't be "gifted" a stack of throw-ins too cheaply either).
  function withinBand(diff, giveCount, getCount) {
    const penalty = consolidationPenalty(giveCount, getCount);
    if (giveCount > getCount) return diff >= TRADE_BAND_MIN + penalty && diff <= TRADE_BAND_MAX + penalty;
    if (getCount > giveCount) return diff >= TRADE_BAND_MIN - penalty && diff <= TRADE_BAND_MAX - penalty;
    return diff >= TRADE_BAND_MIN && diff <= TRADE_BAND_MAX;
  }

  // Given a starting give/get package that's outside the band, try adding ONE
  // extra piece to whichever side is short, choosing the smallest piece that
  // brings the net value back inside the band. Returns null if no fix exists.
  function balancePackage(giveList, getList, giveVal, getVal, extraGiveOptions, extraGetOptions) {
    let diff = getVal - giveVal;
    if (withinBand(diff, giveList.length, getList.length)) {
      return { give: giveList, get: getList, giveVal, getVal, diff };
    }
    if (diff > TRADE_BAND_MAX && extraGiveOptions.length) {
      // You're getting too much for too little — add a throw-in from your side.
      // This makes it (at least) a 2-for-1 from your side, so check the
      // consolidation-adjusted band, not the base band.
      let bestAdd = null;
      extraGiveOptions.forEach((p) => {
        const newDiff = getVal - (giveVal + playerValue(p));
        if (withinBand(newDiff, giveList.length + 1, getList.length) && (!bestAdd || playerValue(p) < playerValue(bestAdd))) {
          bestAdd = p;
        }
      });
      if (bestAdd) {
        const newGiveVal = giveVal + playerValue(bestAdd);
        return { give: [...giveList, bestAdd], get: getList, giveVal: newGiveVal, getVal, diff: getVal - newGiveVal };
      }
    }
    if (diff < TRADE_BAND_MIN && extraGetOptions.length) {
      // You're giving up too much for too little — add a small piece from their side.
      let bestAdd = null;
      extraGetOptions.forEach((p) => {
        const newDiff = getVal + playerValue(p) - giveVal;
        if (withinBand(newDiff, giveList.length, getList.length + 1) && (!bestAdd || playerValue(p) < playerValue(bestAdd))) {
          bestAdd = p;
        }
      });
      if (bestAdd) {
        const newGetVal = getVal + playerValue(bestAdd);
        return { give: giveList, get: [...getList, bestAdd], giveVal, getVal: newGetVal, diff: newGetVal - giveVal };
      }
    }
    return null;
  }

  // Need-based suggestions: your real weakness matched to their real weakness.
  const needBasedSuggestions = useMemo(() => {
    const found = [];
    needyPositions.forEach((needPos) => {
      const myWeak = myNeeds[needPos].weakestStarter;
      const myWeakQ = myWeak ? myWeak.qScore : 0;
      // Candidates ranked by quality score (value + tier − injury discount), not raw proj,
      // so an injured "star" doesn't outrank a healthy, reliable upgrade.
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.pos === needPos && p.status !== "Out")
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => p.qScore > myWeakQ + 1.5)
        .sort((a, b) => b.qScore - a.qScore)
        .slice(0, 10);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        // Find one of your strength positions where they're genuinely light —
        // same quality-based test as your own needyPositions calc, just mirrored.
        const overlapPos = strengthPositions.find((sp) => {
          const tn = theirNeeds[sp];
          if (!tn.hasEnoughBodies) return true;
          if (!leagueBaseline[sp]) return false;
          return tn.starterScore < leagueBaseline[sp] * 0.85;
        });
        if (!overlapPos) return;
        // Starter-adjusted value: a locked-in starter is worth more than his raw
        // proj alone, so two bench throw-ins can't casually "add up" to a starter.
        const candVal = starterAdjustedValue(cand, isPlayerStarter(cand, theirNeeds));
        const depthOptions = myNeeds[overlapPos].tradeableDepth; // bench-only by construction
        if (!depthOptions.length) return;
        // Start with whichever single tradeable piece is closest in value to what
        // you'd receive, then let balancePackage add a second piece if needed.
        const offerPlayer = depthOptions.reduce((best, p) =>
          Math.abs(playerValue(p) - candVal) < Math.abs(playerValue(best) - candVal) ? p : best
        );
        const offerVal = playerValue(offerPlayer); // bench piece, no starter premium
        // If the core 1-for-1 match isn't even in the same neighborhood, no
        // realistic throw-in fixes that — skip rather than paper over it.
        if (Math.abs(candVal - offerVal) > 12) return;

        // Throw-ins on both sides must themselves be bench-caliber (tradeableDepth),
        // never another starter — a team doesn't sweeten a deal with a starter.
        const extraGiveOptions = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], offerVal, candVal, extraGiveOptions, extraGetOptions);
        if (!result) return;

        found.push({
          id: `${theirTeam.id}-${result.get.map((p) => p.id).join(",")}-${result.give.map((p) => p.id).join(",")}`,
          teamId: theirTeam.id,
          teamName: theirTeam.name,
          give: result.give,
          get: result.get,
          needPos,
          overlapPos,
          giveVal: result.giveVal,
          getVal: result.getVal,
          upgrade: cand.qScore - myWeakQ,
          reason: "need",
        });
      });
    });

    const seen = new Set();
    const deduped = [];
    found
      .sort((a, b) => b.upgrade - a.upgrade)
      .forEach((s) => {
        const key = `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(s);
      });
    return deduped;
  }, [needyPositions, strengthPositions, myNeeds, leagueBaseline, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  // General value-based suggestions: run regardless of whether you have a clear
  // need, so there's always something reasonable on the table. Looks for trades
  // where you'd give up a player who isn't your top guy at his position, in
  // exchange for a genuine quality upgrade somewhere on your roster, at a price
  // that's fair (within the same -1.5 to +3 band, using a second piece on
  // either side if needed to get there).
  const generalSuggestions = useMemo(() => {
    const found = [];
    // Anything beyond your single best player at each position is "movable" —
    // more permissive than tradeableDepth, since this isn't need-driven.
    const movable = [];
    POSITIONS.forEach((pos) => {
      const ps = myNeeds[pos].players;
      ps.slice(1).forEach((p) => {
        if (p.status !== "Out") movable.push(p);
      });
    });

    movable.forEach((offerPlayer) => {
      const offerIsStarter = isPlayerStarter(offerPlayer, myNeeds);
      const offerVal = starterAdjustedValue(offerPlayer, offerIsStarter);
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.status !== "Out" && p.fantasyTeamId)
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => {
          const myWorstAtPos = myNeeds[p.pos] ? myNeeds[p.pos].weakestStarter : null;
          const myWorstQ = myWorstAtPos ? myWorstAtPos.qScore : -Infinity;
          return p.qScore > myWorstQ + 1; // must actually be an upgrade somewhere on your roster
        })
        .sort((a, b) => playerValue(b) - playerValue(a))
        .slice(0, 6);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        // Starter-adjusted value on both anchors — a starter-for-starter or
        // bench-for-bench trade is realistic; two bench guys quietly outvaluing
        // a starter on paper is not.
        const candVal = starterAdjustedValue(cand, isPlayerStarter(cand, theirNeeds));
        if (Math.abs(candVal - offerVal) > 12) return;

        // Throw-ins must be genuine bench pieces on both sides, never a starter.
        const extraGiveOptions = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], offerVal, candVal, extraGiveOptions, extraGetOptions);
        if (!result) return;

        found.push({
          id: `gen-${theirTeam.id}-${result.get.map((p) => p.id).join(",")}-${result.give.map((p) => p.id).join(",")}`,
          teamId: theirTeam.id,
          teamName: theirTeam.name,
          give: result.give,
          get: result.get,
          needPos: cand.pos,
          overlapPos: offerPlayer.pos,
          giveVal: result.giveVal,
          getVal: result.getVal,
          upgrade: result.getVal - result.giveVal,
          reason: "value",
        });
      });
    });

    const seen = new Set();
    const deduped = [];
    found
      .sort((a, b) => b.upgrade - a.upgrade)
      .forEach((s) => {
        const key = `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(s);
      });
    return deduped;
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  // Guaranteed tier: even when nothing clears the "real upgrade" or "real need"
  // bar, the AI Coach should always have something reasonable on the table.
  // These are simple, fair, same-position swaps — not necessarily upgrades —
  // found by matching your bench/depth player against the closest-value player
  // at that position anywhere else in the league. Wider band than the primary
  // tiers (still roughly even, just not as strict), since these are a baseline
  // safety net rather than a recommendation to actually pull the trigger.
  const fallbackSuggestions = useMemo(() => {
    const found = [];
    POSITIONS.forEach((pos) => {
      const myPlayersAtPos = myNeeds[pos].players;
      if (!myPlayersAtPos.length) return;
      // Prefer your weakest rostered player here so you're not "giving up" your best.
      const candidateGive = myPlayersAtPos[myPlayersAtPos.length - 1];
      if (candidateGive.status === "Out") return;
      const giveVal = playerValue(candidateGive);
      const pool = effectiveAllLeaguePlayers.filter((p) => p.pos === pos && p.status !== "Out" && p.id !== candidateGive.id);
      if (!pool.length) return;
      const closest = pool.reduce((best, p) => (Math.abs(playerValue(p) - giveVal) < Math.abs(playerValue(best) - giveVal) ? p : best));
      const theirTeam = effectiveLeagueTeams.find((t) => t.id === closest.fantasyTeamId);
      if (!theirTeam) return;
      const diff = playerValue(closest) - giveVal;
      if (diff < -3 || diff > 3) return;
      found.push({
        id: `fallback-${theirTeam.id}-${closest.id}-${candidateGive.id}`,
        teamId: theirTeam.id,
        teamName: theirTeam.name,
        give: [candidateGive],
        get: [closest],
        needPos: pos,
        overlapPos: pos,
        giveVal,
        getVal: playerValue(closest),
        upgrade: diff,
        reason: "fallback",
      });
    });
    return found.sort((a, b) => b.upgrade - a.upgrade);
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  const coachSuggestions = useMemo(() => {
    // Combine and dedupe across both sources first.
    const all = [...needBasedSuggestions, ...generalSuggestions];
    const seen = new Set();
    const deduped = [];
    all.forEach((s) => {
      const key = `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(s);
    });

    // Split by package shape so we can guarantee a mix rather than letting
    // whichever shape happens to rank higher crowd out the other.
    const priority = (s) => (s.reason === "need" ? 1 : 0);
    const oneForOne = deduped
      .filter((s) => s.give.length === 1 && s.get.length === 1)
      .sort((a, b) => priority(b) - priority(a) || b.upgrade - a.upgrade);
    const multiPlayer = deduped
      .filter((s) => s.give.length > 1 || s.get.length > 1)
      .sort((a, b) => priority(b) - priority(a) || b.upgrade - a.upgrade);

    // Interleave: 1-for-1, 2-for-1, 1-for-1, 2-for-1... so both shapes always
    // show up together rather than one type dominating the list.
    const combined = [];
    const maxLen = Math.max(oneForOne.length, multiPlayer.length);
    for (let i = 0; i < maxLen && combined.length < 6; i++) {
      if (oneForOne[i]) combined.push(oneForOne[i]);
      if (combined.length < 6 && multiPlayer[i]) combined.push(multiPlayer[i]);
    }

    // Guarantee: if the primary tiers came up short, pad with fair fallback
    // swaps so the AI Coach never comes up empty.
    if (combined.length < 4) {
      const usedKeys = new Set(combined.map((s) => `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`));
      fallbackSuggestions.forEach((s) => {
        if (combined.length >= 6) return;
        const key = `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
        if (usedKeys.has(key)) return;
        usedKeys.add(key);
        combined.push(s);
      });
    }

    return combined;
  }, [needBasedSuggestions, generalSuggestions, fallbackSuggestions]);

  function proposeCoachTrade(s) {
    setTradeOpponentId(s.teamId);
    setTradeGive(s.give.map((p) => p.id));
    setTradeGet(s.get.map((p) => p.id));
    setTab("trade");
  }

  function locateSlot(id) {
    const found = Object.entries(roster).find(([, pid]) => pid === id);
    return found ? found[0] : null;
  }

  // Moves a player into a starting slot. If that slot is already occupied, the
  // occupant is swapped out — sent back to the incoming player's old slot if
  // they're eligible there, otherwise sent to the bench. This is what makes
  // bench <-> lineup swaps actually swap instead of silently dropping someone.
  function moveToSlot(targetSlot, player) {
    if (!SLOT_ELIGIBILITY[targetSlot].includes(player.pos)) return;
    const occupantId = roster[targetSlot];
    if (occupantId === player.id) return;

    const sourceSlot = locateSlot(player.id);
    const occupant = occupantId ? playerById(occupantId) : null;
    const occupantGoesToSlot = occupant && sourceSlot && SLOT_ELIGIBILITY[sourceSlot].includes(occupant.pos);

    setRoster((r) => {
      const copy = { ...r };
      if (sourceSlot) delete copy[sourceSlot];
      delete copy[targetSlot];
      if (occupantGoesToSlot) copy[sourceSlot] = occupantId;
      copy[targetSlot] = player.id;
      return copy;
    });

    setBench((b) => {
      let next = b.filter((id) => id !== player.id);
      if (occupant && !occupantGoesToSlot && !next.includes(occupantId)) next = [...next, occupantId];
      return next;
    });
  }

  // Moves a player to the bench, clearing whatever starting slot they were in.
  function moveToBench(player) {
    if (bench.includes(player.id)) return;
    const sourceSlot = locateSlot(player.id);
    if (sourceSlot) {
      setRoster((r) => {
        const copy = { ...r };
        delete copy[sourceSlot];
        return copy;
      });
    }
    setBench((b) => (b.includes(player.id) ? b : [...b, player.id]));
  }

  // Bench player -> starting lineup, one click: fills an empty eligible slot
  // if one exists, otherwise swaps into the eligible slot with the weakest
  // current starter.
  function quickStart(player) {
    const eligibleSlots = SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(player.pos));
    const emptySlot = eligibleSlots.find((s) => !roster[s]);
    if (emptySlot) {
      moveToSlot(emptySlot, player);
      return;
    }
    let worstSlot = null;
    let worstProj = Infinity;
    eligibleSlots.forEach((s) => {
      const occ = roster[s] ? playerById(roster[s]) : null;
      if (occ && occ.proj < worstProj) {
        worstProj = occ.proj;
        worstSlot = s;
      }
    });
    if (worstSlot) moveToSlot(worstSlot, player);
  }

  function addToSlot(slot, player) {
    if (!SLOT_ELIGIBILITY[slot].includes(player.pos)) return;
    setRoster((r) => ({ ...r, [slot]: player.id }));
  }

  function addToBench(player) {
    setBench((b) => [...b, player.id]);
  }

  function removeFromSlot(slot) {
    setRoster((r) => {
      const copy = { ...r };
      delete copy[slot];
      return copy;
    });
  }

  function removeFromBench(id) {
    setBench((b) => b.filter((x) => x !== id));
  }

  function handleDragStart(e, player) {
    e.preventDefault();
    draggingRef.current = player;
    setDragPlayer(player);
    setDragPos({ x: e.clientX, y: e.clientY });
  }

  function resolveDropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const target = el.closest("[data-drop-slot]");
    return target ? target.getAttribute("data-drop-slot") : null;
  }

  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      setDragOverTarget(resolveDropTarget(e.clientX, e.clientY));
    }
    function onUp(e) {
      const player = draggingRef.current;
      if (!player) return;
      const target = resolveDropTarget(e.clientX, e.clientY);
      if (target === "bench") {
        moveToBench(player);
      } else if (target && SLOTS.includes(target)) {
        moveToSlot(target, player);
      }
      draggingRef.current = null;
      setDragPlayer(null);
      setDragOverTarget(null);
    }
    if (dragPlayer) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragPlayer, usedIds, roster, bench]);

  function autoOptimize() {
    const chosen = new Set();
    const newRoster = {};
    const byProj = (pos) => effectivePlayers.filter((p) => p.pos === pos && p.status !== "Out").sort((a, b) => b.proj - a.proj);

    const qb = byProj("QB").find((p) => !chosen.has(p.id));
    if (qb) { newRoster.QB = qb.id; chosen.add(qb.id); }

    const rbs = byProj("RB").filter((p) => !chosen.has(p.id));
    if (rbs[0]) { newRoster.RB1 = rbs[0].id; chosen.add(rbs[0].id); }
    if (rbs[1]) { newRoster.RB2 = rbs[1].id; chosen.add(rbs[1].id); }

    const wrs = byProj("WR").filter((p) => !chosen.has(p.id));
    if (wrs[0]) { newRoster.WR1 = wrs[0].id; chosen.add(wrs[0].id); }
    if (wrs[1]) { newRoster.WR2 = wrs[1].id; chosen.add(wrs[1].id); }

    const te = byProj("TE").find((p) => !chosen.has(p.id));
    if (te) { newRoster.TE = te.id; chosen.add(te.id); }

    const flexPool = [...byProj("RB"), ...byProj("WR"), ...byProj("TE")]
      .filter((p) => !chosen.has(p.id)).sort((a, b) => b.proj - a.proj);
    if (flexPool[0]) { newRoster.FLEX = flexPool[0].id; chosen.add(flexPool[0].id); }

    const dst = byProj("DST").find((p) => !chosen.has(p.id));
    if (dst) { newRoster.DST = dst.id; chosen.add(dst.id); }

    const k = byProj("K").find((p) => !chosen.has(p.id));
    if (k) { newRoster.K = k.id; chosen.add(k.id); }

    const remainingBench = Array.from(chosen).length ? [] : [];
    setRoster(newRoster);
    setBench(Array.from(chosen).length ? bench.filter((id) => !chosen.has(id)) : bench);
  }

  const rosterTotal = useMemo(() => {
    return SLOTS.reduce((sum, slot) => {
      const p = roster[slot] ? playerById(roster[slot]) : null;
      return sum + (p ? p.proj : 0);
    }, 0);
  }, [roster]);

  // Same value functions the AI Coach's auto-generated suggestions use — a locked-in
  // starter is priced with the starter premium, not treated as equivalent to a bench
  // piece with the same raw projection, in both Week and Season modes. Exposed as a
  // standalone helper (not just folded into tradeValue) so the per-player rows in the
  // widget can display the exact number that feeds into the totals above them.
  function tradeValueOf(p) {
    const starting = isStartingForOwner(p);
    if (tradeHorizon === "season") {
      return rosValue(p) + (starting ? starterPremium(p.tier) : 0);
    }
    return starterAdjustedValue(p, starting);
  }
  function tradeValue(list) {
    return list.reduce((sum, id) => {
      const p = playerById(id);
      return p ? sum + tradeValueOf(p) : sum;
    }, 0);
  }

  const giveVal = tradeValue(tradeGive);
  const getVal = tradeValue(tradeGet);
  const diff = getVal - giveVal;
  const diffPct = (giveVal + getVal) > 0 ? (diff / ((giveVal + getVal) / 2)) * 100 : 0;

  function toggleTradeList(list, setList, id) {
    setList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const filledCount = SLOTS.filter((s) => roster[s]).length;

  return (
    <div className="min-h-screen bg-[#000000] text-[#FFFFFF]" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');
        .display-font { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
        .mono-font { font-family: 'JetBrains Mono', monospace; }
        * { scrollbar-width: thin; scrollbar-color: #38383A transparent; }
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-thumb { background: #38383A; border-radius: 8px; }
        *::-webkit-scrollbar-thumb:hover { background: #48484A; }
        button, input, select { transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease; }
        button:active { transform: scale(0.98); }
        :focus-visible { outline: 2px solid #C9A227; outline-offset: 2px; border-radius: 4px; }
        @media (prefers-reduced-motion: reduce) {
          button, input, select { transition: none; }
          button:active { transform: none; }
        }
      `}</style>

      {/* Header / scoreboard bar */}
      <div className="border-b border-[#C9A227]/25 bg-[#1C1C1E]/95 backdrop-blur sticky top-0 z-20 shadow-[0_2px_16px_rgba(0,0,0,0.25)]">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#C9A227] to-[#8a6f1b] flex items-center justify-center shrink-0 shadow-[0_0_0_1px_rgba(201,162,39,0.3)]">
              <Trophy size={19} className="text-[#000000]" />
            </div>
            <div className="min-w-0">
              <div className="display-font text-lg font-semibold leading-none truncate">GRIDIRON HQ</div>
              <div className="text-[11px] text-[#98989D] mono-font tracking-wide truncate">PPR · 1QB/2RB/2WR/1TE/1FLEX/1DST/1K</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={refreshProjections}
              disabled={refreshing}
              title="Fetch current projections and injury status directly from ESPN"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-[#38383A] text-[#98989D] hover:text-[#C9A227] hover:border-[#C9A227]/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">
                {refreshing ? (refreshProgress ? `Refreshing ${refreshProgress.done}/${refreshProgress.total}…` : "Refreshing…") : "Refresh from ESPN"}
              </span>
            </button>
            <div className="hidden sm:flex items-center gap-2.5 bg-[#000000] border border-[#38383A] rounded-full pl-4 pr-1.5 py-1.5">
              <span className="text-[11px] text-[#98989D] mono-font tracking-wide">STARTING LINEUP</span>
              <span className="mono-font text-base text-[#C9A227] font-semibold">{rosterTotal.toFixed(1)}</span>
              <span className="text-[10px] text-[#636366] mono-font pr-1.5">PTS</span>
            </div>
          </div>
        </div>
        {(lastRefreshed || refreshError || refreshProgress) && (
          <div className="max-w-6xl mx-auto px-4 pb-1.5 -mt-1">
            {refreshProgress ? (
              <span className="text-[11px] text-[#98989D]">Pulling current projections from ESPN — step {refreshProgress.done}/{refreshProgress.total}…</span>
            ) : refreshError ? (
              <span className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> {refreshError}</span>
            ) : (
              <span className="text-[11px] text-[#636366]">Projections last refreshed from ESPN {new Date(lastRefreshed).toLocaleString()}</span>
            )}
          </div>
        )}
        <nav className="max-w-6xl mx-auto px-3 pb-2 flex gap-1.5 overflow-x-auto">
          {[
            { id: "roster", label: "Build roster", icon: Users },
            { id: "freeagents", label: "Free agents", icon: UserPlus },
            { id: "lineup", label: "Lineup", icon: Shield },
            { id: "trade", label: "Trade analyzer", icon: Repeat },
            { id: "coach", label: "AI Coach", icon: Sparkles },
            { id: "league", label: "League", icon: Trophy },
            { id: "news", label: "News & injuries", icon: Newspaper },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                  active
                    ? "bg-[#C9A227]/15 text-[#C9A227] shadow-[inset_0_0_0_1px_rgba(201,162,39,0.4)]"
                    : "text-[#98989D] hover:text-[#FFFFFF] hover:bg-white/5"
                }`}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* ---------------- ROSTER BUILDER ---------------- */}
        {tab === "roster" && (
          <div className="grid lg:grid-cols-5 gap-6">
            <div className="lg:col-span-5 -mb-2 bg-[#C9A227]/10 border border-[#C9A227]/40 rounded-lg px-3 py-2.5 text-xs text-[#C9A227] flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Loaded from your real "Tush Pushers" roster (Ten Idiots League, ESPN #973201555), pulled live from ESPN.</span>
            </div>
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="display-font text-xl">Your roster</h2>
                <span className="text-xs mono-font text-[#98989D]">{filledCount}/10 starters · {bench.length} bench</span>
              </div>

              <div className="space-y-1.5">
                {SLOTS.map((slot) => {
                  const p = roster[slot] ? playerById(roster[slot]) : null;
                  const isDragOver = dragOverTarget === slot;
                  return (
                    <div
                      key={slot}
                      data-drop-slot={slot}
                      className={`flex items-center gap-2 border rounded-xl pl-2.5 pr-3 py-2 ${
                        isDragOver
                          ? "bg-[#C9A227]/15 border-[#C9A227] border-dashed"
                          : p
                          ? "bg-[#1C1C1E] border-[#38383A]"
                          : "bg-[#1C1C1E]/40 border-[#38383A]/60 border-dashed"
                      }`}
                    >
                      <div className="w-11 shrink-0 mono-font text-[11px] text-[#C9A227] font-semibold pointer-events-none">{slot}</div>
                      {p ? (
                        <div className="flex-1 flex items-center justify-between min-w-0 gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.name}</div>
                            <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                              <span className={`px-1.5 rounded border text-[10px] font-medium ${POS_COLORS[p.pos]}`}>{p.pos}</span>
                              <span>{p.team} · bye {p.bye}</span>
                              <span className="flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} />
                                <span className={statusColor(p.status)}>{p.status}</span>
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                            <button onClick={() => moveToBench(p)} aria-label={`Move ${p.name} to bench`} title="Move to bench" className="text-[#636366] hover:text-[#C9A227] hover:bg-[#C9A227]/10 rounded p-0.5">
                              <ArrowDownToLine size={14} />
                            </button>
                            <button onClick={() => removeFromSlot(slot)} aria-label={`Remove ${p.name}`} className="text-[#636366] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5">
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 text-sm text-[#636366] italic">Drag a {SLOT_ELIGIBILITY[slot].join("/")} here</div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2">
                <div className="text-xs text-[#98989D] mb-1.5 mono-font">BENCH</div>
                <div
                  data-drop-slot="bench"
                  className={`space-y-1.5 rounded-lg p-1.5 border transition-colors ${
                    dragOverTarget === "bench" ? "bg-[#C9A227]/15 border-[#C9A227] border-dashed" : "border-transparent"
                  }`}
                >
                  {bench.map((id) => {
                    const p = playerById(id);
                    return (
                      <div
                        key={id}
                        onPointerDown={(e) => handleDragStart(e, p)}
                        className="flex items-center justify-between bg-[#1C1C1E]/60 border border-[#38383A]/60 rounded-lg px-3 py-1.5 cursor-grab active:cursor-grabbing touch-none"
                      >
                        <div className="text-sm pointer-events-none">{p.name} <span className={`ml-1 text-[10px] px-1.5 rounded border ${POS_COLORS[p.pos]}`}>{p.pos}</span></div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => quickStart(p)} aria-label={`Move ${p.name} to starting lineup`} title="Move to starting lineup" className="text-[#636366] hover:text-[#C9A227] hover:bg-[#C9A227]/10 rounded p-0.5">
                            <ArrowUpFromLine size={14} />
                          </button>
                          <button onClick={() => removeFromBench(id)} aria-label={`Remove ${p.name} from bench`} className="text-[#98989D] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5"><X size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                  {bench.length === 0 && <div className="text-sm text-[#636366] italic px-1.5 pointer-events-none">Drag players here for your bench</div>}
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="display-font text-xl">Player pool</h2>
                  <p className="text-xs text-[#98989D]">Drag a player onto a starting slot or the bench.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search players…"
                    className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-[#C9A227] placeholder:text-[#636366]"
                  />
                  <select
                    value={posFilter}
                    onChange={(e) => setPosFilter(e.target.value)}
                    className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]"
                  >
                    {["ALL", "QB", "RB", "WR", "TE", "DST", "K"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border border-[#38383A] rounded-xl overflow-hidden max-h-[560px] overflow-y-auto">
                {availablePlayers.map((p) => (
                  <div
                    key={p.id}
                    onPointerDown={(e) => handleDragStart(e, p)}
                    className="flex items-center justify-between px-3 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E] cursor-grab active:cursor-grabbing touch-none"
                  >
                    <div className="flex items-center gap-3 min-w-0 pointer-events-none">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold w-10 text-center shrink-0 ${POS_COLORS[p.pos]}`}>{p.pos}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                          <span>{p.team} · bye {p.bye}</span>
                          {p.status !== "Healthy" && (
                            <span className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} />
                              <span className={statusColor(p.status)}>{p.status}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                      <div className="flex gap-1">
                        {SLOT_ELIGIBILITY && SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(p.pos) && !roster[s]).slice(0, 1).map((s) => (
                          <button
                            key={s}
                            onClick={() => addToSlot(s, p)}
                            className="text-[11px] bg-[#C9A227] text-[#000000] font-semibold px-2 py-1 rounded-md hover:bg-[#e0b82e]"
                            title={`Add to ${s}`}
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          onClick={() => addToBench(p)}
                          className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
                          title="Add to bench"
                          aria-label={`Add ${p.name} to bench`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {availablePlayers.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-sm text-[#98989D]">No players match "{search || posFilter}"</div>
                    <button
                      onClick={() => { setSearch(""); setPosFilter("ALL"); }}
                      className="mt-2 text-xs text-[#C9A227] hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- FREE AGENTS ---------------- */}
        {tab === "freeagents" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Recommended pickups</h2>
              <p className="text-xs text-[#98989D]">
                Ranked against your actual roster needs vs. the league-average starter at each position — not just a raw projection list.
              </p>
            </div>

            {recommendedPickups.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-4">
                {recommendedPickups.map((group) => (
                  <div key={group.pos} className="border border-[#38383A] rounded-xl overflow-hidden">
                    <div className="px-3.5 py-2.5 bg-[#C9A227]/10 border-b border-[#C9A227]/30">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${POS_COLORS[group.pos]}`}>{group.pos}</span>
                        <span className="text-sm font-medium">Need at {group.pos}</span>
                      </div>
                      <div className="text-[11px] text-[#98989D] mt-1">{group.reason}</div>
                    </div>
                    <div>
                      {group.candidates.map((p) => (
                        <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.name}</div>
                            <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                              <span>{p.team} · bye {p.bye}</span>
                              {p.status !== "Healthy" && (
                                <span className="flex items-center gap-1">
                                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} />
                                  <span className={statusColor(p.status)}>{p.status}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                            <div className="flex gap-1">
                              {SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(p.pos) && !roster[s]).slice(0, 1).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => addToSlot(s, p)}
                                  className="text-[11px] bg-[#C9A227] text-[#000000] font-semibold px-2 py-1 rounded-md hover:bg-[#e0b82e]"
                                  title={`Add to ${s}`}
                                >
                                  {s}
                                </button>
                              ))}
                              <button
                                onClick={() => addToBench(p)}
                                className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
                                title="Add to bench"
                                aria-label={`Add ${p.name} to bench`}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-[#38383A] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[#1C1C1E] border-b border-[#38383A]">
                  <div className="text-sm font-medium">No glaring needs right now — here's the best available overall</div>
                  <div className="text-[11px] text-[#98989D] mt-0.5">Every starting position is at or above the league-average starter, so these are just the strongest free agents on the wire.</div>
                </div>
                {bestAvailableOverall.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold w-10 text-center shrink-0 ${POS_COLORS[p.pos]}`}>{p.pos}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-[#98989D]">{p.team} · bye {p.bye}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                      <button
                        onClick={() => addToBench(p)}
                        className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
                        title="Add to bench"
                        aria-label={`Add ${p.name} to bench`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h2 className="text-lg font-semibold mb-1">Browse all free agents</h2>
              <p className="text-xs text-[#98989D] mb-3">Every player currently on no roster in your league — {freeAgentPool.length} available.</p>
              <div className="flex items-center gap-2 mb-3">
                <input
                  value={faSearch}
                  onChange={(e) => setFaSearch(e.target.value)}
                  placeholder="Search players…"
                  className="flex-1 bg-[#1C1C1E] border border-[#38383A] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]/60"
                />
                <select
                  value={faPosFilter}
                  onChange={(e) => setFaPosFilter(e.target.value)}
                  className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]/60"
                >
                  {["ALL", ...POSITIONS].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="border border-[#38383A] rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
                {browsableFreeAgents.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold w-10 text-center shrink-0 ${POS_COLORS[p.pos]}`}>{p.pos}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                          <span>{p.team} · bye {p.bye}</span>
                          {p.status !== "Healthy" && (
                            <span className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} />
                              <span className={statusColor(p.status)}>{p.status}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                      <div className="flex gap-1">
                        {SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(p.pos) && !roster[s]).slice(0, 1).map((s) => (
                          <button
                            key={s}
                            onClick={() => addToSlot(s, p)}
                            className="text-[11px] bg-[#C9A227] text-[#000000] font-semibold px-2 py-1 rounded-md hover:bg-[#e0b82e]"
                            title={`Add to ${s}`}
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          onClick={() => addToBench(p)}
                          className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
                          title="Add to bench"
                          aria-label={`Add ${p.name} to bench`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {browsableFreeAgents.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-sm text-[#98989D]">No free agents match "{faSearch || faPosFilter}"</div>
                    <button
                      onClick={() => { setFaSearch(""); setFaPosFilter("ALL"); }}
                      className="mt-2 text-xs text-[#C9A227] hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- LINEUP OPTIMIZER ---------------- */}
        {tab === "lineup" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="display-font text-xl">Optimal starting lineup</h2>
                <p className="text-sm text-[#98989D]">Best available lineup by projected points, auto-benching anyone ruled Out.</p>
              </div>
              <button
                onClick={autoOptimize}
                className="flex items-center gap-2 bg-[#C9A227] text-[#000000] font-semibold px-4 py-2 rounded-lg hover:bg-[#e0b82e] text-sm"
              >
                <Activity size={15} /> Auto-optimize from full pool
              </button>
            </div>

            <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#38383A]">
                <span className="text-sm text-[#98989D]">Projected total</span>
                <span className="mono-font text-2xl text-[#C9A227] font-semibold">{rosterTotal.toFixed(1)} pts</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {SLOTS.map((slot) => {
                  const p = roster[slot] ? playerById(roster[slot]) : null;
                  return (
                    <div key={slot} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${p ? "bg-[#000000] border-[#38383A]/60" : "bg-[#000000]/40 border-[#38383A]/40 border-dashed"}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="mono-font text-[11px] text-[#C9A227] w-9 shrink-0">{slot}</span>
                        {p ? (
                          <>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ${POS_COLORS[p.pos]}`}>{p.pos}</span>
                            <div className="min-w-0">
                              <div className="text-sm truncate">{p.name}</div>
                              {p.status !== "Healthy" && (
                                <div className={`text-[11px] flex items-center gap-1 ${statusColor(p.status)}`}>
                                  <AlertTriangle size={10} /> {p.status}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-[#636366] italic">Empty</span>
                        )}
                      </div>
                      {p && <span className="mono-font text-sm text-[#C9A227] font-medium shrink-0">{p.proj}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-[#636366]">
              Note: "Auto-optimize" pulls the best players from the entire 2026 pool by projection — use it to see the theoretical ceiling, then build toward it from waivers and trades. It doesn't require your saved roster.
            </p>
          </div>
        )}

        {/* ---------------- TRADE ANALYZER ---------------- */}
        {tab === "trade" && (
          <div className="space-y-4">
            <h2 className="display-font text-xl">Trade analyzer</h2>
            <p className="text-sm text-[#98989D] max-w-2xl">
              Pick the players you'd send and receive. {tradeHorizon === "season"
                ? "Value estimates a 16-game rest-of-season total, adjusted for tier trajectory and current injury risk."
                : "Value blends this week's projection with tier (elite players carry a scarcity premium beyond raw points)."}
            </p>

            <div className="inline-flex bg-[#1C1C1E] border border-[#38383A] rounded-lg p-1">
              {[
                { id: "week", label: "This week" },
                { id: "season", label: "Rest of season" },
              ].map((h) => (
                <button
                  key={h.id}
                  onClick={() => setTradeHorizon(h.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md ${
                    tradeHorizon === h.id ? "bg-[#C9A227] text-[#000000]" : "text-[#98989D] hover:text-[#FFFFFF]"
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>

            <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
              <div className="text-sm font-medium mb-2.5">Who are you trading with?</div>
              <div className="flex flex-wrap gap-2">
                {effectiveLeagueTeams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTradeOpponentId(t.id); setTradeGet([]); }}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                      tradeOpponentId === t.id
                        ? "bg-[#C9A227] text-[#000000] border-[#C9A227]"
                        : "border-[#38383A] text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D]"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              {tradeOpponentId && (
                <div className="text-xs text-[#C9A227]/80 mt-2.5 flex items-center gap-1">
                  <ChevronRight size={12} /> "You receive" now pulls from {effectiveLeagueTeams.find((t) => t.id === tradeOpponentId)?.name}'s actual roster.
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {[
                { label: "You give up", list: tradeGive, setList: setTradeGive, val: giveVal, pool: effectivePlayers },
                {
                  label: tradeOpponentId ? `You receive (from ${effectiveLeagueTeams.find((t) => t.id === tradeOpponentId)?.name})` : "You receive",
                  list: tradeGet,
                  setList: setTradeGet,
                  val: getVal,
                  pool: tradeOpponentId ? effectiveLeagueTeams.find((t) => t.id === tradeOpponentId)?.roster || [] : effectiveAllLeaguePlayers,
                },
              ].map((side) => (
                <div key={side.label} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">{side.label}</h3>
                    <span className="mono-font text-[#C9A227]">{side.val.toFixed(1)} val</span>
                  </div>
                  <div className="space-y-1.5 mb-3 min-h-[40px]">
                    {side.list.map((id) => {
                      const p = playerById(id);
                      return (
                        <div key={id} className="flex items-center justify-between bg-[#000000] rounded-lg px-2.5 py-1.5">
                          <span className="text-sm">{p.name} <span className={`ml-1 text-[10px] px-1.5 rounded border ${POS_COLORS[p.pos]}`}>{p.pos}</span></span>
                          <div className="flex items-center gap-2">
                            <span className="mono-font text-xs text-[#C9A227]">{tradeValueOf(p).toFixed(1)}</span>
                            <button onClick={() => toggleTradeList(side.list, side.setList, id)} aria-label={`Remove ${p.name}`} className="text-[#98989D] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5">
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {side.list.length === 0 && (
                      <div className="text-xs text-[#636366] italic py-1">
                        {side.pool.length === 0 ? "Pick a team above to see their roster" : "No players selected yet"}
                      </div>
                    )}
                  </div>
                  <details className="text-sm group">
                    <summary className="cursor-pointer text-[#C9A227] hover:text-[#e0b82e] font-medium flex items-center gap-1 select-none">
                      <Plus size={14} className="group-open:rotate-45 transition-transform" /> Add a player
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto border border-[#38383A] rounded-lg">
                      {side.pool.filter((p) => !side.list.includes(p.id)).sort((a, b) => b.proj - a.proj).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => toggleTradeList(side.list, side.setList, p.id)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#000000] text-left border-b border-[#38383A]/50 last:border-0"
                        >
                          <span className="text-sm">{p.name} <span className="text-[11px] text-[#98989D]">({p.pos}{p.team ? `, ${p.team}` : ""})</span></span>
                          <span className="mono-font text-xs text-[#C9A227]">{tradeValueOf(p).toFixed(1)}</span>
                        </button>
                      ))}
                      {side.pool.filter((p) => !side.list.includes(p.id)).length === 0 && (
                        <div className="px-2.5 py-3 text-xs text-[#636366] text-center">No more players to add</div>
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>

            {(tradeGive.length > 0 || tradeGet.length > 0) && (
              <div className={`rounded-xl p-4 border ${
                diffPct > 8 ? "bg-emerald-500/10 border-emerald-500/30" : diffPct < -8 ? "bg-red-500/10 border-red-500/30" : "bg-[#1C1C1E] border-[#38383A]"
              }`}>
                <div className="flex items-center gap-3">
                  {diffPct > 8 ? <TrendingUp className="text-emerald-400 shrink-0" size={20} /> : diffPct < -8 ? <TrendingDown className="text-red-400 shrink-0" size={20} /> : <ChevronRight className="text-[#C9A227] shrink-0" size={20} />}
                  <div>
                    <div className="font-medium">
                      {diffPct > 8 ? "This trade favors you" : diffPct < -8 ? "This trade favors the other side" : "This trade is roughly even"}
                    </div>
                    <div className="text-sm text-[#98989D]">
                      Net value {diff > 0 ? "+" : ""}{diff.toFixed(1)} {tradeHorizon === "season" ? "rest-of-season pts" : "this week"} in your favor. {tradeGet.some((id) => playerById(id).status !== "Healthy") && "Heads up: someone you'd receive has an injury flag — factor that into the ask."}
                    </div>
                  </div>
                </div>
                {(giveVal > 0 || getVal > 0) && (
                  <div className="mt-3">
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-[#000000]">
                      <div
                        className="bg-[#98989D]/70 h-full"
                        style={{ width: `${(giveVal / (giveVal + getVal || 1)) * 100}%` }}
                      />
                      <div
                        className="bg-[#C9A227] h-full"
                        style={{ width: `${(getVal / (giveVal + getVal || 1)) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-[#98989D] mt-1 mono-font">
                      <span>You give {giveVal.toFixed(1)}</span>
                      <span>You get {getVal.toFixed(1)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------- AI COACH ---------------- */}
        {tab === "coach" && (
          <div className="space-y-5">
            <div>
              <h2 className="display-font text-xl flex items-center gap-2">
                <Sparkles size={18} className="text-[#C9A227]" /> AI Coach
              </h2>
              <p className="text-sm text-[#98989D] max-w-2xl mt-1">
                Scores each position by the quality of players there — projection, tier scarcity, and a discount for current injury status — compared against the league-average starter, not just how many bodies you have. Then it scans every other team's roster for a trade where their real need overlaps with your real surplus. Heuristic on your actual league data, not a live model call — a strong starting point, not gospel.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-[#98989D] mb-2">Position-by-position outlook</h3>
              <p className="text-xs text-[#636366] mb-3 max-w-2xl">
                Quality score = projection + tier premium, discounted for current injury status — not just headcount. Compared against the league-average starter at each position.
              </p>
              <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {POSITIONS.map((pos) => {
                  const n = myNeeds[pos];
                  const isNeed = needyPositions.includes(pos);
                  const isStrength = strengthPositions.includes(pos);
                  const baseline = leagueBaseline[pos] || 0;
                  const pctVsAvg = baseline ? ((n.starterScore - baseline) / baseline) * 100 : 0;
                  return (
                    <div
                      key={pos}
                      className={`rounded-xl border p-3 ${
                        isNeed ? "bg-red-500/10 border-red-500/30" : isStrength ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#1C1C1E] border-[#38383A]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${POS_COLORS[pos]}`}>{pos}</span>
                        {isNeed && <AlertTriangle size={13} className="text-red-400" />}
                        {isStrength && <TrendingUp size={13} className="text-emerald-400" />}
                      </div>
                      <div className="text-lg font-semibold mono-font mt-1.5">{n.starterScore.toFixed(1)}</div>
                      <div className={`text-[11px] ${isNeed ? "text-red-400" : isStrength ? "text-emerald-400" : "text-[#98989D]"}`}>
                        {baseline ? `${pctVsAvg > 0 ? "+" : ""}${pctVsAvg.toFixed(0)}% vs avg` : "—"}
                      </div>
                      <div className="text-[10px] text-[#636366] mt-0.5">
                        {isNeed ? "Needs help" : isStrength ? "Tradeable depth" : "Balanced"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-[#98989D] mb-2">Suggested trades</h3>
              <p className="text-xs text-[#636366] mb-3 max-w-2xl">
                Need-fill trades are prioritized when you have a real weakness; otherwise these are value trades worth considering even without one — you'll always see some options here. The list deliberately mixes straight player-for-player swaps with 2-for-1 packages. Value accounts for whether a player is a locked-in starter or a bench piece, not just projection, and every suggestion is kept within a -1.5 to +3 net-value band.
              </p>
              {coachSuggestions.length === 0 ? (
                <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6 text-center">
                  <div className="text-sm text-[#98989D]">
                    No reasonable trades found across the league right now — your roster's depth chart doesn't leave much to move. Try the Trade Analyzer directly to explore more options.
                  </div>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {coachSuggestions.map((s) => {
                    const diff = s.getVal - s.giveVal;
                    return (
                      <div key={s.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                s.reason === "need"
                                  ? "bg-red-500/15 text-red-300 border-red-500/30"
                                  : s.reason === "value"
                                  ? "bg-[#C9A227]/15 text-[#C9A227] border-[#C9A227]/30"
                                  : "bg-[#2C2C2E] text-[#98989D] border-[#38383A]"
                              }`}
                            >
                              {s.reason === "need" ? "Fills a need" : s.reason === "value" ? "Good value" : "Fair swap"}
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-[#2C2C2E] text-[#98989D] border-[#38383A]">
                              {s.give.length}-for-{s.get.length}
                            </span>
                          </div>
                          <span className="text-sm font-medium">{s.teamName}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="bg-[#000000] rounded-lg p-2.5">
                            <div className="text-[10px] text-[#98989D] mb-1">You give</div>
                            {s.give.map((p) => (
                              <div key={p.id} className="mb-1 last:mb-0">
                                <div className="text-sm font-medium">{p.name}</div>
                                <div className="text-[11px] text-[#98989D]">{p.pos} · {p.team}</div>
                              </div>
                            ))}
                          </div>
                          <div className="bg-[#000000] rounded-lg p-2.5">
                            <div className="text-[10px] text-[#98989D] mb-1">You get</div>
                            {s.get.map((p) => (
                              <div key={p.id} className="mb-1 last:mb-0">
                                <div className="text-sm font-medium">{p.name}</div>
                                <div className="text-[11px] text-[#98989D]">{p.pos} · {p.team}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="text-xs text-[#98989D] mb-3">
                          {s.reason === "need" ? (
                            <>Shores up your {s.needPos} (+{s.upgrade.toFixed(1)} quality-score upgrade — factoring proj, tier, and injury risk) by moving from your {s.overlapPos} depth, which {s.teamName} is genuinely light at.</>
                          ) : s.reason === "value" ? (
                            <>A roughly even-to-favorable value swap: upgrades your {s.needPos} spot by {s.upgrade.toFixed(1)} in value while moving a {s.overlapPos} piece that isn't your top guy there.</>
                          ) : (
                            <>A same-position, roughly even value swap with {s.teamName} — not necessarily an upgrade, but a fair baseline option worth having on the table.</>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs mono-font ${diff >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                            Net value {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                          </span>
                          <button
                            onClick={() => proposeCoachTrade(s)}
                            className="text-xs bg-[#C9A227] text-[#000000] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e0b82e] flex items-center gap-1"
                          >
                            <Repeat size={12} /> Open in analyzer
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------- LEAGUE (all 12 teams) ---------------- */}
        {tab === "league" && (
          <div className="space-y-4">
            <h2 className="display-font text-xl">Ten Idiots League — all 12 teams</h2>
            <p className="text-sm text-[#98989D] max-w-2xl">
              Real rosters pulled from your ESPN league (#973201555). Tap a team to see their full roster — handy for scouting trade targets before you head to the Trade Analyzer.
            </p>
            {!selectedLeagueTeam ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Your own team, shown first */}
                <button
                  onClick={() => setSelectedLeagueTeam({ id: "mine", name: "Tush Pushers (You)", owner: "Rahul Jariwala", roster: effectiveMyTeamPlayers.map((p) => ({ ...p, starter: Object.values(roster).includes(p.id), slot: Object.entries(roster).find(([, id]) => id === p.id)?.[0] })) })}
                  className="text-left bg-[#2C2C2E] border border-[#C9A227]/50 rounded-xl p-4 hover:border-[#C9A227] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[#C9A227]">Tush Pushers</div>
                    <Trophy size={16} className="text-[#C9A227]" />
                  </div>
                  <div className="text-xs text-[#98989D] mt-1">Rahul Jariwala (You)</div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                    <span className="text-xs text-[#98989D]">{effectiveMyTeamPlayers.length} players</span>
                    <ChevronRight size={14} className="text-[#C9A227]" />
                  </div>
                </button>
                {effectiveLeagueTeams.map((t) => {
                  const flagged = t.roster.filter((p) => p.status !== "Healthy").length;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedLeagueTeam(t)}
                      className="text-left bg-[#1C1C1E] border border-white/10 rounded-xl p-4 hover:border-[#C9A227]/60 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
                    >
                      <div className="font-semibold truncate">{t.name}</div>
                      <div className="text-xs text-[#98989D] mt-1 truncate">{t.owner}</div>
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                        <span className="text-xs text-[#98989D]">
                          {t.roster.length} players{flagged > 0 && <span className="text-amber-400"> · {flagged} flagged</span>}
                        </span>
                        <ChevronRight size={14} className="text-[#98989D]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setSelectedLeagueTeam(null)}
                  className="text-sm text-[#C9A227] hover:text-[#e0b82e] mb-3 flex items-center gap-1"
                >
                  <ChevronRight size={14} className="rotate-180" /> Back to all teams
                </button>
                <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-4 mb-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-lg">{selectedLeagueTeam.name}</div>
                    <div className="text-sm text-[#98989D]">{selectedLeagueTeam.owner}</div>
                  </div>
                  <div className="text-xs text-[#98989D] mono-font hidden sm:block">{selectedLeagueTeam.roster.length} players</div>
                </div>
                {(() => {
                  const starters = selectedLeagueTeam.roster.filter((p) => p.starter);
                  const bench = selectedLeagueTeam.roster.filter((p) => !p.starter && p.slot !== "IR");
                  const ir = selectedLeagueTeam.roster.filter((p) => p.slot === "IR");
                  const renderCard = (p) => (
                    <div key={p.id} className="flex items-center justify-between bg-[#2C2C2E] border border-white/10 rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 w-11 text-center ${POS_COLORS[p.pos]}`}>{p.slot || p.pos}</span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-[#98989D] text-xs">{p.team}{p.pos !== p.slot && p.slot ? ` · ${p.pos}` : ""}</div>
                        </div>
                      </div>
                      {p.status !== "Healthy" && (
                        <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0 ml-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} /> {p.status}
                        </span>
                      )}
                    </div>
                  );
                  return (
                    <div className="space-y-5">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
                          <Shield size={12} /> Starters ({starters.length})
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">{starters.map(renderCard)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
                          <Users size={12} /> Bench ({bench.length})
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">{bench.map(renderCard)}</div>
                      </div>
                      {ir.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
                            <AlertTriangle size={12} /> IR ({ir.length})
                          </div>
                          <div className="grid sm:grid-cols-2 gap-2">{ir.map(renderCard)}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {selectedLeagueTeam.id !== "mine" && (
                  <button
                    onClick={() => { setTradeOpponentId(selectedLeagueTeam.id); setTab("trade"); }}
                    className="mt-4 bg-[#C9A227] text-[#000000] font-semibold rounded-lg px-4 py-2 text-sm hover:bg-[#e0b82e] flex items-center gap-1.5"
                  >
                    <Repeat size={14} /> Propose a trade with this team
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------- NEWS & INJURIES ---------------- */}
        {tab === "news" && (
          <div className="space-y-4">
            <h2 className="display-font text-xl">News & injury feed</h2>
            <p className="text-sm text-[#98989D] max-w-2xl">
              Sample feed shown in the format a live source would use. This app has no internet access, so these entries are illustrative — connect a real feed (e.g. Sleeper or ESPN's API) to make this live.
            </p>
            <div className="space-y-2">
              {NEWS_FEED.map((n) => {
                const Icon = newsTypeIcon(n.type);
                return (
                  <div key={n.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-3.5 flex gap-3 hover:border-[#48484A]">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 ${newsTypeColor(n.type)}`}>
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium">{n.player}</span>
                          {n.team !== "—" && <span className="text-[#98989D]"> · {n.team}</span>}
                        </div>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${newsTypeColor(n.type)}`}>{n.type}</span>
                      </div>
                      <div className="text-sm text-[#E5E5EA] mt-0.5">{n.headline}</div>
                      <div className="text-[11px] text-[#636366] mt-1.5 mono-font">{n.time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {dragPlayer && (
        <div
          style={{ left: dragPos.x + 12, top: dragPos.y + 12 }}
          className="fixed z-50 pointer-events-none bg-[#C9A227] text-[#000000] text-sm font-semibold px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2"
        >
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${POS_COLORS[dragPlayer.pos]}`}>{dragPlayer.pos}</span>
          {dragPlayer.name}
        </div>
      )}
    </div>
  );
}
