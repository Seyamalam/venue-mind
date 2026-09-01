"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="route-state" role="alert">
          <strong>ERROR</strong>
          <button type="button" onClick={reset}>RETRY</button>
        </main>
      </body>
    </html>
  );
}
