"use client";

import { Button } from "@/components/ui/button";
import { RouteState } from "@/components/route-state";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteState state="invalid" label="WORKSPACE ERROR" action={<Button type="button" variant="outline" onClick={reset}>RETRY</Button>} />;
}
