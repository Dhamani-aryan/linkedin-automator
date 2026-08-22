import { clickAt, evaluate, insertText, navigate } from "../browserSession.js";
import { ErrorCodes } from "../errors.js";
import { renderTemplate } from "../template.js";
import { selectors } from "./selectors.js";

const PROFILE_MESSAGE_SETTLE_MS = 6_000;

export async function executeMessage({
  session,
  lead,
  action,
  mode,
  replyBaseline = null,
  replyCheckOnly = false,
  reuseCurrentPage = false,
  shouldStop = async () => false,
  shouldPause = async () => false
}) {
  const page = reuseCurrentPage
    ? await evaluate(session, () => ({
        ok: true,
        url: location.href,
        title: document.title,
        readyState: document.readyState
      }), [])
    : await navigate(session, lead.linkedinUrl, { timeoutMs: 25_000 });
  const classification = await readMessageEligibility(session);

  if (classification.pageKind !== "profile") {
    return {
      outcome: "needs_review",
      errorCode: classification.errorCode ?? ErrorCodes.LAYOUT_MISMATCH,
      detail: classification
    };
  }

  if (classification.messageState !== "message_available") {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: {
        ...classification,
        reason: "No visible Message button was found on the profile. The runner cannot message this lead."
      }
    };
  }

  const profileIdentity = await readProfileIdentity(session, page.title);
  if (!profileIdentity.firstName) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: {
        actionType: "message",
        reason: "The lead name could not be read from the LinkedIn profile heading.",
        profileIdentity
      }
    };
  }
  const resolvedLead = { ...lead, ...profileIdentity };
  const resolved = renderTemplate(action.template ?? "", resolvedLead, { missingVariable: "empty" });
  if (mode === "live") {
    let opening = null;
    if (replyBaseline) {
      opening = await openMessageComposer(session, profileIdentity.displayName);
      if (!opening.composer) {
        return {
          outcome: "needs_review",
          errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
          detail: {
            actionType: "reply_check",
            reason: "The profile Message control did not open the campaign conversation for reply checking.",
            recipientName: profileIdentity.displayName,
            composerOpening: opening
          }
        };
      }
      const messages = await readConversationMessages(session, profileIdentity.displayName);
      const reply = classifyConversationReply(messages, replyBaseline, {
        recipientName: profileIdentity.displayName,
        recipientUrl: lead.linkedinUrl
      });
      if (reply.status === "replied") {
        return {
          outcome: "replied",
          event: "reply_received",
          detail: {
            actionType: "reply_check",
            source: "profile_conversation_check",
            recipientName: profileIdentity.displayName,
            baselineSentAt: replyBaseline.sentAt,
            externalMessageId: reply.message.externalId,
            replyText: reply.message.text,
            observedAt: new Date().toISOString()
          }
        };
      }
      if (reply.status === "needs_review") {
        return {
          outcome: "needs_review",
          errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
          detail: {
            actionType: "reply_check",
            reason: reply.reason,
            recipientName: profileIdentity.displayName,
            baselineSentAt: replyBaseline.sentAt,
            messageCount: messages.length
          }
        };
      }
      if (replyCheckOnly) {
        return {
          outcome: "no_reply",
          event: "reply_not_found",
          detail: {
            actionType: "reply_check",
            source: "profile_conversation_check",
            recipientName: profileIdentity.displayName,
            baselineSentAt: replyBaseline.sentAt,
            messageCount: messages.length,
            observedAt: new Date().toISOString()
          }
        };
      }
    }
    return await sendLiveMessage({
      session,
      recipientName: profileIdentity.displayName,
      classification,
      resolved,
      opening,
      shouldStop,
      shouldPause
    });
  }

  return {
    outcome: "dry_run_ok",
    event: "would_send_message",
    detail: {
      actionType: "message",
      page,
      messageState: classification.messageState,
      matchedControl: classification.matchedControl,
      inspectedAfterMs: classification.inspectedAfterMs,
      profileIdentity,
      resolvedText: resolved.text,
      missingVariables: resolved.missing
    }
  };
}

async function sendLiveMessage({ session, recipientName, classification, resolved, opening, shouldStop, shouldPause }) {
  if (await shouldStop()) return stoppedMessageResult("before_composer", recipientName);
  if (await shouldPause()) return pausedMessageResult("before_composer", recipientName);

  opening ??= await openMessageComposer(session, recipientName);
  if (!opening.composer) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: {
        actionType: "message",
        reason: "The profile Message control did not open a composer.",
        recipientName,
        composerOpening: opening,
        ...classification
      }
    };
  }

  const composer = opening.composer;

  const hasExactPreparedDraft = composer.text === resolved.text;
  if (composer.text.length > 0 && !hasExactPreparedDraft) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
      detail: {
        actionType: "message",
        reason: "The composer already contains a draft. It was left untouched.",
        recipientName,
        draftText: composer.text
      }
    };
  }

  if (!hasExactPreparedDraft) {
    const prepared = await focusComposer(session, recipientName);
    if (!prepared) {
      return {
        outcome: "needs_review",
        errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
        detail: { actionType: "message", reason: "The message editor could not be focused.", recipientName }
      };
    }

    await insertText(session, resolved.text);
  }
  const verified = await waitForComposerText(session, recipientName, resolved.text, 5_000);
  if (!verified?.matches) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
      detail: {
        actionType: "message",
        reason: "The composer text did not exactly match the resolved template. Send was not clicked.",
        recipientName,
        expectedText: resolved.text,
        actualText: verified?.text ?? null
      }
    };
  }

  const beforeCount = verified.matchingMessageCount;
  const sendPoint = await waitForSendPoint(session, recipientName, 5_000);
  if (!sendPoint) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: {
        actionType: "message",
        reason: "The Send button did not become available after the composer was verified.",
        recipientName
      }
    };
  }

  if (await shouldStop()) return stoppedMessageResult("before_send", recipientName);
  if (await shouldPause()) return pausedMessageResult("before_send", recipientName);
  await clickAt(session, sendPoint);
  const confirmation = await waitForSentMessage(session, recipientName, resolved.text, beforeCount, 12_000);
  if (!confirmation?.confirmed) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
      detail: {
        actionType: "message",
        reason: "Send was clicked, but LinkedIn did not provide an authoritative sent confirmation. The runner will not retry.",
        recipientName,
        resolvedText: resolved.text
      }
    };
  }

  return {
    outcome: "sent",
    event: "message_sent",
      detail: {
        actionType: "message",
        recipientName,
        resolvedText: resolved.text,
        missingVariables: resolved.missing,
        confirmation: confirmation.indicator,
        sentAt: confirmation.sentAt,
        externalMessageId: confirmation.externalMessageId ?? null
      }
  };
}

function stoppedMessageResult(stage, recipientName) {
  return {
    stopped: true,
    outcome: "stopped",
    errorCode: ErrorCodes.RUN_STOPPED,
    event: "message_stopped",
    detail: {
      actionType: "message",
      stage,
      recipientName,
      reason: "Stop was requested before Send was clicked."
    }
  };
}

function pausedMessageResult(stage, recipientName) {
  return {
    paused: true,
    outcome: "paused",
    errorCode: null,
    event: "message_paused",
    detail: {
      actionType: "message",
      stage,
      recipientName,
      reason: "Pause was requested before Send was clicked."
    }
  };
}

async function openMessageComposer(session, recipientName) {
  await evaluate(session, () => window.scrollTo({ top: 0, behavior: "instant" }), []);
  await new Promise((resolve) => setTimeout(resolve, PROFILE_MESSAGE_SETTLE_MS));
  const attempts = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const profileTarget = await waitForValue(
      () => readProfileMessageTarget(session),
      Boolean,
      attempt === 1 ? 15_000 : 5_000
    );

    if (!profileTarget) {
      return {
        composer: null,
        stage: "profile_message_button_missing",
        surface: "profile_main_action",
        settledForMs: PROFILE_MESSAGE_SETTLE_MS,
        attempts
      };
    }

    await clickAt(session, profileTarget.point);
    const composer = await waitForComposer(session, recipientName, attempt === 1 ? 8_000 : 12_000);
    attempts.push({
      attempt,
      target: profileTarget.detail,
      observation: await readMessagingSurface(session)
    });
    if (composer) {
      return {
        composer,
        stage: "profile_composer_opened",
        surface: "profile_main_action",
        settledForMs: PROFILE_MESSAGE_SETTLE_MS,
        attempt,
        attempts
      };
    }
  }

  return {
    composer: null,
    stage: "profile_message_click_unresolved",
    surface: "profile_main_action",
    settledForMs: PROFILE_MESSAGE_SETTLE_MS,
    attempts
  };
}

async function readProfileIdentity(session, pageTitle) {
  return await evaluate(session, (fallbackTitle) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const heading = [...document.querySelectorAll("main h1, h1")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => normalize(element.textContent))
      .find(Boolean);
    const displayName = heading || normalize(fallbackTitle.replace(/\s*\|\s*LinkedIn\s*$/i, ""));
    const parts = displayName.split(" ").filter(Boolean);
    return {
      displayName,
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" ")
    };
  }, [pageTitle]);
}

async function readProfileMessageTarget(session) {
  return await evaluate(session, (selector) => {
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
          rect.top >= 80 && rect.height >= 40 && label.startsWith("message") &&
          style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((left, right) => left.rect.top - right.rect.top);
    const candidate = candidates[0];
    if (!candidate) return null;
    return {
      point: {
        x: candidate.rect.left + candidate.rect.width / 2,
        y: candidate.rect.top + candidate.rect.height / 2
      },
      detail: {
        tag: candidate.element.tagName.toLowerCase(),
        label: (candidate.element.textContent ?? candidate.element.getAttribute("aria-label") ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        top: Math.round(candidate.rect.top),
        height: Math.round(candidate.rect.height)
      }
    };
  }, [selectors.profileMessageControl]);
}

async function readMessagingSurface(session) {
  return await evaluate(session, () => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const bubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    return {
      url: location.href,
      hasMessagingShadowRoot: Boolean(shadowRoot),
      conversationTitles: bubbles
        .map((bubble) => normalize(bubble.querySelector(".msg-overlay-bubble-header__title")?.textContent))
        .filter(Boolean),
      editorCount: shadowRoot
        ? shadowRoot.querySelectorAll('.msg-form__contenteditable[contenteditable="true"][role="textbox"]').length
        : 0
    };
  }, []);
}

async function readConversationMessages(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const readStructuredText = (element) => {
      let output = "";
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          output += node.textContent ?? "";
          return;
        }
        if (!node || typeof node.nodeType !== "number") return;
        if (node.nodeName === "BR") {
          output += "\n";
          return;
        }
        for (const child of node.childNodes) visit(child);
        if (["DIV", "P", "LI"].includes(node.nodeName) && !output.endsWith("\n")) output += "\n";
      };
      visit(element);
      return output.replace(/\r\n/g, "\n").replace(/\n$/, "").trim();
    };
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const container = shadowBubble ?? document.querySelector(".msg-compose-container");
    if (!container) return [];

    return [...container.querySelectorAll(".msg-s-event-listitem")].map((item, index) => {
      const event = item.closest(".msg-s-message-list__event") ?? item;
      const authorElement = event.querySelector(
        ".msg-s-message-group__name, .msg-s-message-group__profile-link, [data-anonymize='person-name']"
      );
      const profileLink = event.querySelector('a[href*="/in/"]');
      const body = item.querySelector(".msg-s-event-listitem__body") ?? item;
      const time = item.querySelector("time") ?? event.querySelector("time");
      return {
        index,
        externalId: event.getAttribute("data-event-urn") ?? item.getAttribute("data-event-urn") ?? `thread-${index}`,
        text: readStructuredText(body),
        author: normalize(authorElement?.textContent ?? authorElement?.getAttribute("aria-label")),
        profileUrl: profileLink?.href ?? null,
        displayedAt: time?.getAttribute("datetime") ?? time?.getAttribute("title") ?? normalize(time?.textContent)
      };
    }).filter((message) => message.text.length > 0);
  }, [recipientName]);
}

export function classifyConversationReply(messages, baseline, recipient) {
  const normalizeText = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const normalizeName = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const normalizeUrl = (value) => String(value ?? "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  const baselineText = normalizeText(baseline?.text);
  const baselineExternalId = String(baseline?.externalMessageId ?? "").trim();
  const recipientName = normalizeName(recipient.recipientName);
  const recipientUrl = normalizeUrl(recipient.recipientUrl);
  const isRecipientMessage = (message) => {
    const author = normalizeName(message.author);
    const profileUrl = normalizeUrl(message.profileUrl);
    return Boolean(
      (author && (author === recipientName || recipientName.startsWith(`${author} `))) ||
      (profileUrl && recipientUrl && profileUrl === recipientUrl)
    );
  };
  const baselineIndex = messages.reduce((latest, message, index) =>
    (baselineExternalId && message.externalId === baselineExternalId) ||
      (baselineText && normalizeText(message.text) === baselineText)
      ? index
      : latest, -1);
  if (!baselineText && !baselineExternalId) {
    return {
      status: "needs_review",
      reason: "The last confirmed campaign message was not visible in the opened conversation."
    };
  }

  if (baselineIndex < 0) {
    const baselineTime = Date.parse(baseline.sentAt);
    const timestampedReply = Number.isNaN(baselineTime)
      ? null
      : [...messages].reverse().find((message) => {
          const displayedTime = Date.parse(message.displayedAt ?? "");
          return isRecipientMessage(message) && !Number.isNaN(displayedTime) && displayedTime > baselineTime;
        });
    if (timestampedReply) return { status: "replied", message: timestampedReply };

    return {
      status: "needs_review",
      reason: "The last confirmed campaign message was not visible in the opened conversation."
    };
  }

  let hasUnattributedMessage = false;
  for (const message of messages.slice(baselineIndex + 1)) {
    if (isRecipientMessage(message)) return { status: "replied", message };
    if (!normalizeName(message.author) && !normalizeUrl(message.profileUrl)) hasUnattributedMessage = true;
  }

  if (hasUnattributedMessage) {
    return {
      status: "needs_review",
      reason: "A message after the campaign baseline could not be attributed to the sender or recipient."
    };
  }
  return { status: "no_reply" };
}

async function readComposer(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const readStructuredText = (element) => {
      let output = "";
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          output += node.textContent ?? "";
          return;
        }
        if (!node || typeof node.nodeType !== "number") return;
        if (node.nodeName === "BR") {
          output += "\n";
          return;
        }
        for (const child of node.childNodes) visit(child);
        if (["DIV", "P", "LI"].includes(node.nodeName) && !output.endsWith("\n")) output += "\n";
      };
      visit(element);
      return output.replace(/\r\n/g, "\n").replace(/\n$/, "");
    };
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    ) ?? shadowBubbles.find((candidate) =>
      candidate.classList.contains("msg-overlay-conversation-bubble--is-compose") &&
      normalize(candidate.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
        ?.getAttribute("aria-label")?.replace(/^Remove\s+/i, "")) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!container || !editor) return null;
    return {
      recipientName: shadowBubble ? expectedRecipient : pageRecipient,
      text: readStructuredText(editor),
      matchingMessageCount: 0
    };
  }, [recipientName]);
}

async function focusComposer(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    ) ?? shadowBubbles.find((candidate) =>
      candidate.classList.contains("msg-overlay-conversation-bubble--is-compose") &&
      normalize(candidate.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
        ?.getAttribute("aria-label")?.replace(/^Remove\s+/i, "")) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!editor || typeof editor.focus !== "function") return false;
    editor.focus();
    return document.activeElement === editor || shadowRoot?.activeElement === editor;
  }, [recipientName], { userGesture: true });
}

async function readComposerText(session, recipientName, expectedText) {
  return await evaluate(session, (expectedRecipient, expected) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const readStructuredText = (element) => {
      let output = "";
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          output += node.textContent ?? "";
          return;
        }
        if (!node || typeof node.nodeType !== "number") return;
        if (node.nodeName === "BR") {
          output += "\n";
          return;
        }
        for (const child of node.childNodes) visit(child);
        if (["DIV", "P", "LI"].includes(node.nodeName) && !output.endsWith("\n")) output += "\n";
      };
      visit(element);
      return output.replace(/\r\n/g, "\n").replace(/\n$/, "");
    };
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    ) ?? shadowBubbles.find((candidate) =>
      candidate.classList.contains("msg-overlay-conversation-bubble--is-compose") &&
      normalize(candidate.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
        ?.getAttribute("aria-label")?.replace(/^Remove\s+/i, "")) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!editor) return null;
    const text = readStructuredText(editor);
    const matchingMessageCount = [...container.querySelectorAll(".msg-s-event-listitem__body")]
      .filter((element) => readStructuredText(element) === expected)
      .length;
    return { text, matches: text === expected, matchingMessageCount };
  }, [recipientName, expectedText]);
}

async function readSendPoint(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    ) ?? shadowBubbles.find((candidate) =>
      candidate.classList.contains("msg-overlay-conversation-bubble--is-compose") &&
      normalize(candidate.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
        ?.getAttribute("aria-label")?.replace(/^Remove\s+/i, "")) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const button = container?.querySelector('button.msg-form__send-button[type="submit"]:not([disabled])');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [recipientName]);
}

async function readSentConfirmation(session, recipientName, expectedText, beforeCount) {
  return await evaluate(session, (expectedRecipient, expected, priorCount) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const readStructuredText = (element) => {
      let output = "";
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          output += node.textContent ?? "";
          return;
        }
        if (!node || typeof node.nodeType !== "number") return;
        if (node.nodeName === "BR") {
          output += "\n";
          return;
        }
        for (const child of node.childNodes) visit(child);
        if (["DIV", "P", "LI"].includes(node.nodeName) && !output.endsWith("\n")) output += "\n";
      };
      visit(element);
      return output.replace(/\r\n/g, "\n").replace(/\n$/, "");
    };
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubbles = shadowRoot ? [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")] : [];
    const shadowBubble = shadowBubbles.find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    ) ?? shadowBubbles.find((candidate) =>
      candidate.classList.contains("msg-overlay-conversation-bubble--is-compose") &&
      normalize(candidate.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
        ?.getAttribute("aria-label")?.replace(/^Remove\s+/i, "")) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    if (!container) return null;
    const matching = [...container.querySelectorAll(".msg-s-event-listitem__body")]
      .filter((element) => readStructuredText(element) === expected);
    if (matching.length <= priorCount) return { confirmed: false };
    const sentBody = matching.at(-1);
    const messageEvent = sentBody?.closest(".msg-s-message-list__event");
    const indicatorEvent = sentBody?.closest(".msg-s-event-with-indicator");
    const indicator = indicatorEvent?.querySelector(".msg-s-event-with-indicator__sending-indicator--sent");
    return {
      confirmed: Boolean(indicator),
      indicator: indicator ? "sent_indicator" : null,
      sentAt: indicator?.getAttribute("title") ?? new Date().toISOString(),
      externalMessageId:
        messageEvent?.getAttribute("data-event-urn") ??
        indicatorEvent?.getAttribute("data-event-urn") ??
        null
    };
  }, [recipientName, expectedText, beforeCount]);
}

async function waitForComposer(session, recipientName, timeoutMs) {
  return await waitForValue(() => readComposer(session, recipientName), Boolean, timeoutMs);
}

async function waitForComposerText(session, recipientName, expectedText, timeoutMs) {
  return await waitForValue(
    () => readComposerText(session, recipientName, expectedText),
    (value) => value?.matches === true,
    timeoutMs
  );
}

async function waitForSendPoint(session, recipientName, timeoutMs) {
  return await waitForValue(() => readSendPoint(session, recipientName), Boolean, timeoutMs);
}

async function waitForSentMessage(session, recipientName, expectedText, beforeCount, timeoutMs) {
  return await waitForValue(
    () => readSentConfirmation(session, recipientName, expectedText, beforeCount),
    (value) => value?.confirmed === true,
    timeoutMs
  );
}

async function waitForValue(read, accept, timeoutMs) {
  const startedAt = Date.now();
  let value = null;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return value;
}

async function readMessageEligibility(session) {
  return await evaluate(session, async (selectorsInput) => {
    const startedAt = Date.now();
    const hydrationTimeoutMs = 15_000;
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const isMessageControl = (control) =>
      control.text === selectorsInput.messageButtonText ||
      control.aria.startsWith(selectorsInput.messageButtonText);
    const findPrimaryMessageControl = () => {
      return [...document.querySelectorAll(selectorsInput.profileMessageControl)]
        .filter(isVisible)
        .map((element) => readControl(element))
        .filter((control) =>
          isMessageControl(control) &&
          control.rect.top >= 80 &&
          control.rect.height >= 40
        )
        .sort((left, right) => left.rect.top - right.rect.top)[0] ?? null;
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
        style.visibility !== "hidden" && style.display !== "none";
    };
    const readControl = (control) => ({
      text: (control.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
      aria: (control.getAttribute("aria-label") ?? "").toLowerCase(),
      href: (control.getAttribute("href") ?? "").toLowerCase(),
      element: control,
      rect: control.getBoundingClientRect()
    });

    if (document.querySelector(selectorsInput.loginForm) || /\/login|authwall/i.test(location.href)) {
      return { pageKind: "login_wall", errorCode: "LINKEDIN_LOGGED_OUT", url: location.href, title: document.title };
    }

    if (/checkpoint|challenge/i.test(location.href) || text.includes("security verification")) {
      return { pageKind: "challenge", errorCode: "AUTH_CHALLENGE", url: location.href, title: document.title };
    }

    if (!/linkedin\.com\/(in|sales\/lead)\//i.test(location.href)) {
      return { pageKind: "unknown", errorCode: "LAYOUT_MISMATCH", url: location.href, title: document.title };
    }

    let messageControl = findPrimaryMessageControl();
    while (!messageControl && Date.now() - startedAt < hydrationTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      messageControl = findPrimaryMessageControl();
    }

    const messageState = messageControl ? "message_available" : "message_unavailable";
    const matchedControl = messageControl ? "profile_main_action" : null;

    return {
      pageKind: "profile",
      messageState,
      matchedControl,
      inspectedAfterMs: Date.now() - startedAt,
      url: location.href,
      title: document.title
    };
  }, [selectors]);
}
