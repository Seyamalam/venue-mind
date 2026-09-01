"use client";

import { App } from "@/src/App.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function StudioRuntime({ projectId }: { projectId: string }) {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace: Workspace) => <App {...workspace} projectId={projectId} navigate={navigate} />}</WorkspaceGate>;
}
