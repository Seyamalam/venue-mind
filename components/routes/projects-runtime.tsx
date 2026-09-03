"use client";

import { ProjectDashboard } from "@/src/ProjectDashboard";
import { WorkspaceGate } from "@/src/auth/WorkspaceGate";
import { useWorkspaceNavigation } from "./use-workspace-navigation";

export function ProjectsRuntime() {
  const navigate = useWorkspaceNavigation();
  return <WorkspaceGate>{(workspace) => <ProjectDashboard {...workspace} navigate={navigate} />}</WorkspaceGate>;
}
