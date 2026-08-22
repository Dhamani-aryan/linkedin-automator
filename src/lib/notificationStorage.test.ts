import { describe, expect, it } from "vitest";
import {
  loadReplyNotificationsSeenAt,
  saveReplyNotificationsSeenAt
} from "./notificationStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

describe("reply notification storage", () => {
  it("stores last-seen reply timestamps independently by profile", () => {
    const storage = memoryStorage();
    saveReplyNotificationsSeenAt("profile-1", "2026-08-22T16:20:00.000Z", storage);
    saveReplyNotificationsSeenAt("profile-2", "2026-08-22T17:20:00.000Z", storage);

    expect(loadReplyNotificationsSeenAt("profile-1", storage)).toBe("2026-08-22T16:20:00.000Z");
    expect(loadReplyNotificationsSeenAt("profile-2", storage)).toBe("2026-08-22T17:20:00.000Z");
  });

  it("ignores corrupt and invalid timestamps", () => {
    const storage = memoryStorage();
    storage.setItem("linkedin-automator.reply-notifications-seen-v1", "not-json");
    expect(loadReplyNotificationsSeenAt("profile-1", storage)).toBeNull();

    storage.setItem("linkedin-automator.reply-notifications-seen-v1", JSON.stringify({ "profile-1": "not-a-date" }));
    expect(loadReplyNotificationsSeenAt("profile-1", storage)).toBeNull();
  });
});
