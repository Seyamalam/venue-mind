"use client";

import { Button } from "@/components/ui/button";
import { RouteState } from "@/components/route-state";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <RouteState
          state="invalid"
          label="ERROR"
          action={<Button type="button" variant="outline" onClick={reset}>RETRY</Button>}
        />
      </body>
    </html>
  );
}
