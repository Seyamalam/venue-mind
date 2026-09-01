import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Bell, LinkSimple } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Popover, PopoverTrigger } from "../components/ui/popover";

const loadSharingPanels = () => import("./SharingPanels.jsx");
const LazySharePopoverPanel = lazy(() => loadSharingPanels().then((module) => ({ default: module.SharePopoverPanel })));
const LazyNotificationPopoverPanel = lazy(() => loadSharingPanels().then((module) => ({ default: module.NotificationPopoverPanel })));
const json = async (response) => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw Object.assign(new Error("API_UNAVAILABLE"), { code: "API_UNAVAILABLE" });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error ?? "REQUEST_FAILED"), { code: body.code });
  return body;
};
const optionalJson = async (response, fallback) => (response.headers.get("content-type") ?? "").includes("application/json") ? json(response) : fallback;
const headers = (organizationId, extra = {}) => ({ "x-venuemind-organization-id": organizationId, accept: "application/json", ...extra });

export function SharingControls({ projectId, organizationId, proposalId, canManage = false }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [notificationMounted, setNotificationMounted] = useState(false);
  const [links, setLinks] = useState([]);
  const [scope, setScope] = useState("reviewer");
  const [days, setDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [preferences, setPreferences] = useState({ inAppEnabled: true, emailEnabled: false, eventTypes: [] });
  const [status, setStatus] = useState("READY");

  const run = useCallback(async (operation) => { setStatus("BUSY"); try { const value = await operation(); setStatus("READY"); return value; } catch (error) { setStatus(error.code ?? error.message ?? "ERROR"); return null; } }, []);
  const loadLinks = useCallback(async () => setLinks((await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, { credentials: "same-origin", headers: headers(organizationId) }))).links), [organizationId, projectId]);
  const loadNotifications = useCallback(async () => {
    const [items, prefs] = await Promise.all([
      optionalJson(await fetch("/api/notifications", { credentials: "same-origin", headers: headers(organizationId) }), { notifications: [] }),
      optionalJson(await fetch("/api/notification-preferences", { credentials: "same-origin", headers: headers(organizationId) }), { inAppEnabled: true, emailEnabled: false, eventTypes: [] }),
    ]);
    setNotifications(items.notifications); setPreferences(prefs);
  }, [organizationId]);
  useEffect(() => { if (shareOpen && canManage) void Promise.resolve().then(() => run(loadLinks)); }, [canManage, loadLinks, run, shareOpen]);
  useEffect(() => { void Promise.resolve().then(() => run(loadNotifications)); }, [loadNotifications, run]);

  const create = async () => {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await run(async () => { const result = await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, { method: "POST", credentials: "same-origin", headers: headers(organizationId, { "content-type": "application/json" }), body: JSON.stringify({ scope, ...(scope === "reviewer" ? { proposalId } : {}), expiresAt }) })); setCreatedUrl(`${window.location.origin}${result.url}`); await loadLinks(); });
  };
  const revoke = async (id) => { await run(async () => { await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(id)}/revoke`, { method: "POST", credentials: "same-origin", headers: headers(organizationId) })); await loadLinks(); }); };
  const savePreferences = async (next) => { const previous = preferences; setPreferences(next); const saved = await run(async () => json(await fetch("/api/notification-preferences", { method: "PUT", credentials: "same-origin", headers: headers(organizationId, { "content-type": "application/json" }), body: JSON.stringify(next) }))); if (!saved) setPreferences(previous); };
  const toggleEvent = (eventType, enabled) => void savePreferences({ ...preferences, eventTypes: enabled ? [...new Set([...preferences.eventTypes, eventType])] : preferences.eventTypes.filter((item) => item !== eventType) });
  const markRead = async (notificationId) => { await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST", credentials: "same-origin", headers: headers(organizationId) }); await loadNotifications(); };

  return <>
    {canManage && <Popover open={shareOpen} onOpenChange={(open) => { if (open) setShareMounted(true); setShareOpen(open); }}>
      <div className="share-control">
        <PopoverTrigger asChild><Button variant="outline" className="header-button compact-control" type="button" aria-label="Share Project" onPointerEnter={loadSharingPanels} onFocus={loadSharingPanels}><LinkSimple data-icon="inline-start" /> SHARE</Button></PopoverTrigger>
        {shareMounted && <Suspense fallback={null}><LazySharePopoverPanel status={status} scope={scope} days={days} createdUrl={createdUrl} links={links} onScopeChange={setScope} onDaysChange={setDays} onCreate={create} onCopy={() => navigator.clipboard?.writeText(createdUrl)} onRevoke={revoke} onClose={() => setShareOpen(false)} /></Suspense>}
      </div>
    </Popover>}
    <Popover open={notificationOpen} onOpenChange={(open) => { if (open) setNotificationMounted(true); setNotificationOpen(open); }}>
      <div className="notification-control">
        <PopoverTrigger asChild><Button variant="outline" className="header-button compact-control" type="button" aria-label="Notifications" onPointerEnter={loadSharingPanels} onFocus={loadSharingPanels}><Bell data-icon="inline-start" /> {notifications.filter((item) => !item.readAt).length}</Button></PopoverTrigger>
        {notificationMounted && <Suspense fallback={null}><LazyNotificationPopoverPanel status={status} preferences={preferences} notifications={notifications} onSavePreferences={savePreferences} onToggleEvent={toggleEvent} onMarkRead={markRead} /></Suspense>}
      </div>
    </Popover>
  </>;
}
