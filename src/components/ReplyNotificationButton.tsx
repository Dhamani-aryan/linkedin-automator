import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, LoaderCircle, MessageSquareReply, RefreshCw } from "lucide-react";
import { campaignOutcomeRecords } from "../lib/campaignMetrics";
import { checkCampaignReplies } from "../lib/runnerApi";
import {
  loadReplyNotificationsSeenAt,
  saveReplyNotificationsSeenAt
} from "../lib/notificationStorage";
import type { CampaignRun } from "../types";

interface ReplyNotificationButtonProps {
  profileId: string;
  runs: CampaignRun[];
  chromeConnected: boolean;
  onOpenCampaign: (campaignId: string) => void;
  onRepliesChecked: () => Promise<void>;
}

interface ReplyNotification {
  campaignId: string;
  campaignName: string;
  leadUrl: string;
  leadName: string;
  replyText: string | null;
  occurredAt: string | null;
  externalMessageId: string | null;
  baselineSentAt: string | null;
}

export function ReplyNotificationButton({
  profileId,
  runs,
  chromeConnected,
  onOpenCampaign,
  onRepliesChecked
}: ReplyNotificationButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const isCheckingRef = useRef(false);
  const onRepliesCheckedRef = useRef(onRepliesChecked);
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

  useEffect(() => {
    onRepliesCheckedRef.current = onRepliesChecked;
  }, [onRepliesChecked]);

  useEffect(() => {
    if (!chromeConnected) return;
    const initialCheck = window.setTimeout(() => void runReplyCheck(false), 1500);
    const interval = window.setInterval(() => void runReplyCheck(false), 120_000);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
    };
  }, [chromeConnected, profileId]);

  async function runReplyCheck(force: boolean) {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    setCheckError(null);
    try {
      await checkCampaignReplies(profileId, force);
      await onRepliesCheckedRef.current();
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Replies could not be checked.");
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }

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
            <button
              type="button"
              className="icon-button reply-notification-refresh"
              aria-label="Check replies now"
              title={chromeConnected ? "Check replies now" : "Start Chrome to check replies"}
              disabled={!chromeConnected || isChecking}
              onClick={() => void runReplyCheck(true)}
            >
              {isChecking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            </button>
          </header>

          {checkError ? (
            <div className="reply-notification-error" role="alert">
              {checkError}
            </div>
          ) : null}

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

  const candidates = Array.from(campaigns.entries())
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
        occurredAt: record.occurredAt,
        externalMessageId: record.externalMessageId,
        baselineSentAt: record.baselineSentAt
      }))
    );
  const uniqueNotifications = new Map<string, ReplyNotification>();
  for (const notification of candidates) {
    const key = notification.externalMessageId ??
      `${notification.campaignId}:${notification.leadUrl}:${notification.occurredAt ?? "unknown"}`;
    const existing = uniqueNotifications.get(key);
    if (
      !existing ||
      notificationTime(notification.baselineSentAt) > notificationTime(existing.baselineSentAt)
    ) {
      uniqueNotifications.set(key, notification);
    }
  }

  return Array.from(uniqueNotifications.values())
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
