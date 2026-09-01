"use client";

import { App } from "@/src/App.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function StudioRuntime({ projectId }: { projectId: string }) {
  return <WorkspaceGate>{(workspace: Workspace) => <App {...workspace} projectId={projectId} />}</WorkspaceGate>;
}
