"use client";

import dynamic from "next/dynamic";

const Studio = dynamic(() => import("./studio-runtime").then((module) => module.StudioRuntime), {
  ssr: false,
  loading: () => <RouteStatus label="STUDIO" />,
});
const Projects = dynamic(() => import("./projects-runtime").then((module) => module.ProjectsRuntime), {
  ssr: false,
  loading: () => <RouteStatus label="PROJECTS" />,
});
const Settings = dynamic(() => import("./settings-runtime").then((module) => module.SettingsRuntime), {
  ssr: false,
  loading: () => <RouteStatus label="SETTINGS" />,
});

function RouteStatus({ label }: { label: string }) {
  return <div className="route-state" role="status"><strong>{label}</strong></div>;
}

export function StudioRoute({ projectId }: { projectId: string }) {
  return <Studio projectId={projectId} />;
}

export function ProjectsRoute() {
  return <Projects />;
}

export function SettingsRoute() {
  return <Settings />;
}
