"use client";

import { Button } from "@/components/ui/button";

export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="route-state" role="alert"><strong>STUDIO ERROR</strong><Button type="button" variant="outline" onClick={reset}>RETRY</Button></div>;
}
