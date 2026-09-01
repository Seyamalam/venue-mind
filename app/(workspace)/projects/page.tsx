import type { Metadata } from "next";
import { ProjectsRoute } from "@/components/routes/workspace-routes";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsRoute />;
}
