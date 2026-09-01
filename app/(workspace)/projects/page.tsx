import type { Metadata } from "next";
import { ProjectsRuntime } from "@/components/routes/projects-runtime";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsRuntime />;
}
