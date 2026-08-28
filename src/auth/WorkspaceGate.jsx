import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createAccountStore } from "./account-store.js";

export function WorkspaceGate({ children }) {
  const store = useMemo(() => createAccountStore(), []);
  const account = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { void store.load(); }, [store]);
  if (account.status === "loading") return <div className="workspace-gate" role="status"><strong>SYNC</strong></div>;
  if (account.status === "unauthenticated") return <div className="workspace-gate" role="status"><strong>AUTH</strong><code>{account.errorCode}</code></div>;
  return children({ account, accountStore: store, organizationId: account.activeOrganizationId });
}
