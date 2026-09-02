import type { MouseEvent } from "react";

export type Navigate = (href: string) => void;

export const browserNavigate = (href: string): void => {
  if (typeof window === "undefined") return;
  window.location.assign(href);
};

export const navigateInternalLink = (event: MouseEvent<HTMLAnchorElement>, navigate: Navigate, href: string): void => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target === "_blank"
  )
    return;

  event.preventDefault();
  navigate(href);
};
