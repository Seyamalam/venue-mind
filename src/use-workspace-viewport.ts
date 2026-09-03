import { useSyncExternalStore } from "react";
import { classifyWorkspaceViewport, type WorkspaceViewportMode } from "./browser-platform";

const subscribe = (listener: () => void): (() => void) => {
  const coarsePointer = globalThis.matchMedia("(pointer: coarse)");
  globalThis.addEventListener("resize", listener, { passive: true });
  coarsePointer.addEventListener("change", listener);
  return () => {
    globalThis.removeEventListener("resize", listener);
    coarsePointer.removeEventListener("change", listener);
  };
};
const getSnapshot = (): WorkspaceViewportMode =>
  classifyWorkspaceViewport(
    globalThis.innerWidth,
    globalThis.matchMedia("(pointer: coarse)").matches ? "coarse" : "fine",
  );
const getServerSnapshot = (): WorkspaceViewportMode => "desktop";

export const useWorkspaceViewport = (): WorkspaceViewportMode =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
