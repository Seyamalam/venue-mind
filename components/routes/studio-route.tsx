"use client";

import dynamic from "next/dynamic";

const Studio = dynamic(() => import("./studio-runtime").then((module) => module.StudioRuntime), {
  ssr: false,
  loading: () => <div className="route-state" role="status"><strong>STUDIO</strong></div>,
});

export function StudioRoute({ projectId }: { projectId: string }) {
  return <Studio projectId={projectId} />;
}
