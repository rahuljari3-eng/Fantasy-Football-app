/** "N inactive players hidden · Show" line under a player list -- see
 * showInactivePlayers in hooks/useFantasyApp.ts. */
export function InactiveToggle({
  hiddenCount,
  showing,
  onToggle,
}: {
  hiddenCount: number;
  showing: boolean;
  onToggle: (show: boolean) => void;
}) {
  if (!showing && hiddenCount === 0) return null;
  return (
    <div className="text-[11px] text-[#636366] px-1">
      {showing ? "Showing everyone, including players with no projection. " : `${hiddenCount} players with no projection hidden. `}
      <button onClick={() => onToggle(!showing)} className="text-[#C9A227] hover:underline">
        {showing ? "Hide them" : "Show all"}
      </button>
    </div>
  );
}
