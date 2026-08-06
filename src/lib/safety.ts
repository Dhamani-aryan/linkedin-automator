import type { HumanTouchSettings } from "../types";

export const safetyDefaults: HumanTouchSettings & {
  mode: "same-ip-local-chrome";
  autoReplyCheck: boolean;
  proxyRotation: boolean;
  chromeProfile: string;
} = {
  mode: "same-ip-local-chrome",
  dailyActionLimit: 150,
  dailyInviteLimit: 50,
  minDelaySeconds: 45,
  maxDelaySeconds: 120,
  batchSize: 12,
  cooldownAfterBatchMinutes: 18,
  workingHoursStart: "09:30",
  workingHoursEnd: "18:30",
  randomizeScroll: true,
  randomProfileViewSeconds: [8, 28],
  pauseOnReply: true,
  autoReplyCheck: true,
  proxyRotation: false,
  chromeProfile: "single persistent local profile"
};

export const safetyChecklist = [
  "Use the same local machine IP for v1.",
  "Keep one persistent Chrome profile so LinkedIn stays logged in.",
  "Insert reply checks after every workflow action.",
  "Pause follow-ups when a reply is detected.",
  "Apply daily caps before the runner executes any action.",
  "Keep CSV/profile data local unless the user exports it."
];

export function formatDelayRange(settings: HumanTouchSettings) {
  return `${settings.minDelaySeconds}-${settings.maxDelaySeconds}s`;
}
