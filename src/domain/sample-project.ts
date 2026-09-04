export const SAMPLE_PROJECT_ROUTE = "project-summit-forward";

/** Project IDs are globally unique in D1; the sample route is local to an Organization. */
export function resolveStudioProjectId(projectId: string, organizationId: string): string {
  if (!organizationId.trim()) throw new TypeError("Sample Project requires an Organization ID");
  return projectId === SAMPLE_PROJECT_ROUTE ? `${SAMPLE_PROJECT_ROUTE}-${organizationId}` : projectId;
}

export function isSampleProject(projectId: string, organizationId: string): boolean {
  return (
    projectId === SAMPLE_PROJECT_ROUTE || projectId === resolveStudioProjectId(SAMPLE_PROJECT_ROUTE, organizationId)
  );
}
