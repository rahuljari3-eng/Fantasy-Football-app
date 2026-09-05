import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, Loader2, MessageCircle, Sparkles } from "lucide-react";
import {
  DEFAULT_SENSEI_MODEL,
  isSenseiModelId,
  SENSEI_MODELS,
  type SenseiModelId,
} from "../config/senseiModels";
import type { FantasyApp } from "../hooks/useFantasyApp";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  toolsUsed?: string[];
  model?: SenseiModelId;
}

const EXAMPLE_PROMPTS = [
  "Who should I start at flex this week?",
  "Is my RB room a need right now?",
  "What's a fair ask for my best WR?",
  "Any must-adds on the waiver wire?",
];

const HISTORY_CAP = 20;
const MODEL_STORAGE_KEY = "gridiron.senseiModel";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredModel(): SenseiModelId {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (isSenseiModelId(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_SENSEI_MODEL;
}

function ToolsUsedAccordion({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="mt-2 text-[11px] text-[#98989D]">
      <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-[#C9A227] select-none">
        <ChevronDown size={12} className="shrink-0 [[details[open]_&]]:rotate-180 transition-transform" />
        {tools.length} tool{tools.length === 1 ? "" : "s"} used
      </summary>
      <ul className="mt-1.5 pl-4 space-y-0.5 text-[#636366]">
        {tools.map((name, i) => (
          <li key={`${name}-${i}`} className="mono-font">
            {name}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ModelPicker({
  model,
  onChange,
  disabled,
}: {
  model: SenseiModelId;
  onChange: (id: SenseiModelId) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = SENSEI_MODELS.find((m) => m.id === model) ?? SENSEI_MODELS[0];

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Model: ${current.id}`}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-[#38383A] bg-[#1C1C1E]/95 text-[#E5E5EA] hover:border-[#C9A227]/50 hover:text-[#FFFFFF] disabled:opacity-50 backdrop-blur-sm"
      >
        <Sparkles size={12} className="text-[#C9A227] shrink-0" />
        <span className="font-medium">{current.label}</span>
        <ChevronDown size={12} className={`text-[#636366] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close model menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 top-full mt-1 z-20 min-w-[11rem] rounded-xl border border-[#38383A] bg-[#1C1C1E] shadow-xl py-1 overflow-hidden"
          >
            {SENSEI_MODELS.map((m) => {
              const selected = m.id === model;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[#2C2C2E] ${
                      selected ? "text-[#C9A227]" : "text-[#E5E5EA]"
                    }`}
                  >
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[10px] text-[#636366] mt-0.5">{m.description}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Roster Sensei chat — talks to POST /api/chat (server-side OpenAI + tools). */
export function ChatPage({ app }: { app: FantasyApp }) {
  const { selectedTeamId, selectedTeam, roster, bench } = app;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<SenseiModelId>(DEFAULT_SENSEI_MODEL);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatStarted = messages.length > 0;

  useEffect(() => {
    setModel(readStoredModel());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, model);
    } catch {
      // ignore
    }
  }, [model]);

  useEffect(() => {
    if (!chatStarted) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chatStarted, sending]);

  async function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content || sending) return;

    const userMsg: ChatMessage = { id: newId(), role: "user", content };
    const historyForApi = [...messages, userMsg]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-HISTORY_CAP)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setError(null);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyForApi,
          model,
          leagueContext: {
            managedTeamId: selectedTeamId,
            localLineup: {
              roster,
              bench,
            },
          },
        }),
      });

      const rawBody = await res.text();
      let data: { message?: string; toolsUsed?: string[]; error?: string; model?: string } = {};
      try {
        data = rawBody ? (JSON.parse(rawBody) as typeof data) : {};
      } catch {
        throw new Error(
          rawBody.trim().slice(0, 180) || `Request failed (${res.status}) — non-JSON response from API`
        );
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (!data.message) {
        throw new Error("Empty response from Sensei");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: data.message!,
          toolsUsed: data.toolsUsed ?? [],
          model: isSenseiModelId(data.model) ? data.model : model,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: `I couldn't finish that request: ${message}`,
          toolsUsed: [],
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(draft);
    }
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-9.5rem)] max-w-2xl mx-auto">
      <div className="absolute top-0 right-0 z-30">
        <ModelPicker model={model} onChange={setModel} disabled={sending} />
      </div>

      {!chatStarted ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-2 pb-6 pt-8">
          <div className="w-12 h-12 rounded-xl bg-[#C9A227]/15 border border-[#C9A227]/40 flex items-center justify-center mb-4">
            <MessageCircle size={22} className="text-[#C9A227]" />
          </div>
          <h2 className="display-font text-2xl mb-1.5">Roster Sensei</h2>
          <p className="text-sm text-[#98989D] max-w-sm mb-2">
            Ask about start/sit, waivers, trades, or your roster. Advising for{" "}
            <span className="text-[#C9A227]">{selectedTeam.name}</span>.
          </p>
          <p className="text-[11px] text-[#636366] mb-8">
            Switch teams in the header · model picker (top right) defaults to Mini
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => void sendMessage(prompt)}
                className="text-left text-sm px-3.5 py-2 rounded-full border border-[#38383A] bg-[#1C1C1E] text-[#E5E5EA] hover:border-[#C9A227]/50 hover:text-[#FFFFFF] disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1 pb-4 pt-10 space-y-4">
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
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#C9A227] mb-1 font-medium">
                    <span>Sensei</span>
                    {m.model && <span className="text-[#636366] normal-case tracking-normal font-normal">{m.model}</span>}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.role === "assistant" && m.toolsUsed && <ToolsUsedAccordion tools={m.toolsUsed} />}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[#1C1C1E] border border-[#38383A] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-[#98989D] flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-[#C9A227]" />
                Sensei is thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {error && !sending && (
        <div className="text-[11px] text-red-400 text-center mb-1 px-2">{error}</div>
      )}

      <form onSubmit={onSubmit} className="shrink-0 pt-2 pb-1">
        <div className="flex items-end gap-2 bg-[#1C1C1E] border border-[#38383A] rounded-2xl px-3 py-2 focus-within:border-[#C9A227]/50">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={sending}
            placeholder={`Ask Sensei about ${selectedTeam.name}…`}
            className="flex-1 resize-none bg-transparent text-sm text-[#FFFFFF] placeholder:text-[#636366] py-2 max-h-32 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="shrink-0 mb-0.5 w-9 h-9 rounded-xl bg-[#C9A227] text-[#000000] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#e0b82e]"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.5} />}
          </button>
        </div>
        <p className="text-[11px] text-[#636366] text-center mt-2">Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
  );
}
