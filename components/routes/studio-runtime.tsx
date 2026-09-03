"use client";

import { App } from "@/src/App";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

export function StudioRuntime({ projectId }: { projectId: string }) {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace) => <App {...workspace} projectId={projectId} navigate={navigate} />}</WorkspaceGate>;
}
