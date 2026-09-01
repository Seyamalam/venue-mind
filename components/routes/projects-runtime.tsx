"use client";

import { ProjectDashboard } from "@/src/ProjectDashboard.jsx";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate.jsx";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

type Workspace = { account: unknown; accountStore: unknown; organizationId: string };

export function ProjectsRuntime() {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace: Workspace) => <ProjectDashboard {...workspace} navigate={navigate} />}</WorkspaceGate>;
}
