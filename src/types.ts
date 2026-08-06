export type ChromeTabSummary = {
  id: string | null;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string | null;
};

export type ChromeStatus = {
  ok: true;
  connected: boolean;
  cdpPort: number;
  profileDir: string;
  ownedProcess: boolean;
  launchedAt: string | null;
  tabs: ChromeTabSummary[];
};

export type LinkedInAccount = {
  id: string;
  email: string;
  name: string;
  state: "stopped" | "starting" | "running" | "error";
  role: "Owner";
  chromeProfileMode: "single-local-profile";
  archived: boolean;
  lastError?: string;
};
