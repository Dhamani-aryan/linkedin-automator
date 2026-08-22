import type { CampaignOutcomeKey } from "./campaignMetrics";

export type ManagerPage = "profiles" | "settings";
export type WorkspaceRouteTab = "workflow" | "leads" | "browser" | "safety";
export type WorkspaceLeadFilter = CampaignOutcomeKey;

export type AppRoute =
  | { kind: "manager"; page: ManagerPage }
  | { kind: "campaigns"; profileId: string }
  | { kind: "workspace"; profileId: string; campaignId?: string; tab: WorkspaceRouteTab; leadFilter?: WorkspaceLeadFilter };

const workspaceTabs = new Set<WorkspaceRouteTab>(["workflow", "leads", "browser", "safety"]);
const workspaceLeadFilters = new Set<WorkspaceLeadFilter>(["invited", "accepted", "messaged", "replied", "failed"]);

export function readAppRoute(hash = window.location.hash): AppRoute {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

  if (segments[0] === "workspace" && segments[1]) {
    const legacyTab = segments[2] as WorkspaceRouteTab | undefined;
    const usesLegacyRoute = Boolean(legacyTab && workspaceTabs.has(legacyTab));
    const candidateTab = segments[usesLegacyRoute ? 2 : 3] as WorkspaceRouteTab | undefined;
    const tab = candidateTab && workspaceTabs.has(candidateTab) ? candidateTab : "workflow";
    const candidateLeadFilter = segments[usesLegacyRoute ? 3 : 4] as WorkspaceLeadFilter | undefined;
    const leadFilter = tab === "leads" && candidateLeadFilter && workspaceLeadFilters.has(candidateLeadFilter)
      ? candidateLeadFilter
      : undefined;
    return {
      kind: "workspace",
      profileId: segments[1],
      campaignId: usesLegacyRoute ? undefined : segments[2],
      tab,
      ...(leadFilter ? { leadFilter } : {})
    };
  }

  if (segments[0] === "profiles" && segments[1] && segments[2] === "campaigns") {
    return { kind: "campaigns", profileId: segments[1] };
  }

  if (segments[0] === "settings") {
    return { kind: "manager", page: segments[0] };
  }

  return { kind: "manager", page: "profiles" };
}

export function routeToHash(route: AppRoute): string {
  if (route.kind === "workspace") {
    const campaignSegment = route.campaignId ? `/${encodeURIComponent(route.campaignId)}` : "";
    const leadFilterSegment = route.tab === "leads" && route.leadFilter ? `/${route.leadFilter}` : "";
    return `#/workspace/${encodeURIComponent(route.profileId)}${campaignSegment}/${route.tab}${leadFilterSegment}`;
  }
  if (route.kind === "campaigns") return `#/profiles/${encodeURIComponent(route.profileId)}/campaigns`;
  return route.page === "profiles" ? "#/profiles" : `#/${route.page}`;
}
