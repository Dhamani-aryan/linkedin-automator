const REPLY_NOTIFICATIONS_SEEN_KEY = "linkedin-automator.reply-notifications-seen-v1";

type NotificationStorage = Pick<Storage, "getItem" | "setItem">;

export function loadReplyNotificationsSeenAt(
  profileId: string,
  storage: NotificationStorage = window.localStorage
): string | null {
  try {
    const stored = storage.getItem(REPLY_NOTIFICATIONS_SEEN_KEY);
    const seenByProfile = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const value = seenByProfile[profileId];
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function saveReplyNotificationsSeenAt(
  profileId: string,
  seenAt: string,
  storage: NotificationStorage = window.localStorage
) {
  let seenByProfile: Record<string, unknown> = {};
  try {
    const stored = storage.getItem(REPLY_NOTIFICATIONS_SEEN_KEY);
    if (stored) seenByProfile = JSON.parse(stored) as Record<string, unknown>;
  } catch {
    seenByProfile = {};
  }
  storage.setItem(REPLY_NOTIFICATIONS_SEEN_KEY, JSON.stringify({
    ...seenByProfile,
    [profileId]: seenAt
  }));
}
