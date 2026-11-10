// The on/off button in YouTube's control bar. Pressed = Pacer is handling
// this video. Clicking it back on re-checks the speaker from scratch.

import { playerControls } from "./youtube";

const SVG_NS = "http://www.w3.org/2000/svg";

let btn: HTMLButtonElement | undefined;
let slash: SVGLineElement | undefined;
let handler: (() => void) | undefined;

export function onButtonClick(cb: () => void): void {
  handler = cb;
}

/** Puts the button in place (YouTube re-renders its controls) and shows the state. */
export function syncButton(active: boolean | null): void {
  const bar = playerControls();
  if (active === null || !bar) {
    btn?.remove();
    return;
  }
  if (!btn) btn = createButton();
  if (btn.parentElement !== bar) bar.prepend(btn);

  const label = active ? "Pacer is on for this video (click to turn off)" : "Pacer is off for this video (click to turn on)";
  btn.setAttribute("aria-pressed", String(active));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.style.opacity = active ? "1" : "0.55";
  if (slash) slash.style.display = active ? "none" : "";
}

function createButton(): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "ytp-button pacer-button";
  b.type = "button";
  Object.assign(b.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "top",
  });

  // A small speedometer; a slash through it when off.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const stroke = { fill: "none", stroke: "#fff", "stroke-width": "2", "stroke-linecap": "round" };
  const arc = el("path", { d: "M4 17a8 8 0 0 1 16 0", ...stroke });
  const needle = el("line", { x1: "12", y1: "17", x2: "16.5", y2: "10.5", ...stroke });
  const hub = el("circle", { cx: "12", cy: "17", r: "1.6", fill: "#fff" });
  slash = el("line", { x1: "4", y1: "4", x2: "20", y2: "20", ...stroke }) as SVGLineElement;
  svg.append(arc, needle, hub, slash);
  b.append(svg);

  b.addEventListener("click", (e) => {
    e.stopPropagation();
    handler?.();
  });
  // Keep Space/Enter on the button from also reaching YouTube's play/pause shortcut.
  b.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") e.stopPropagation();
  });
  return b;
}

function el(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
