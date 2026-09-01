"use client";

import { OrganizationSettings } from "@/src/OrganizationSettings.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function SettingsRuntime() {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace: Workspace) => <OrganizationSettings {...workspace} navigate={navigate} />}</WorkspaceGate>;
}
