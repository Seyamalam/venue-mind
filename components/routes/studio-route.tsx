"use client";

import { StudioRuntime } from "./studio-runtime";

export function StudioRoute({ projectId }: { projectId: string }) {
  return <StudioRuntime projectId={projectId} />;
}
