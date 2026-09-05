import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { Toast, ToastTone } from "../hooks/useToasts";

const TONE_STYLES: Record<ToastTone, string> = {
  success: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  info: "bg-[#1C1C1E] border-[#38383A] text-[#E5E5EA]",
  error: "bg-red-500/15 border-red-500/40 text-red-200",
};
const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = { success: CheckCircle2, info: Info, error: XCircle };

/** Fixed bottom-right toast stack. Each toast auto-dismisses (see
 * useToasts) but can also be closed early. */
export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[60] flex flex-col gap-2 sm:max-w-sm sm:w-full pointer-events-none">
      {toasts.map((t) => {
        const Icon = TONE_ICON[t.tone];
        return (
          <div
            key={t.id}
            className={`animate-fade-slide-up pointer-events-auto flex items-start gap-2 border rounded-xl px-3.5 py-3 shadow-lg backdrop-blur ${TONE_STYLES[t.tone]}`}
          >
            <Icon size={16} className="shrink-0 mt-0.5" />
            <div className="text-sm flex-1">{t.message}</div>
            <button onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
