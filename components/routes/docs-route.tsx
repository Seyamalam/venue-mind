"use client";

import dynamic from "next/dynamic";

const Docs = dynamic(() => import("@/src/DocsApp.jsx").then((module) => module.DocsApp), {
  ssr: false,
  loading: () => <div className="route-state" role="status"><strong>DOCS</strong></div>,
});

export function DocsRoute() {
  return <Docs />;
}
