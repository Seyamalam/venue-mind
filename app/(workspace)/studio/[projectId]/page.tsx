import type { Metadata } from "next";
import { StudioRoute } from "@/components/routes/studio-route";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <StudioRoute projectId={projectId} />;
}
