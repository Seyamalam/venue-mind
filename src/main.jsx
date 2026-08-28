import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { DocsApp } from "./DocsApp.jsx";
import { ProjectDashboard } from "./ProjectDashboard.jsx";
import { WorkspaceGate } from "./auth/WorkspaceGate.jsx";
import { OrganizationSettings } from "./OrganizationSettings.jsx";
import { SharedReview } from "./SharedReview.jsx";
import "./styles.css";

const projectId = window.location.pathname.startsWith("/studio/") ? decodeURIComponent(window.location.pathname.slice("/studio/".length)) : "project-summit-forward";
const sharedToken = window.location.pathname.startsWith("/share/") ? decodeURIComponent(window.location.pathname.slice("/share/".length)) : null;
const RootApp = sharedToken ? SharedReview : window.location.pathname.startsWith("/docs") ? DocsApp : window.location.pathname === "/projects" ? ProjectDashboard : window.location.pathname.startsWith("/settings") ? OrganizationSettings : App;
const root = RootApp === SharedReview
  ? <SharedReview token={sharedToken} />
  : RootApp === DocsApp
  ? <DocsApp />
  : <WorkspaceGate>{(workspace) => <RootApp {...workspace} {...(RootApp === App ? { projectId } : {})} />}</WorkspaceGate>;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>,
);
