"use client";

import { OrganizationSettings } from "@/src/OrganizationSettings";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

export function SettingsRuntime() {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace) => <OrganizationSettings {...workspace} navigate={navigate} />}</WorkspaceGate>;
}
