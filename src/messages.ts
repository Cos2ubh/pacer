// What the popup and the YouTube tab say to each other.

export type Phase =
  | "off" // disabled globally, for this channel, or for this video
  | "measuring" // listening to the speaker
  | "set" // speed decided for this video
  | "unsure" // couldn't get a trustworthy reading; left alone
  | "overridden"; // the viewer changed speed themselves; hands off

export type AudioState = "idle" | "waiting" | "ok" | "unavailable";

export interface Status {
  videoId: string;
  channelKey?: string;
  channelName?: string;
  phase: Phase;
  speed: number;
  rate?: number;
  confidence?: number;
  videoOff: boolean;
  audio: AudioState;
}

export type Request = { type: "status" } | { type: "setVideoOff"; value: boolean };
