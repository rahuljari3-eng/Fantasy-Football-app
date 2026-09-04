import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, MessageCircle } from "lucide-react";
import type { FantasyApp } from "../hooks/useFantasyApp";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

const EXAMPLE_PROMPTS = [
  "Who should I start at flex this week?",
  "Is my RB room a need right now?",
  "What's a fair ask for my best WR?",
  "Any must-adds on the waiver wire?",
];

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Chat UI for Roster Sensei. Agent / tools wiring comes later — for now this
 * is the conversation shell (empty-state prompts + message thread + composer). */
export function ChatPage(_props: { app: FantasyApp }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatStarted = messages.length > 0;

  useEffect(() => {
    if (!chatStarted) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chatStarted]);

  function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content) return;

    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", content },
      {
        id: newId(),
        role: "assistant",
        content: "Roster Sensei is still stretching — the agent isn't wired up yet. Ask again once tools are live.",
      },
    ]);
    setDraft("");
    inputRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(draft);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9.5rem)] max-w-2xl mx-auto">
      {!chatStarted ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-2 pb-6">
          <div className="w-12 h-12 rounded-xl bg-[#C9A227]/15 border border-[#C9A227]/40 flex items-center justify-center mb-4">
            <MessageCircle size={22} className="text-[#C9A227]" />
          </div>
          <h2 className="display-font text-2xl mb-1.5">Roster Sensei</h2>
          <p className="text-sm text-[#98989D] max-w-sm mb-8">
            Ask about start/sit, waivers, trades, or your roster. Grounded in your league — once the agent is live.
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendMessage(prompt)}
                className="text-left text-sm px-3.5 py-2 rounded-full border border-[#38383A] bg-[#1C1C1E] text-[#E5E5EA] hover:border-[#C9A227]/50 hover:text-[#FFFFFF]"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-[#C9A227] text-[#000000] rounded-br-md"
                    : "bg-[#1C1C1E] border border-[#38383A] text-[#E5E5EA] rounded-bl-md"
                }`}
              >
                {m.role === "assistant" && (
                  <div className="text-[10px] uppercase tracking-wide text-[#C9A227] mb-1 font-medium">Sensei</div>
                )}
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={onSubmit} className="shrink-0 pt-2 pb-1">
        <div className="flex items-end gap-2 bg-[#1C1C1E] border border-[#38383A] rounded-2xl px-3 py-2 focus-within:border-[#C9A227]/50">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask Roster Sensei…"
            className="flex-1 resize-none bg-transparent text-sm text-[#FFFFFF] placeholder:text-[#636366] py-2 max-h-32 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send message"
            className="shrink-0 mb-0.5 w-9 h-9 rounded-xl bg-[#C9A227] text-[#000000] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#e0b82e]"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
        <p className="text-[11px] text-[#636366] text-center mt-2">Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
  );
}
