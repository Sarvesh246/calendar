export const TAB_ROUTES = ["/today", "/calendar", "/agenda"] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];

export function isTabRoute(path: string): path is TabRoute {
  return (TAB_ROUTES as readonly string[]).includes(path);
}
