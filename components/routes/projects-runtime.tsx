"use client";

import { ProjectDashboard } from "@/src/ProjectDashboard.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function ProjectsRuntime() {
  return <WorkspaceGate>{(workspace: Workspace) => <ProjectDashboard {...workspace} />}</WorkspaceGate>;
}
