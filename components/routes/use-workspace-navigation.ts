"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useWorkspaceNavigation() {
  const router = useRouter();
  return useCallback((href: string) => router.push(href as Route), [router]);
}
