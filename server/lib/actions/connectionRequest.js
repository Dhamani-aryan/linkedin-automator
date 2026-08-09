import { evaluate, navigate } from "../browserSession.js";
import { ErrorCodes } from "../errors.js";
import { renderTemplate } from "../template.js";
import { sanitizeSnippet, selectors } from "./selectors.js";

export async function executeConnectionRequest({ session, lead, action, mode }) {
  if (mode !== "dry_run") {
    return {
      outcome: "needs_review",
      errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
      detail: { reason: "Live connection requests require the controlled verification gate." }
    };
  }

  const page = await navigate(session, lead.linkedinUrl, { timeoutMs: 25_000 });
  const classification = await readConnectionPage(session);

  if (classification.pageKind !== "profile") {
    return {
      outcome: "needs_review",
      errorCode: classification.errorCode ?? ErrorCodes.LAYOUT_MISMATCH,
      detail: classification
    };
  }

  const resolved = renderTemplate(action.template ?? "", lead, { missingVariable: "empty" });
  return {
    outcome: "dry_run_ok",
    event: "would_send_connection_request",
    detail: {
      actionType: "connection_request",
      page,
      connectionState: classification.connectionState,
      resolvedNote: trimConnectionNote(resolved.text),
      missingVariables: resolved.missing
    }
  };
}

async function readConnectionPage(session) {
  return await evaluate(session, (selectorsInput) => {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const buttons = [...document.querySelectorAll('button, a[role="button"]')].map((button) => ({
      text: (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
      aria: (button.getAttribute("aria-label") ?? "").toLowerCase()
    }));
    const hasText = (needle) => buttons.some((button) => button.text.includes(needle) || button.aria.includes(needle));

    if (document.querySelector(selectorsInput.loginForm) || /\/login|authwall/i.test(location.href)) {
      return { pageKind: "login_wall", errorCode: "LINKEDIN_LOGGED_OUT", url: location.href, title: document.title };
    }

    if (/checkpoint|challenge/i.test(location.href) || text.includes("security verification")) {
      return { pageKind: "challenge", errorCode: "AUTH_CHALLENGE", url: location.href, title: document.title };
    }

    if (!/linkedin\.com\/(in|sales\/lead)\//i.test(location.href)) {
      return {
        pageKind: "unknown",
        errorCode: "LAYOUT_MISMATCH",
        url: location.href,
        title: document.title,
        snippet: document.querySelector("main")?.outerHTML?.slice(0, 2000) ?? ""
      };
    }

    let connectionState = "unknown";
    if (text.includes("1st degree connection") || text.includes("1st")) connectionState = "connected";
    if (hasText(selectorsInput.messageButtonText)) connectionState = "connected";
    if (hasText(selectorsInput.pendingButtonText)) connectionState = "pending";
    if (hasText(selectorsInput.connectButtonText)) connectionState = "connect_available";

    return {
      pageKind: "profile",
      connectionState,
      url: location.href,
      title: document.title,
      snippet: document.querySelector("main")?.outerHTML?.slice(0, 2000) ?? ""
    };
  }, [selectors]);
}

function trimConnectionNote(note) {
  return note.length > 300 ? note.slice(0, 300) : note;
}

export function sanitizeConnectionDetail(detail) {
  return {
    ...detail,
    snippet: detail.snippet ? sanitizeSnippet(detail.snippet) : undefined
  };
}
