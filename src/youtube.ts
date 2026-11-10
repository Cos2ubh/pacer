// Everything that depends on YouTube's page structure lives here, so when
// YouTube changes its markup there's one file to fix.

export function currentVideoId(): string | undefined {
  if (location.pathname !== "/watch") return undefined; // Shorts and embeds are out of scope
  return new URLSearchParams(location.search).get("v") ?? undefined;
}

export function player(): HTMLElement | null {
  return document.getElementById("movie_player");
}

export function findVideo(): HTMLVideoElement | null {
  return player()?.querySelector<HTMLVideoElement>("video") ?? null;
}

/** The right-hand group of buttons in the player's control bar (captions, settings…). */
export function playerControls(): HTMLElement | null {
  return player()?.querySelector<HTMLElement>(".ytp-right-controls") ?? null;
}

export function adShowing(): boolean {
  return player()?.classList.contains("ad-showing") ?? false;
}

export interface Channel {
  key: string;
  name: string;
}

/**
 * The channel of the video now playing. Returns undefined while the page
 * still shows the previous video's details (YouTube updates them lazily).
 */
export function currentChannel(videoId: string): Channel | undefined {
  const watch = document.querySelector("ytd-watch-flexy");
  if (watch?.getAttribute("video-id") !== videoId) return undefined;
  const link = document.querySelector<HTMLAnchorElement>(
    "ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a",
  );
  const href = link?.getAttribute("href");
  if (!link || !href) return undefined;
  const key = href.replace(/^https?:\/\/(www\.)?youtube\.com/, "").split(/[?#]/)[0]!;
  return { key, name: link.textContent?.trim() || key };
}

/** YouTube is a single-page app; this fires when it swaps to another page. */
export function onNavigate(cb: () => void): void {
  document.addEventListener("yt-navigate-finish", cb);
  window.addEventListener("popstate", cb);
}
