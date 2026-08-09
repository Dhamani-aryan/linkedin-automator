const dayMs = 86_400_000;

export function checkWorkingWindow(safety, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const local = getLocalTimeParts(now, timeZone);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = parseTime(safety.workingHoursStart);
  const endMinutes = parseTime(safety.workingHoursEnd);

  if (startMinutes === endMinutes) {
    return { allowed: true, reason: null, sleepingUntil: null };
  }

  const sameDayWindow = startMinutes < endMinutes;
  const allowed = sameDayWindow
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;

  if (allowed) {
    return { allowed: true, reason: null, sleepingUntil: null };
  }

  const daysToAdd = sameDayWindow && currentMinutes >= endMinutes ? 1 : 0;
  return {
    allowed: false,
    reason: "outside_working_hours",
    sleepingUntil: zonedLocalDateTimeToUtc(local, startMinutes, daysToAdd, timeZone).toISOString()
  };
}

export function checkDailyCaps(safety, auditEntries, actionType, now = new Date()) {
  const recentSent = countRecentActions(auditEntries, now);
  const recentInvites = countRecentActions(auditEntries, now, "connection_request");

  if (recentSent >= safety.dailyActionLimit) {
    return {
      allowed: false,
      reason: "daily_action_limit_reached",
      sleepingUntil: nextWindowOpening(auditEntries, now).toISOString()
    };
  }

  if (actionType === "connection_request" && recentInvites >= safety.dailyInviteLimit) {
    return {
      allowed: false,
      reason: "daily_invite_limit_reached",
      sleepingUntil: nextWindowOpening(auditEntries, now, "connection_request").toISOString()
    };
  }

  return { allowed: true, reason: null, sleepingUntil: null };
}

export function checkBatchCooldown(safety, auditEntries, now = new Date()) {
  if (!Number.isFinite(safety.batchSize) || safety.batchSize <= 0) {
    return { allowed: true, reason: null, sleepingUntil: null };
  }

  const sentEntries = recentSuccessfulActions(auditEntries, now).sort((left, right) =>
    new Date(left.ts).getTime() - new Date(right.ts).getTime()
  );
  if (sentEntries.length === 0 || sentEntries.length % safety.batchSize !== 0) {
    return { allowed: true, reason: null, sleepingUntil: null };
  }

  const lastSentAt = new Date(sentEntries.at(-1).ts).getTime();
  const cooldownUntil = lastSentAt + safety.cooldownAfterBatchMinutes * 60_000;
  if (now.getTime() >= cooldownUntil) {
    return { allowed: true, reason: null, sleepingUntil: null };
  }

  return {
    allowed: false,
    reason: "batch_cooldown",
    sleepingUntil: new Date(cooldownUntil).toISOString()
  };
}

export function checkSafetyGate(safety, auditEntries, actionType, now = new Date(), timeZone) {
  const workingWindow = checkWorkingWindow(safety, now, timeZone);
  if (!workingWindow.allowed) return workingWindow;

  const caps = checkDailyCaps(safety, auditEntries, actionType, now);
  if (!caps.allowed) return caps;

  return checkBatchCooldown(safety, auditEntries, now);
}

export function randomizedDelayMs(safety, random = Math.random) {
  const minMs = Math.max(0, safety.minDelaySeconds) * 1000;
  const maxMs = Math.max(minMs, safety.maxDelaySeconds * 1000);
  return Math.round(minMs + random() * (maxMs - minMs));
}

export function actionTypeFromAuditEntry(entry) {
  return entry.detail?.actionType ?? entry.actionType ?? null;
}

function countRecentActions(auditEntries, now, actionType = null) {
  return recentSuccessfulActions(auditEntries, now)
    .filter((entry) => actionType === null || actionTypeFromAuditEntry(entry) === actionType)
    .length;
}

function recentSuccessfulActions(auditEntries, now) {
  const start = now.getTime() - dayMs;
  return auditEntries.filter((entry) => {
    const ts = Date.parse(entry.ts);
    return Number.isFinite(ts) &&
      ts >= start &&
      ts <= now.getTime() &&
      ["sent", "dry_run_ok", "ok"].includes(entry.outcome);
  });
}

function nextWindowOpening(auditEntries, now, actionType = null) {
  const matching = recentSuccessfulActions(auditEntries, now)
    .filter((entry) => actionType === null || actionTypeFromAuditEntry(entry) === actionType)
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const oldest = matching[0]?.ts;
  return new Date((oldest ? Date.parse(oldest) : now.getTime()) + dayMs + 1000);
}

function parseTime(value) {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function getLocalTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

function zonedLocalDateTimeToUtc(local, minutes, daysToAdd, timeZone) {
  const target = {
    year: local.year,
    month: local.month,
    day: local.day + daysToAdd,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60
  };
  let guess = new Date(Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute
  ));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getLocalTimeParts(guess, timeZone);
    const deltaMs = localPartsToUtcMs(target) - localPartsToUtcMs(actual);
    if (deltaMs === 0) return guess;
    guess = new Date(guess.getTime() + deltaMs);
  }

  return guess;
}

function localPartsToUtcMs(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
}
