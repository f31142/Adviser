import { useSyncExternalStore } from "react";

const views = new Set([
  "services",
  "auth",
  "orders",
  "detail",
  "members",
  "settings",
  "notices",
  "account",
  "policies",
]);
export type AppRoute = {
  view: string;
  order: string;
  mode: "login" | "register";
  service: string;
};
export function readRoute(location: string): AppRoute {
  const url = new URL(location, "http://localhost");
  const params = url.searchParams;
  let view = params.get("view") || "services";
  if (!views.has(view)) view = "services";
  const order = view === "detail" ? params.get("order") || "" : "";
  if (view === "detail" && !order) view = "orders";
  return {
    view,
    order,
    mode: params.get("mode") === "register" ? "register" : "login",
    service: ["edit", "write"].includes(params.get("service") || "")
      ? params.get("service")!
      : "",
  };
}
export function routeUrl(route: AppRoute) {
  const params = new URLSearchParams();
  if (route.view !== "services") params.set("view", route.view);
  if (route.view === "detail" && route.order) params.set("order", route.order);
  if (route.view === "auth") {
    if (route.mode === "register") params.set("mode", route.mode);
    if (route.service) params.set("service", route.service);
  }
  return params.size ? "/?" + params.toString() : "/";
}
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
function snapshot() {
  return window.location.pathname + window.location.search;
}
export function useAppRoute() {
  const location = useSyncExternalStore(subscribe, snapshot, () => "/");
  return readRoute(location);
}
export function writeRoute(route: AppRoute, replace = false) {
  const url = routeUrl(route);
  if (snapshot() === url) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
