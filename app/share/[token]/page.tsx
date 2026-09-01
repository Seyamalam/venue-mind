import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedReview } from "@/src/SharedReview";

export const metadata: Metadata = {
  title: "Shared Review",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  return <SharedReview token={token} />;
}
