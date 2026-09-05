// Lightweight, self-dismissing toast notifications -- confirmation for
// actions whose effect isn't otherwise obvious at a glance (an ESPN sync
// completing, applying an AI-suggested lineup swap). Deliberately not wired
// into every roster edit: drag-and-drop is the primary, high-frequency
// interaction on the roster page, and a toast on every drop would be noise,
// not feedback.
import { useCallback, useRef, useState } from "react";

export type ToastTone = "success" | "info" | "error";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

let nextToastId = 1;
const AUTO_DISMISS_MS = 3800;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextToastId++;
      setToasts((t) => [...t, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), AUTO_DISMISS_MS)
      );
    },
    [dismissToast]
  );

  return { toasts, notify, dismissToast };
}
