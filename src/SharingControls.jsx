import { useCallback, useEffect, useState } from "react";
import { Bell, LinkSimple, Copy, X } from "@phosphor-icons/react";
import { Checkbox } from "../components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";

const EVENT_OPTIONS = Object.freeze([
  ["review_requested", "REVIEW"],
  ["adjustment_requested", "ADJUST"],
  ["approval_completed", "APPROVE"],
  ["conflict_detected", "CONFLICT"],
]);
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

  return <>
    {canManage && <Popover open={shareOpen} onOpenChange={setShareOpen}>
      <div className="share-control">
        <PopoverTrigger asChild><button className="header-button compact-control" type="button" aria-label="Share Project"><LinkSimple size={16} /> SHARE</button></PopoverTrigger>
        <PopoverContent className="share-popover" align="end" sideOffset={8}>
          <header><b>SHARE</b><code>{status}</code><button type="button" onClick={() => setShareOpen(false)} aria-label="Close sharing"><X size={13} /></button></header>
          <div className="share-create"><select aria-label="Share scope" value={scope} onChange={(event) => setScope(event.target.value)}><option value="reviewer">REVIEWER</option><option value="read-only">READ ONLY</option></select><select aria-label="Share expiry" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>1D</option><option value={7}>7D</option><option value={30}>30D</option></select><button type="button" onClick={create}>CREATE</button></div>
          {createdUrl && <div className="share-result"><code>{createdUrl}</code><button type="button" onClick={() => navigator.clipboard?.writeText(createdUrl)}><Copy size={12} /></button></div>}
          <div className="share-links">{links.map((link) => <div key={link.id}><span><b>{link.scope.toUpperCase()}</b><small>{link.status.toUpperCase()} · {link.proposalId ?? "PROJECT"}</small></span>{link.status === "active" && <button type="button" onClick={() => revoke(link.id)}>REVOKE</button>}</div>)}</div>
        </PopoverContent>
      </div>
    </Popover>}
    <Popover open={notificationOpen} onOpenChange={setNotificationOpen}>
      <div className="notification-control">
        <PopoverTrigger asChild><button className="header-button compact-control" type="button" aria-label="Notifications"><Bell size={16} /> {notifications.filter((item) => !item.readAt).length}</button></PopoverTrigger>
        <PopoverContent className="notification-popover" align="end" sideOffset={8}>
          <header><b>NOTIFY</b><code>{status}</code><span><label>APP <Checkbox className="size-[11px]" checked={preferences.inAppEnabled} onCheckedChange={(checked) => void savePreferences({ ...preferences, inAppEnabled: checked === true })} /></label><label>EMAIL <Checkbox className="size-[11px]" checked={preferences.emailEnabled} onCheckedChange={(checked) => void savePreferences({ ...preferences, emailEnabled: checked === true })} /></label></span></header>
          <div className="notification-events">{EVENT_OPTIONS.map(([eventType, label]) => <label key={eventType}>{label}<Checkbox className="size-[11px]" checked={preferences.eventTypes.includes(eventType)} onCheckedChange={(checked) => toggleEvent(eventType, checked === true)} /></label>)}</div>
          <div>{notifications.map((item) => <button key={item.id} type="button" className={item.readAt ? "is-read" : ""} onClick={async () => { await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST", credentials: "same-origin", headers: headers(organizationId) }); await loadNotifications(); }}><b>{item.eventType.replaceAll("_", " ").toUpperCase()}</b><small>{item.refs.planVersion ?? item.refs.proposalId ?? item.refs.conflictCode ?? `R${item.refs.revision}`}</small></button>)}</div>
        </PopoverContent>
      </div>
    </Popover>
  </>;
}
