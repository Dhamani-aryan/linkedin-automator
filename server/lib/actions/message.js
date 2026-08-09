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

  const resolved = renderTemplate(action.template ?? "", lead, { missingVariable: "empty" });
  return {
    outcome: "dry_run_ok",
    event: "would_send_message",
    detail: {
      actionType: "message",
      page,
      messageState: classification.messageState,
      resolvedText: resolved.text,
      missingVariables: resolved.missing
    }
  };
}

async function readMessageEligibility(session) {
  return await evaluate(session, (selectorsInput) => {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const buttons = [...document.querySelectorAll('button, a[role="button"]')].map((button) => ({
      text: (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
      aria: (button.getAttribute("aria-label") ?? "").toLowerCase()
    }));
    const hasMessage = buttons.some((button) =>
      button.text.includes(selectorsInput.messageButtonText) || button.aria.includes(selectorsInput.messageButtonText)
    );

    if (document.querySelector(selectorsInput.loginForm) || /\/login|authwall/i.test(location.href)) {
      return { pageKind: "login_wall", errorCode: "LINKEDIN_LOGGED_OUT", url: location.href, title: document.title };
    }

    if (/checkpoint|challenge/i.test(location.href) || text.includes("security verification")) {
      return { pageKind: "challenge", errorCode: "AUTH_CHALLENGE", url: location.href, title: document.title };
    }

    if (!/linkedin\.com\/(in|sales\/lead)\//i.test(location.href)) {
      return { pageKind: "unknown", errorCode: "LAYOUT_MISMATCH", url: location.href, title: document.title };
    }

    return {
      pageKind: "profile",
      messageState: hasMessage ? "message_available" : "message_unavailable",
      url: location.href,
      title: document.title
    };
  }, [selectors]);
}
