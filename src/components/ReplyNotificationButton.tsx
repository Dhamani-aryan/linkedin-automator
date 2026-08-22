import { useEffect, useMemo, useState } from "react";
import { Bell, MessageSquareReply } from "lucide-react";
import { campaignOutcomeRecords } from "../lib/campaignMetrics";
import {
  loadReplyNotificationsSeenAt,
  saveReplyNotificationsSeenAt
} from "../lib/notificationStorage";
import type { CampaignRun } from "../types";

interface ReplyNotificationButtonProps {
  profileId: string;
  runs: CampaignRun[];
  onOpenCampaign: (campaignId: string) => void;
}

interface ReplyNotification {
  campaignId: string;
  campaignName: string;
  leadUrl: string;
  leadName: string;
  replyText: string | null;
  occurredAt: string | null;
}

export function ReplyNotificationButton({
  profileId,
  runs,
  onOpenCampaign
}: ReplyNotificationButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(() =>
    loadReplyNotificationsSeenAt(profileId)
  );
  const notifications = useMemo(() => buildReplyNotifications(runs), [runs]);
  const seenTime = seenAt === null ? Number.NEGATIVE_INFINITY : Date.parse(seenAt);
  const unreadCount = notifications.filter((notification) => {
    const occurredAt = notification.occurredAt
      ? Date.parse(notification.occurredAt)
      : Number.POSITIVE_INFINITY;
    return occurredAt > seenTime;
  }).length;

  useEffect(() => {
    setIsOpen(false);
    setSeenAt(loadReplyNotificationsSeenAt(profileId));
  }, [profileId]);

  function toggleNotifications() {
    setIsOpen((current) => {
      const next = !current;
      if (next && notifications.length > 0) {
        const latestSeenAt = notifications[0].occurredAt ?? new Date().toISOString();
        saveReplyNotificationsSeenAt(profileId, latestSeenAt);
        setSeenAt(latestSeenAt);
      }
      return next;
    });
  }

  return (
    <div className="reply-notification-control">
      <button
        type="button"
        className={`icon-button reply-notification-button${unreadCount > 0 ? " has-unread" : ""}`}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread reply notification${unreadCount === 1 ? "" : "s"}`
            : "Reply notifications"
        }
        aria-expanded={isOpen}
        title="Reply notifications"
        onClick={toggleNotifications}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="reply-notification-count" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section className="reply-notification-panel" aria-label="Reply notifications">
          <header>
            <div>
              <strong>Replies</strong>
              <span>
                {notifications.length === 0
                  ? "No replies yet"
                  : `${notifications.length} total`}
              </span>
            </div>
          </header>

          {notifications.length === 0 ? (
            <div className="reply-notification-empty">
              <MessageSquareReply size={20} aria-hidden="true" />
              <span>New campaign replies will appear here.</span>
            </div>
          ) : (
            <div className="reply-notification-list">
              {notifications.slice(0, 25).map((notification) => (
                <button
                  type="button"
                  className="reply-notification-item"
                  key={`${notification.campaignId}-${notification.leadUrl}-${notification.occurredAt ?? "unknown"}`}
                  onClick={() => {
                    setIsOpen(false);
                    onOpenCampaign(notification.campaignId);
                  }}
                >
                  <span className="reply-notification-item-icon" aria-hidden="true">
                    <MessageSquareReply size={16} />
                  </span>
                  <span className="reply-notification-item-copy">
                    <strong>{notification.leadName}</strong>
                    <small>
                      {notification.campaignName} / {formatNotificationTime(notification.occurredAt)}
                    </small>
                    {notification.replyText ? <p>{notification.replyText}</p> : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function buildReplyNotifications(runs: CampaignRun[]): ReplyNotification[] {
  const campaigns = new Map<string, string>();

  for (const run of runs) {
    if (!campaigns.has(run.snapshot.campaign.id)) {
      campaigns.set(run.snapshot.campaign.id, run.snapshot.campaign.name);
    }
  }

  return Array.from(campaigns.entries())
    .flatMap(([campaignId, campaignName]) =>
      campaignOutcomeRecords(campaignId, runs).replied.map((record) => ({
        campaignId,
        campaignName,
        leadUrl: record.lead.linkedinUrl,
        leadName:
          record.lead.displayName.trim() ||
          [record.lead.firstName, record.lead.lastName].filter(Boolean).join(" ") ||
          "LinkedIn profile",
        replyText: record.replyText,
        occurredAt: record.occurredAt
      }))
    )
    .sort((left, right) => notificationTime(right.occurredAt) - notificationTime(left.occurredAt));
}

function notificationTime(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatNotificationTime(value: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
