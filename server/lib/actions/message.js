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
  shouldStop = async () => false,
  shouldPause = async () => false
}) {
  const page = await navigate(session, lead.linkedinUrl, { timeoutMs: 25_000 });
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
    return await sendLiveMessage({
      session,
      recipientName: profileIdentity.displayName,
      classification,
      resolved,
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

async function sendLiveMessage({ session, recipientName, classification, resolved, shouldStop, shouldPause }) {
  if (await shouldStop()) return stoppedMessageResult("before_composer", recipientName);
  if (await shouldPause()) return pausedMessageResult("before_composer", recipientName);

  const opening = await openMessageComposer(session, recipientName);
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

  if (composer.text.length > 0) {
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

  const prepared = await focusComposer(session, recipientName);
  if (!prepared) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: { actionType: "message", reason: "The message editor could not be focused.", recipientName }
    };
  }

  await insertText(session, resolved.text);
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
      sentAt: confirmation.sentAt
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

async function readComposer(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubble = shadowRoot && [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")].find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!container || !(editor instanceof HTMLElement)) return null;
    return {
      recipientName: shadowBubble
        ? normalize(shadowBubble.querySelector(".msg-overlay-bubble-header__title")?.textContent)
        : pageRecipient,
      text: normalizeEditorText(editor.innerText),
      matchingMessageCount: 0
    };

    function normalizeEditorText(value) {
      return String(value ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
    }
  }, [recipientName]);
}

async function focusComposer(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubble = shadowRoot && [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")].find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return document.activeElement === editor || shadowRoot?.activeElement === editor;
  }, [recipientName], { userGesture: true });
}

async function readComposerText(session, recipientName, expectedText) {
  return await evaluate(session, (expectedRecipient, expected) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const normalizeText = (value) => String(value ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubble = shadowRoot && [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")].find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const editor = container?.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
    if (!(editor instanceof HTMLElement)) return null;
    const text = normalizeText(editor.innerText);
    const matchingMessageCount = [...container.querySelectorAll(".msg-s-event-listitem__body")]
      .filter((element) => normalizeText(element.innerText) === normalizeText(expected))
      .length;
    return { text, matches: text === normalizeText(expected), matchingMessageCount };
  }, [recipientName, expectedText]);
}

async function readSendPoint(session, recipientName) {
  return await evaluate(session, (expectedRecipient) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubble = shadowRoot && [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")].find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    const button = container?.querySelector('button.msg-form__send-button[type="submit"]:not([disabled])');
    if (!(button instanceof HTMLElement)) return null;
    const rect = button.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [recipientName]);
}

async function readSentConfirmation(session, recipientName, expectedText, beforeCount) {
  return await evaluate(session, (expectedRecipient, expected, priorCount) => {
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const normalizeText = (value) => String(value ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
    const shadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    const shadowBubble = shadowRoot && [...shadowRoot.querySelectorAll(".msg-overlay-conversation-bubble")].find((candidate) =>
      normalize(candidate.querySelector(".msg-overlay-bubble-header__title")?.textContent) === expectedRecipient
    );
    const pageThread = document.querySelector(".msg-compose-container");
    const pageRecipient = pageThread?.querySelector('.msg-connections-typeahead__added-recipients button[aria-label^="Remove "]')
      ?.getAttribute("aria-label")
      ?.replace(/^Remove\s+/i, "")
      .trim();
    const container = shadowBubble ?? (pageRecipient === expectedRecipient ? pageThread : null);
    if (!container) return null;
    const matching = [...container.querySelectorAll(".msg-s-event-listitem__body")]
      .filter((element) => normalizeText(element.innerText) === normalizeText(expected));
    if (matching.length <= priorCount) return { confirmed: false };
    const event = matching.at(-1)?.closest(".msg-s-event-with-indicator");
    const indicator = event?.querySelector(".msg-s-event-with-indicator__sending-indicator--sent");
    return {
      confirmed: Boolean(indicator),
      indicator: indicator ? "sent_indicator" : null,
      sentAt: indicator?.getAttribute("title") ?? new Date().toISOString()
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
