export const browserNavigate = (href: any) => {
  if (typeof window === "undefined") return;
  window.location.assign(href);
};

export const navigateInternalLink = (event: any, navigate: any, href: any) => {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || event.currentTarget?.target === "_blank"
  ) return;

  event.preventDefault();
  navigate(href);
};
