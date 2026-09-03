import type { NewsItem } from "../types";

// Real injury/news feed, pulled live for players actually rostered across your
// league. Snapshot as of Aug 31, 2026 -- this is not a continuously
// auto-refreshing feed, so re-pull it periodically for the latest.
export const NEWS_FEED: NewsItem[] = [
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
