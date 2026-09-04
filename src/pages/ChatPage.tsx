import { MessageCircle } from "lucide-react";
import type { FantasyApp } from "../hooks/useFantasyApp";

/** Placeholder shell for the Roster Sensei chatbot tab. Agent wiring comes later. */
export function ChatPage(_props: { app: FantasyApp }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4">
      <div className="w-14 h-14 rounded-xl bg-[#C9A227]/15 border border-[#C9A227]/40 flex items-center justify-center mb-4">
        <MessageCircle size={26} className="text-[#C9A227]" />
      </div>
      <h2 className="display-font text-2xl mb-2">Chat with Roster Sensei</h2>
      <p className="text-sm text-[#98989D] max-w-md">
        Chatbot coming soon — ask anything fantasy, get answers grounded in your league.
      </p>
    </div>
  );
}
