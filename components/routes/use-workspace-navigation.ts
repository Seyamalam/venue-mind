"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface WorkspaceRouter {
  push(href: string): void;
}

const isWorkspaceRoute = (href: string): boolean =>
  href === "/" ||
  /^\/projects(?:[?#]|$)/u.test(href) ||
  /^\/studio\/[^/?#]+(?:[?#].*)?$/u.test(href) ||
  /^\/settings(?:[/?#]|$)/u.test(href);

const pushWorkspaceRoute = (router: WorkspaceRouter, href: string): void => {
  if (!isWorkspaceRoute(href)) throw new TypeError(`Invalid workspace route: ${href}`);
  router.push(href);
};

export function useWorkspaceNavigation() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      pushWorkspaceRoute(router, href);
    },
    [router],
  );
}
