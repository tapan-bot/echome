"use client";

import { useEffect } from "react";

/**
 * Makes the glow behind a button follow the cursor. While the pointer is over a button
 * (anything with an fx-* class), this keeps two things up to date on it, as CSS variables:
 * where the pointer is inside it (--gx, --gy, in pixels, for the light that follows the cursor)
 * and which way it is from the centre (--sx, --sy, from -1 to 1, for the side the shadow falls
 * toward). The look itself is in globals.css. Nothing is stored, and no content is read.
 *
 * One listener for the whole page, rather than one per button. For people who ask their device
 * for less motion, the shadow stays centred.
 */
const SELECTOR = ".fx-primary, .fx-soft, .fx-calm, .fx-danger, .fx-card";

export function CursorGlow() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function onMove(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(SELECTOR) : null;
      if (!target) return;

      const { clientX, clientY } = event;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = target.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        const x = clientX - box.left;
        const y = clientY - box.top;
        target.style.setProperty("--gx", `${x}px`);
        target.style.setProperty("--gy", `${y}px`);
        if (reduced.matches) return;
        const clamp = (n: number) => Math.max(-1, Math.min(1, n));
        target.style.setProperty("--sx", clamp((x / box.width - 0.5) * 2).toFixed(3));
        target.style.setProperty("--sy", clamp((y / box.height - 0.5) * 2).toFixed(3));
      });
    }

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
