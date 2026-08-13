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

export async function checkConnectionAcceptance({ session, lead }) {
  const page = await navigate(session, lead.linkedinUrl, { timeoutMs: 25_000 });
  const classification = await readConnectionPage(session);
  if (classification.pageKind !== "profile") {
    return {
      status: "needs_review",
      errorCode: classification.errorCode ?? ErrorCodes.LAYOUT_MISMATCH,
      detail: sanitizeConnectionDetail({ ...classification, page })
    };
  }
  if (classification.connectionState === "connected") {
    return {
      status: "accepted",
      detail: sanitizeConnectionDetail({ ...classification, page, source: "profile_connection_check" })
    };
  }
  if (classification.connectionState === "pending") {
    return {
      status: "pending",
      detail: sanitizeConnectionDetail({ ...classification, page, source: "profile_connection_check" })
    };
  }
  return {
    status: "needs_review",
    errorCode: ErrorCodes.AMBIGUOUS_OUTCOME,
    detail: sanitizeConnectionDetail({
      ...classification,
      page,
      source: "profile_connection_check",
      reason: classification.connectionState === "connect_available"
        ? "The invitation is no longer pending, but the profile is not a confirmed first-degree connection."
        : "The profile did not expose a reliable accepted or pending connection state."
    })
  };
}

export async function readConnectionPage(session) {
  return await evaluate(session, (selectorsInput) => {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const buttons = [...document.querySelectorAll('button, a[role="button"], a[href]')]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && rect.top >= 60 && rect.top < Math.min(innerHeight, 760) &&
          style.display !== "none" && style.visibility !== "hidden";
      })
      .map((button) => ({
        text: (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
        aria: (button.getAttribute("aria-label") ?? "").toLowerCase(),
        href: (button.getAttribute("href") ?? "").toLowerCase()
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

    const degreeMarker = [...document.querySelectorAll("main span, main div")]
      .filter((element) => {
        const normalized = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!/^(?:·\s*)?1st(?: degree connection)?$/.test(normalized)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 60 && rect.top < 700;
      })[0];
    const hasPending = hasText(selectorsInput.pendingButtonText);
    const hasMessage = buttons.some((button) =>
      button.text === selectorsInput.messageButtonText ||
      button.aria.startsWith(selectorsInput.messageButtonText) ||
      button.href.includes("/messaging/compose/")
    );
    const hasConnect = buttons.some((button) =>
      button.text === selectorsInput.connectButtonText || button.aria.startsWith(selectorsInput.connectButtonText)
    );

    let connectionState = "unknown";
    let evidence = null;
    if (hasPending) {
      connectionState = "pending";
      evidence = "pending_control";
    } else if (degreeMarker) {
      connectionState = "connected";
      evidence = "first_degree_marker";
    } else if (hasMessage) {
      connectionState = "connected";
      evidence = "profile_message_control";
    } else if (hasConnect) {
      connectionState = "connect_available";
      evidence = "connect_control";
    }

    return {
      pageKind: "profile",
      connectionState,
      evidence,
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
