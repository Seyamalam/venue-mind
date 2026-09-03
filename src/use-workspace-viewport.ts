import { useSyncExternalStore } from "react";
import { classifyWorkspaceViewport, type WorkspaceViewportMode } from "./browser-platform";

const subscribe = (listener: () => void): (() => void) => {
  globalThis.addEventListener("resize", listener, { passive: true });
  return () => globalThis.removeEventListener("resize", listener);
};
const getSnapshot = (): WorkspaceViewportMode => classifyWorkspaceViewport(globalThis.innerWidth);
const getServerSnapshot = (): WorkspaceViewportMode => "desktop";

export const useWorkspaceViewport = (): WorkspaceViewportMode =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
