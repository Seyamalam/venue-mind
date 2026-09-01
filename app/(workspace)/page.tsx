import type { Metadata } from "next";
import { StudioRoute } from "@/components/routes/studio-route";

export const metadata: Metadata = { title: "Studio" };

export default function StudioHomePage() {
  return <StudioRoute projectId="project-summit-forward" />;
}
