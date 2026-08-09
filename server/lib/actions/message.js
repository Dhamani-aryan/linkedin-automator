import { evaluate, navigate } from "../browserSession.js";
import { ErrorCodes } from "../errors.js";
import { renderTemplate } from "../template.js";
import { selectors } from "./selectors.js";

export async function executeMessage({ session, lead, action, mode }) {
  if (mode !== "dry_run") {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
      detail: { reason: "Live messages require the controlled verification gate." }
    };
  }

  const page = await navigate(session, lead.linkedinUrl, { timeoutMs: 25_000 });
  const classification = await readMessageEligibility(session);

  if (classification.pageKind !== "profile") {
    return {
      outcome: "needs_review",
      errorCode: classification.errorCode ?? ErrorCodes.LAYOUT_MISMATCH,
      detail: classification
    };
  }

  if (!["message_available", "message_available_under_more"].includes(classification.messageState)) {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.ELEMENT_NOT_FOUND,
      detail: {
        ...classification,
        reason: "No visible Message button was found on the profile. The runner cannot message this lead."
      }
    };
  }

  const resolved = renderTemplate(action.template ?? "", lead, { missingVariable: "empty" });
  return {
    outcome: "dry_run_ok",
    event: "would_send_message",
    detail: {
      actionType: "message",
      page,
      messageState: classification.messageState,
      matchedControl: classification.matchedControl,
      inspectedAfterMs: classification.inspectedAfterMs,
      resolvedText: resolved.text,
      missingVariables: resolved.missing
    }
  };
}

async function readMessageEligibility(session) {
  return await evaluate(session, async (selectorsInput) => {
    const startedAt = Date.now();
    const hydrationTimeoutMs = 8_000;
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const readControls = () => [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].map((control) => ({
      text: (control.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
      aria: (control.getAttribute("aria-label") ?? "").toLowerCase(),
      href: (control.getAttribute("href") ?? "").toLowerCase(),
      element: control
    }));
    const isMessageControl = (control) =>
      control.text === selectorsInput.messageButtonText ||
      control.aria.startsWith(selectorsInput.messageButtonText) ||
      control.href.includes("/messaging/compose/");
    const findPrimaryMessageControl = () => {
      const preferred = [...document.querySelectorAll(selectorsInput.profileMessageControl)]
        .map((element) => readControl(element))
        .find(isMessageControl);
      if (preferred) return preferred;

      return readControls()
        .filter((control) => control.element.matches('button, a[role="button"]'))
        .find(isMessageControl);
    };
    const readControl = (control) => ({
      text: (control.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
      aria: (control.getAttribute("aria-label") ?? "").toLowerCase(),
      href: (control.getAttribute("href") ?? "").toLowerCase(),
      element: control
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

    let messageState = messageControl ? "message_available" : "message_unavailable";
    let matchedControl = messageControl?.href.includes("/messaging/compose/") ? "compose_link" :
      messageControl ? "labeled_control" : null;
    if (!messageControl) {
      const preferredMore = document.querySelector(selectorsInput.profileOverflowControl);
      const moreButton = preferredMore ?? readControls().find((control) =>
        control.text === selectorsInput.moreButtonText ||
        control.aria === selectorsInput.moreButtonText
      )?.element;
      if (moreButton instanceof HTMLElement) {
        moreButton.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const menuHasMessage = readControls()
          .filter((control) => control.element.matches('[role="menuitem"], [role="button"], button, a'))
          .some(isMessageControl);
        if (menuHasMessage) {
          messageState = "message_available_under_more";
          matchedControl = "overflow_menu";
        }
      }
    }

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
