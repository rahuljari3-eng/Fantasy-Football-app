/** A player's name, clickable to open his details (how his value is built,
 * recent scores, and any news). A dotted underline marks players the live
 * feed has news on. */
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
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={hasNews ? "Player details and news" : "Player details"}
      className={`block text-left bg-transparent border-0 p-0 m-0 font-inherit hover:underline underline-offset-2 ${
        hasNews ? "underline decoration-dotted decoration-[#636366]" : ""
      } ${className ?? ""}`}
    >
      {name}
    </button>
  );
}
