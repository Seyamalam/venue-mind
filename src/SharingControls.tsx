import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BellIcon as Bell, LinkSimpleIcon as LinkSimple } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Popover, PopoverTrigger } from "../components/ui/popover";
import {
  NOTIFICATION_EVENT_TYPES,
  normalizeNotificationPreferences,
  type NotificationEventType,
  type NotificationPreferences,
  type NotificationRefs,
  type ShareScope,
} from "./domain/sharing";
import type { NotificationView, ShareLinkView } from "./SharingPanels";

const loadSharingPanels = () => import("./SharingPanels");
const LazySharePopoverPanel = lazy(() => loadSharingPanels().then((module) => ({ default: module.SharePopoverPanel })));
const LazyNotificationPopoverPanel = lazy(() =>
  loadSharingPanels().then((module) => ({ default: module.NotificationPopoverPanel })),
);
type JsonRecord = { readonly [key: string]: unknown };
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
};
const optionalString = (value: unknown, field: string): string | null =>
  value === null || value === undefined ? null : requiredString(value, field);
const isShareScope = (value: unknown): value is ShareScope => value === "read-only" || value === "reviewer";
const isNotificationEventType = (value: unknown): value is NotificationEventType =>
  typeof value === "string" && NOTIFICATION_EVENT_TYPES.some((item) => item === value);
const json = async (response: Response): Promise<unknown> => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw Object.assign(new Error("API_UNAVAILABLE"), { code: "API_UNAVAILABLE" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = isRecord(body) && typeof body["error"] === "string" ? body["error"] : "REQUEST_FAILED";
    const code = isRecord(body) && typeof body["code"] === "string" ? body["code"] : "REQUEST_FAILED";
    throw Object.assign(new Error(error), { code });
  }
  return body;
};
const decodeShareLinks = (value: unknown): ShareLinkView[] => {
  if (!isRecord(value) || !Array.isArray(value["links"])) throw new Error("INVALID_SHARE_LINKS");
  return value["links"].map((item): ShareLinkView => {
    if (
      !isRecord(item) ||
      !isShareScope(item["scope"]) ||
      !["active", "expired", "revoked"].includes(String(item["status"]))
    )
      throw new Error("INVALID_SHARE_LINK");
    const status = item["status"];
    if (status !== "active" && status !== "expired" && status !== "revoked") throw new Error("INVALID_SHARE_LINK");
    return {
      id: requiredString(item["id"], "share_id"),
      scope: item["scope"],
      status,
      proposalId: optionalString(item["proposalId"], "proposal_id"),
    };
  });
};
const decodeRefs = (value: unknown): NotificationRefs => {
  if (!isRecord(value)) return {};
  const refs: NotificationRefs = {};
  for (const key of ["projectId", "proposalId", "planVersion", "conflictCode", "revision"] as const) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number") refs[key] = item;
  }
  return refs;
};
const decodeNotifications = (value: unknown): NotificationView[] => {
  if (!isRecord(value) || !Array.isArray(value["notifications"])) return [];
  return value["notifications"].map((item): NotificationView => {
    if (!isRecord(item) || !isNotificationEventType(item["eventType"])) throw new Error("INVALID_NOTIFICATION");
    return {
      id: requiredString(item["id"], "notification_id"),
      eventType: item["eventType"],
      refs: decodeRefs(item["refs"]),
      readAt: optionalString(item["readAt"], "read_at"),
    };
  });
};
const headers = (organizationId: string, extra: Record<string, string> = {}) => ({
  "x-venuemind-organization-id": organizationId,
  accept: "application/json",
  ...extra,
});

type SharingControlsProps = { projectId: string; organizationId: string; proposalId?: string; canManage?: boolean };

export function SharingControls({ projectId, organizationId, proposalId, canManage = false }: SharingControlsProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [notificationMounted, setNotificationMounted] = useState(false);
  const [links, setLinks] = useState<ShareLinkView[]>([]);
  const [scope, setScope] = useState<ShareScope>("reviewer");
  const [days, setDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState("");
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    inAppEnabled: true,
    emailEnabled: false,
    eventTypes: [],
  });
  const [status, setStatus] = useState("READY");

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setStatus("BUSY");
    try {
      const value = await operation();
      setStatus("READY");
      return value;
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "ERROR");
      return null;
    }
  }, []);
  const loadLinks = useCallback(async () => {
    setLinks(
      decodeShareLinks(
        await json(
          await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, {
            credentials: "same-origin",
            headers: headers(organizationId),
          }),
        ),
      ),
    );
  }, [organizationId, projectId]);
  const loadNotifications = useCallback(async () => {
    const [items, prefs] = await Promise.all([
      json(await fetch("/api/notifications", { credentials: "same-origin", headers: headers(organizationId) })),
      json(
        await fetch("/api/notification-preferences", { credentials: "same-origin", headers: headers(organizationId) }),
      ),
    ]);
    setNotifications(decodeNotifications(items));
    setPreferences(normalizeNotificationPreferences(prefs));
  }, [organizationId]);
  useEffect(() => {
    if (shareOpen && canManage) void Promise.resolve().then(() => run(loadLinks));
  }, [canManage, loadLinks, run, shareOpen]);
  useEffect(() => {
    void Promise.resolve().then(() => run(loadNotifications));
  }, [loadNotifications, run]);

  const create = async () => {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await run(async () => {
      const result = await json(
        await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, {
          method: "POST",
          credentials: "same-origin",
          headers: headers(organizationId, { "content-type": "application/json" }),
          body: JSON.stringify({ scope, ...(scope === "reviewer" ? { proposalId } : {}), expiresAt }),
        }),
      );
      if (!isRecord(result)) throw new Error("INVALID_SHARE_LINK");
      setCreatedUrl(`${window.location.origin}${requiredString(result["url"], "share_url")}`);
      await loadLinks();
    });
  };
  const revoke = async (id: string) => {
    await run(async () => {
      await json(
        await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(id)}/revoke`, {
          method: "POST",
          credentials: "same-origin",
          headers: headers(organizationId),
        }),
      );
      await loadLinks();
    });
  };
  const savePreferences = async (next: NotificationPreferences) => {
    const previous = preferences;
    setPreferences(next);
    const saved = await run(async () =>
      json(
        await fetch("/api/notification-preferences", {
          method: "PUT",
          credentials: "same-origin",
          headers: headers(organizationId, { "content-type": "application/json" }),
          body: JSON.stringify(next),
        }),
      ),
    );
    if (!saved) setPreferences(previous);
  };
  const toggleEvent = (eventType: string, enabled: boolean) => {
    if (!isNotificationEventType(eventType)) return;
    void savePreferences({
      ...preferences,
      eventTypes: enabled
        ? [...new Set([...preferences.eventTypes, eventType])]
        : preferences.eventTypes.filter((item) => item !== eventType),
    });
  };
  const markRead = async (notificationId: string) => {
    await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "POST",
      credentials: "same-origin",
      headers: headers(organizationId),
    });
    await loadNotifications();
  };

  return (
    <>
      {canManage && (
        <Popover
          open={shareOpen}
          onOpenChange={(open) => {
            if (open) setShareMounted(true);
            setShareOpen(open);
          }}
        >
          <div className="share-control">
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="header-button compact-control"
                type="button"
                aria-label="Share Project"
                onPointerEnter={() => {
                  void loadSharingPanels();
                }}
                onFocus={() => {
                  void loadSharingPanels();
                }}
              >
                <LinkSimple data-icon="inline-start" /> SHARE
              </Button>
            </PopoverTrigger>
            {shareMounted && (
              <Suspense fallback={null}>
                <LazySharePopoverPanel
                  status={status}
                  scope={scope}
                  days={days}
                  createdUrl={createdUrl}
                  links={links}
                  onScopeChange={(value) => {
                    if (isShareScope(value)) setScope(value);
                  }}
                  onDaysChange={setDays}
                  onCreate={() => {
                    void create();
                  }}
                  onCopy={() => {
                    void navigator.clipboard?.writeText(createdUrl);
                  }}
                  onRevoke={(id) => {
                    void revoke(id);
                  }}
                  onClose={() => {
                    setShareOpen(false);
                  }}
                />
              </Suspense>
            )}
          </div>
        </Popover>
      )}
      <Popover
        open={notificationOpen}
        onOpenChange={(open) => {
          if (open) setNotificationMounted(true);
          setNotificationOpen(open);
        }}
      >
        <div className="notification-control">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="header-button compact-control"
              type="button"
              aria-label="Notifications"
              onPointerEnter={() => {
                void loadSharingPanels();
              }}
              onFocus={() => {
                void loadSharingPanels();
              }}
            >
              <Bell data-icon="inline-start" /> {notifications.filter((item) => !item.readAt).length}
            </Button>
          </PopoverTrigger>
          {notificationMounted && (
            <Suspense fallback={null}>
              <LazyNotificationPopoverPanel
                status={status}
                preferences={preferences}
                notifications={notifications}
                onSavePreferences={savePreferences}
                onToggleEvent={toggleEvent}
                onMarkRead={markRead}
              />
            </Suspense>
          )}
        </div>
      </Popover>
    </>
  );
}
