"use client";

import dynamic from "next/dynamic";

const SharedReview = dynamic(() => import("@/src/SharedReview.jsx").then((module) => module.SharedReview), {
  ssr: false,
  loading: () => <div className="route-state" role="status"><strong>REVIEW</strong></div>,
});

export function SharedReviewRoute({ token }: { token: string }) {
  return <SharedReview token={token} />;
}
