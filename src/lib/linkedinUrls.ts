export type LinkedInProfileUrlKind = "linkedin_profile" | "sales_navigator_lead";

export type ParsedLinkedInProfileUrl = {
  url: string;
  kind: LinkedInProfileUrlKind;
};

const profileUrlPattern = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|sales\/lead)\/[^\s,"'<>]+/gi;

export function parseLinkedInProfileUrls(value: string): ParsedLinkedInProfileUrl[] {
  const matches = value.match(profileUrlPattern) ?? [];
  const parsed = matches
    .map((match) => normalizeLinkedInProfileUrl(match))
    .filter((candidate): candidate is ParsedLinkedInProfileUrl => candidate !== null);

  return Array.from(new Map(parsed.map((candidate) => [candidate.url.toLowerCase(), candidate])).values());
}

export function normalizeLinkedInProfileUrl(value: string): ParsedLinkedInProfileUrl | null {
  const cleaned = value.trim().replace(/[)\]};,.]+$/, "");
  if (!cleaned) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) return null;

    const isLinkedInProfile = /^\/in\/[^/]+/i.test(parsed.pathname);
    const isSalesLead = /^\/sales\/lead\/[^/]+/i.test(parsed.pathname);
    if (!isLinkedInProfile && !isSalesLead) return null;

    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return {
      url: `https://www.linkedin.com${pathname}`,
      kind: isSalesLead ? "sales_navigator_lead" : "linkedin_profile"
    };
  } catch {
    return null;
  }
}

export function normalizeSalesNavigatorSourceUrl(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    const hostname = parsed.hostname.toLowerCase();
    const isLinkedIn = hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
    const isSupportedPath =
      /^\/sales\/search\/people/i.test(parsed.pathname) ||
      /^\/sales\/lists\/people/i.test(parsed.pathname) ||
      /^\/sales\/lead\/[^/]+/i.test(parsed.pathname);

    if (!isLinkedIn || !isSupportedPath) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
