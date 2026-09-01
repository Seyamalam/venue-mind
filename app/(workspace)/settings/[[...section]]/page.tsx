import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsRoute } from "@/components/routes/workspace-routes";

export const metadata: Metadata = { title: "Settings" };
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ section: [] }, { section: ["organization"] }];
}

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  if (section.length > 1 || (section[0] && section[0] !== "organization")) notFound();
  return <SettingsRoute />;
}
