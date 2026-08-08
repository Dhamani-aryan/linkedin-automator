export type ManagerPage = "profiles" | "safety" | "settings";
export type WorkspaceRouteTab = "workflow" | "leads" | "browser";

export type AppRoute =
  | { kind: "manager"; page: ManagerPage }
  | { kind: "workspace"; profileId: string; tab: WorkspaceRouteTab };

const workspaceTabs = new Set<WorkspaceRouteTab>(["workflow", "leads", "browser"]);

export function readAppRoute(hash = window.location.hash): AppRoute {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

  if (segments[0] === "workspace" && segments[1]) {
    const candidateTab = segments[2] as WorkspaceRouteTab | undefined;
    return {
      kind: "workspace",
      profileId: segments[1],
      tab: candidateTab && workspaceTabs.has(candidateTab) ? candidateTab : "workflow"
    };
  }

  if (segments[0] === "safety" || segments[0] === "settings") {
    return { kind: "manager", page: segments[0] };
  }

  return { kind: "manager", page: "profiles" };
}

export function routeToHash(route: AppRoute): string {
  if (route.kind === "workspace") {
    return `#/workspace/${encodeURIComponent(route.profileId)}/${route.tab}`;
  }
  return route.page === "profiles" ? "#/profiles" : `#/${route.page}`;
}

