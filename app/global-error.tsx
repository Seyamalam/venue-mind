"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="route-state" role="alert">
          <strong>ERROR</strong>
          <Button type="button" variant="outline" onClick={reset}>RETRY</Button>
        </main>
      </body>
    </html>
  );
}
