"use client";

export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="route-state" role="alert"><strong>STUDIO ERROR</strong><button type="button" onClick={reset}>RETRY</button></div>;
}
