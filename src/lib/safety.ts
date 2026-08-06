export const safetyDefaults = {
  mode: "same-ip-local-chrome",
  dailyActionLimit: 150,
  dailyInviteLimit: 50,
  actionDelaySeconds: [45, 120] as const,
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
