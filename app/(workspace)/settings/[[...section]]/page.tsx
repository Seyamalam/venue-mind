import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsRuntime } from "@/components/routes/settings-runtime";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return [{ section: [] }, { section: ["organization"] }];
}

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  if (section.length > 1 || (section[0] && section[0] !== "organization")) notFound();
  return <SettingsRuntime />;
}
