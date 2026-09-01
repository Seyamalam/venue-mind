"use client";

import { Button } from "@/components/ui/button";

export default function ShareError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state" role="alert"><strong>REVIEW ERROR</strong><Button type="button" variant="outline" onClick={reset}>RETRY</Button></main>;
}
