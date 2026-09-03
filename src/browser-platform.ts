export const SUPPORTED_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ minimumWidth: 1024, minimumHeight: 720, editing: true, approval: true }),
  tablet: Object.freeze({ minimumWidth: 768, minimumHeight: 900, editing: false, approval: true }),
  mobile: Object.freeze({ minimumWidth: 360, minimumHeight: 640, editing: false, approval: false }),
});

export type WorkspaceViewportMode = keyof typeof SUPPORTED_VIEWPORTS;
export type WorkspacePrimaryPointer = "coarse" | "fine";

export const classifyWorkspaceViewport = (
  width: number,
  primaryPointer: WorkspacePrimaryPointer = "coarse",
): WorkspaceViewportMode => {
  if (!Number.isFinite(width) || width < SUPPORTED_VIEWPORTS.mobile.minimumWidth) return "mobile";
  // A narrow fine-pointer viewport can be a desktop browser at 200% zoom. Keep
  // the desktop command set mounted while CSS reflows the workspace.
  if (primaryPointer === "fine") return "desktop";
  if (width < SUPPORTED_VIEWPORTS.tablet.minimumWidth) return "mobile";
  if (width < SUPPORTED_VIEWPORTS.desktop.minimumWidth) return "tablet";
  return "desktop";
};

export const SUPPORTED_BROWSERS = Object.freeze([
  Object.freeze({ family: "Chromium", minimumVersion: 131, webMcp: "detected" as const }),
  Object.freeze({ family: "Safari", minimumVersion: 18, webMcp: "fallback" as const }),
  Object.freeze({ family: "Firefox", minimumVersion: 133, webMcp: "fallback" as const }),
]);

interface BrowserCapabilityEnvironment {
  readonly document?: Pick<Document, "body" | "createElement" | "execCommand"> & {
    readonly modelContext?: { readonly registerTool?: unknown };
  };
  readonly navigator?: {
    readonly clipboard?: {
      readonly readText?: () => Promise<string>;
      readonly writeText?: (text: string) => Promise<void>;
    };
  };
  readonly URL?: {
    readonly createObjectURL?: (object: Blob | MediaSource) => string;
    readonly revokeObjectURL?: (url: string) => void;
  };
  readonly indexedDB?: unknown;
  readonly localStorage?: unknown;
  readonly print?: () => void;
  readonly devicePixelRatio?: number;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

export interface BrowserCapabilities {
  readonly webMcp: "available" | "fallback";
  readonly clipboardRead: boolean;
  readonly clipboardWrite: "native" | "legacy" | "unavailable";
  readonly download: boolean;
  readonly print: boolean;
  readonly localRecovery: "indexeddb" | "local-storage" | "memory";
  readonly pointer: "coarse" | "fine";
  readonly density: "standard" | "high";
}

export function detectBrowserCapabilities(environment: BrowserCapabilityEnvironment): BrowserCapabilities {
  const clipboard = environment.navigator?.clipboard;
  const nativeClipboardWrite = typeof clipboard?.writeText === "function";
  const legacyClipboardWrite =
    typeof environment.document?.createElement === "function" && typeof environment.document.execCommand === "function";
  return Object.freeze({
    webMcp:
      typeof environment.document?.modelContext?.registerTool === "function" ? "available" : "fallback",
    clipboardRead: typeof clipboard?.readText === "function",
    clipboardWrite: nativeClipboardWrite ? "native" : legacyClipboardWrite ? "legacy" : "unavailable",
    download:
      typeof environment.URL?.createObjectURL === "function" &&
      typeof environment.URL.revokeObjectURL === "function" &&
      typeof environment.document?.createElement === "function",
    print: typeof environment.print === "function",
    localRecovery:
      environment.indexedDB !== undefined
        ? "indexeddb"
        : environment.localStorage !== undefined
          ? "local-storage"
          : "memory",
    pointer: environment.matchMedia?.("(pointer: coarse)").matches === true ? "coarse" : "fine",
    density: (environment.devicePixelRatio ?? 1) >= 1.5 ? "high" : "standard",
  });
}

export async function writeClipboardText(
  text: string,
  environment: Pick<BrowserCapabilityEnvironment, "document" | "navigator"> = globalThis,
): Promise<BrowserCapabilities["clipboardWrite"]> {
  const clipboard = environment.navigator?.clipboard;
  if (typeof clipboard?.writeText === "function") {
    await clipboard.writeText(text);
    return "native";
  }
  const browserDocument = environment.document;
  if (!browserDocument) return "unavailable";
  const textarea = browserDocument.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  browserDocument.body.append(textarea);
  textarea.select();
  const copied = browserDocument.execCommand("copy");
  textarea.remove();
  return copied ? "legacy" : "unavailable";
}

export const requestBrowserPrint = (environment: Pick<BrowserCapabilityEnvironment, "print"> = globalThis): boolean => {
  if (typeof environment.print !== "function") return false;
  environment.print();
  return true;
};
