// Pointer-based drag and drop for the roster builder. Generic over the player
// type being dragged; drop targets are identified by a `data-drop-slot`
// attribute on the element under the pointer (see RosterBuilderPage/LineupPage).
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Player } from "../types";

function resolveDropTarget(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const target = el.closest("[data-drop-slot]");
  return target ? target.getAttribute("data-drop-slot") : null;
}

export function useDragAndDrop(onDrop: (target: string, player: Player) => void) {
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [dragPlayer, setDragPlayer] = useState<Player | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  // Mirrors dragPlayer for use inside event listeners without re-subscribing them.
  const draggingRef = useRef<Player | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  function handleDragStart(e: ReactPointerEvent, player: Player) {
    e.preventDefault();
    draggingRef.current = player;
    setDragPlayer(player);
    setDragPos({ x: e.clientX, y: e.clientY });
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      setDragOverTarget(resolveDropTarget(e.clientX, e.clientY));
    }
    function onUp(e: PointerEvent) {
      const player = draggingRef.current;
      if (!player) return;
      const target = resolveDropTarget(e.clientX, e.clientY);
      if (target) onDropRef.current(target, player);
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
  }, [dragPlayer]);

  return { dragOverTarget, dragPlayer, dragPos, handleDragStart };
}
