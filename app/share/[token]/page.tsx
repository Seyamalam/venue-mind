import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedReviewRoute } from "@/components/routes/shared-review-route";

export const metadata: Metadata = {
  title: "Shared Review",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  return <SharedReviewRoute token={token} />;
}
