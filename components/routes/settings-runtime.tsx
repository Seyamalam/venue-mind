"use client";

import { OrganizationSettings } from "@/src/OrganizationSettings.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function SettingsRuntime() {
  return <WorkspaceGate>{(workspace: Workspace) => <OrganizationSettings {...workspace} />}</WorkspaceGate>;
}
