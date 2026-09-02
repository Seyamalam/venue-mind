"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

const isWorkspaceRoute = (href: string): href is Route =>
  href === "/" ||
  /^\/projects(?:[?#]|$)/u.test(href) ||
  /^\/studio\/[^/?#]+(?:[?#].*)?$/u.test(href) ||
  /^\/settings(?:[/?#]|$)/u.test(href);

export function useWorkspaceNavigation() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      if (!isWorkspaceRoute(href)) throw new TypeError(`Invalid workspace route: ${href}`);
      router.push(href);
    },
    [router],
  );
}
