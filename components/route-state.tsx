import type { ReactNode } from "react";

export const ROUTE_STATE_KINDS = ["loading", "empty", "offline", "conflict", "invalid", "disabled"] as const;
export type RouteStateKind = (typeof ROUTE_STATE_KINDS)[number];

export function RouteState({
  state,
  label,
  detail,
  action,
  role = state === "invalid" || state === "conflict" ? "alert" : "status",
}: Readonly<{
  state: RouteStateKind;
  label: string;
  detail?: string;
  action?: ReactNode;
  role?: "alert" | "main" | "status";
}>) {
  return (
    <main className="route-state" data-state={state} role={role} aria-live={role === "status" ? "polite" : undefined}>
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </main>
  );
}
