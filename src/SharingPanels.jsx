import { Copy, X } from "@phosphor-icons/react";
import { Checkbox } from "../components/ui/checkbox";
import { PopoverContent } from "../components/ui/popover";

const EVENT_OPTIONS = Object.freeze([
  ["review_requested", "REVIEW"],
  ["adjustment_requested", "ADJUST"],
  ["approval_completed", "APPROVE"],
  ["conflict_detected", "CONFLICT"],
]);

export function SharePopoverPanel({ status, scope, days, createdUrl, links, onScopeChange, onDaysChange, onCreate, onCopy, onRevoke, onClose }) {
  return <PopoverContent className="share-popover" align="end" sideOffset={8}>
    <header><b>SHARE</b><code>{status}</code><button type="button" onClick={onClose} aria-label="Close sharing"><X size={13} /></button></header>
    <div className="share-create"><select aria-label="Share scope" value={scope} onChange={(event) => onScopeChange(event.target.value)}><option value="reviewer">REVIEWER</option><option value="read-only">READ ONLY</option></select><select aria-label="Share expiry" value={days} onChange={(event) => onDaysChange(Number(event.target.value))}><option value={1}>1D</option><option value={7}>7D</option><option value={30}>30D</option></select><button type="button" onClick={onCreate}>CREATE</button></div>
    {createdUrl && <div className="share-result"><code>{createdUrl}</code><button type="button" onClick={onCopy} aria-label="Copy share link"><Copy size={12} /></button></div>}
    <div className="share-links">{links.map((link) => <div key={link.id}><span><b>{link.scope.toUpperCase()}</b><small>{link.status.toUpperCase()} · {link.proposalId ?? "PROJECT"}</small></span>{link.status === "active" && <button type="button" onClick={() => onRevoke(link.id)}>REVOKE</button>}</div>)}</div>
  </PopoverContent>;
}

export function NotificationPopoverPanel({ status, preferences, notifications, onSavePreferences, onToggleEvent, onMarkRead }) {
  return <PopoverContent className="notification-popover" align="end" sideOffset={8}>
    <header><b>NOTIFY</b><code>{status}</code><span><label>APP <Checkbox className="size-[11px]" checked={preferences.inAppEnabled} onCheckedChange={(checked) => void onSavePreferences({ ...preferences, inAppEnabled: checked === true })} /></label><label>EMAIL <Checkbox className="size-[11px]" checked={preferences.emailEnabled} onCheckedChange={(checked) => void onSavePreferences({ ...preferences, emailEnabled: checked === true })} /></label></span></header>
    <div className="notification-events">{EVENT_OPTIONS.map(([eventType, label]) => <label key={eventType}>{label}<Checkbox className="size-[11px]" checked={preferences.eventTypes.includes(eventType)} onCheckedChange={(checked) => onToggleEvent(eventType, checked === true)} /></label>)}</div>
    <div>{notifications.map((item) => <button key={item.id} type="button" className={item.readAt ? "is-read" : ""} onClick={() => onMarkRead(item.id)}><b>{item.eventType.replaceAll("_", " ").toUpperCase()}</b><small>{item.refs.planVersion ?? item.refs.proposalId ?? item.refs.conflictCode ?? `R${item.refs.revision}`}</small></button>)}</div>
  </PopoverContent>;
}
