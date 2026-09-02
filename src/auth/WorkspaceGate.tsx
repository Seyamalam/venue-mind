import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createAccountStore } from "./account-store";
import type { ReadyAccountSnapshot, WorkspaceGateProps } from "../ui-types";
import "./workspace-gate.css";

export function WorkspaceGate({ children }: WorkspaceGateProps) {
  const store = useMemo(() => createAccountStore(), []);
  const account = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.load();
  }, [store]);
  if (account.status === "loading")
    return (
      <div className="workspace-gate" role="status">
        <strong>SYNC</strong>
      </div>
    );
  if (account.status === "unauthenticated")
    return (
      <div className="workspace-gate" role="status">
        <strong>AUTH</strong>
        <code>{account.errorCode}</code>
      </div>
    );
  if (!account.user || !account.activeOrganizationId)
    return (
      <div className="workspace-gate" role="status">
        <strong>ACCOUNT</strong>
      </div>
    );
  const readyAccount: ReadyAccountSnapshot = {
    ...account,
    status: "ready",
    user: account.user,
    activeOrganizationId: account.activeOrganizationId,
  };
  return children({ account: readyAccount, accountStore: store, organizationId: account.activeOrganizationId });
}
