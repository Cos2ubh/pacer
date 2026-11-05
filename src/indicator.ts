// A small on-video label so the viewer always knows what Pacer just did.
// It's an ARIA live region, so screen readers announce it too.

import { player } from "./youtube";

let el: HTMLDivElement | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function showIndicator(text: string): void {
  const host = player();
  if (!host) return;
  if (!el || !el.isConnected) {
    el = document.createElement("div");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    Object.assign(el.style, {
      position: "absolute",
      top: "12px",
      left: "12px",
      zIndex: "60",
      background: "rgba(0, 0, 0, 0.85)",
      color: "#fff",
      font: "600 14px/1.3 Roboto, Arial, sans-serif",
      padding: "6px 10px",
      borderRadius: "6px",
      pointerEvents: "none",
      transition: "opacity 0.3s",
      opacity: "0",
    });
    host.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 2500);
}
