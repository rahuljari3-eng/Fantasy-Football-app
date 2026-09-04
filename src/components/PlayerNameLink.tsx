/** A player's name, rendered as a click-to-open-news button whenever the live
 * feed actually has something on them -- otherwise plain text, so rows don't
 * turn into dead-looking buttons for the many players with no current news. */
export function PlayerNameLink({
  name,
  hasNews,
  onOpen,
  className,
}: {
  name: string;
  hasNews: boolean;
  onOpen: () => void;
  className?: string;
}) {
  if (!hasNews) return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="View related news"
      className={`block text-left bg-transparent border-0 p-0 m-0 font-inherit hover:underline decoration-dotted underline-offset-2 ${className ?? ""}`}
    >
      {name}
    </button>
  );
}
