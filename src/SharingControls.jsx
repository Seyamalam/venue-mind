import { useEffect, useState } from "react";
import { Bell, LinkSimple, Copy, X } from "@phosphor-icons/react";

const EVENT_OPTIONS = Object.freeze([
  ["review_requested", "REVIEW"],
  ["adjustment_requested", "ADJUST"],
  ["approval_completed", "APPROVE"],
  ["conflict_detected", "CONFLICT"],
]);
const json = async (response) => { const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error ?? "REQUEST_FAILED"), { code: body.code }); return body; };
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

  const run = async (operation) => { setStatus("BUSY"); try { const value = await operation(); setStatus("READY"); return value; } catch (error) { setStatus(error.code ?? error.message ?? "ERROR"); return null; } };
  const loadLinks = async () => setLinks((await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, { credentials: "same-origin", headers: headers(organizationId) }))).links);
  const loadNotifications = async () => {
    const [items, prefs] = await Promise.all([
      json(await fetch("/api/notifications", { credentials: "same-origin", headers: headers(organizationId) })),
      json(await fetch("/api/notification-preferences", { credentials: "same-origin", headers: headers(organizationId) })),
    ]);
    setNotifications(items.notifications); setPreferences(prefs);
  };
  useEffect(() => { if (shareOpen && canManage) void run(loadLinks); }, [shareOpen, canManage, projectId, organizationId]);
  useEffect(() => { void run(loadNotifications); }, [organizationId]);

  const create = async () => {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await run(async () => { const result = await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links`, { method: "POST", credentials: "same-origin", headers: headers(organizationId, { "content-type": "application/json" }), body: JSON.stringify({ scope, ...(scope === "reviewer" ? { proposalId } : {}), expiresAt }) })); setCreatedUrl(`${window.location.origin}${result.url}`); await loadLinks(); });
  };
  const revoke = async (id) => { await run(async () => { await json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(id)}/revoke`, { method: "POST", credentials: "same-origin", headers: headers(organizationId) })); await loadLinks(); }); };
  const savePreferences = async (next) => { const previous = preferences; setPreferences(next); const saved = await run(async () => json(await fetch("/api/notification-preferences", { method: "PUT", credentials: "same-origin", headers: headers(organizationId, { "content-type": "application/json" }), body: JSON.stringify(next) }))); if (!saved) setPreferences(previous); };
  const toggleEvent = (eventType, enabled) => void savePreferences({ ...preferences, eventTypes: enabled ? [...new Set([...preferences.eventTypes, eventType])] : preferences.eventTypes.filter((item) => item !== eventType) });

  return <>
    {canManage && <div className="share-control">
      <button className="header-button compact-control" type="button" aria-label="Share Project" onClick={() => setShareOpen((open) => !open)}><LinkSimple size={16} /> SHARE</button>
      {shareOpen && <div className="share-popover">
        <header><b>SHARE</b><code>{status}</code><button type="button" onClick={() => setShareOpen(false)} aria-label="Close sharing"><X size={13} /></button></header>
        <div className="share-create"><select aria-label="Share scope" value={scope} onChange={(event) => setScope(event.target.value)}><option value="reviewer">REVIEWER</option><option value="read-only">READ ONLY</option></select><select aria-label="Share expiry" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>1D</option><option value={7}>7D</option><option value={30}>30D</option></select><button type="button" onClick={create}>CREATE</button></div>
        {createdUrl && <div className="share-result"><code>{createdUrl}</code><button type="button" onClick={() => navigator.clipboard?.writeText(createdUrl)}><Copy size={12} /></button></div>}
        <div className="share-links">{links.map((link) => <div key={link.id}><span><b>{link.scope.toUpperCase()}</b><small>{link.status.toUpperCase()} · {link.proposalId ?? "PROJECT"}</small></span>{link.status === "active" && <button type="button" onClick={() => revoke(link.id)}>REVOKE</button>}</div>)}</div>
      </div>}
    </div>}
    <div className="notification-control">
      <button className="header-button compact-control" type="button" aria-label="Notifications" onClick={() => setNotificationOpen((open) => !open)}><Bell size={16} /> {notifications.filter((item) => !item.readAt).length}</button>
      {notificationOpen && <div className="notification-popover">
        <header><b>NOTIFY</b><code>{status}</code><span><label>APP <input type="checkbox" checked={preferences.inAppEnabled} onChange={(event) => void savePreferences({ ...preferences, inAppEnabled: event.target.checked })} /></label><label>EMAIL <input type="checkbox" checked={preferences.emailEnabled} onChange={(event) => void savePreferences({ ...preferences, emailEnabled: event.target.checked })} /></label></span></header>
        <div className="notification-events">{EVENT_OPTIONS.map(([eventType, label]) => <label key={eventType}>{label}<input type="checkbox" checked={preferences.eventTypes.includes(eventType)} onChange={(event) => toggleEvent(eventType, event.target.checked)} /></label>)}</div>
        <div>{notifications.map((item) => <button key={item.id} type="button" className={item.readAt ? "is-read" : ""} onClick={async () => { await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST", credentials: "same-origin", headers: headers(organizationId) }); await loadNotifications(); }}><b>{item.eventType.replaceAll("_", " ").toUpperCase()}</b><small>{item.refs.planVersion ?? item.refs.proposalId ?? item.refs.conflictCode ?? `R${item.refs.revision}`}</small></button>)}</div>
      </div>}
    </div>
  </>;
}
