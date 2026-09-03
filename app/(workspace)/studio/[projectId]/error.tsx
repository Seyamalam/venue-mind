"use client";

import { Button } from "@/components/ui/button";
import { RouteState } from "@/components/route-state";

export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteState state="invalid" label="STUDIO ERROR" action={<Button type="button" variant="outline" onClick={reset}>RETRY</Button>} />;
}
