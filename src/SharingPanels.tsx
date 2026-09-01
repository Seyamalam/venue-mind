import { Copy, X } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { PopoverContent } from "../components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import type { AsyncValueCallback, DomainList, DomainRecord, ValueCallback, VoidCallback } from "./ui-types";

const EVENT_OPTIONS = Object.freeze([
  ["review_requested", "REVIEW"],
  ["adjustment_requested", "ADJUST"],
  ["approval_completed", "APPROVE"],
  ["conflict_detected", "CONFLICT"],
]);

type SharePopoverPanelProps = {
  status: string; scope: string; days: number; createdUrl: string; links: DomainList;
  onScopeChange: ValueCallback; onDaysChange: ValueCallback<number>; onCreate: VoidCallback;
  onCopy: VoidCallback; onRevoke: ValueCallback; onClose: VoidCallback;
};

type NotificationPopoverPanelProps = {
  status: string; preferences: DomainRecord; notifications: DomainList;
  onSavePreferences: AsyncValueCallback<DomainRecord>;
  onToggleEvent: (eventType: string, enabled: boolean) => void;
  onMarkRead: AsyncValueCallback;
};

export function SharePopoverPanel({ status, scope, days, createdUrl, links, onScopeChange, onDaysChange, onCreate, onCopy, onRevoke, onClose }: SharePopoverPanelProps) {
  return <PopoverContent className="share-popover" align="end" sideOffset={8}>
    <header><b>SHARE</b><code>{status}</code><Button variant="ghost" size="icon-xs" type="button" onClick={onClose} aria-label="Close sharing"><X /></Button></header>
    <div className="share-create"><Select value={scope} onValueChange={onScopeChange}><SelectTrigger aria-label="Share scope"><SelectValue /></SelectTrigger><SelectContent className="share-select-content" position="popper"><SelectGroup><SelectItem value="reviewer">REVIEWER</SelectItem><SelectItem value="read-only">READ ONLY</SelectItem></SelectGroup></SelectContent></Select><Select value={String(days)} onValueChange={(value) => onDaysChange(Number(value))}><SelectTrigger aria-label="Share expiry"><SelectValue /></SelectTrigger><SelectContent className="share-select-content" position="popper"><SelectGroup><SelectItem value="1">1D</SelectItem><SelectItem value="7">7D</SelectItem><SelectItem value="30">30D</SelectItem></SelectGroup></SelectContent></Select><Button type="button" onClick={onCreate}>CREATE</Button></div>
    {createdUrl && <div className="share-result"><code>{createdUrl}</code><Button variant="ghost" size="icon-xs" type="button" onClick={onCopy} aria-label="Copy share link"><Copy /></Button></div>}
    <div className="share-links">{links.map((link) => <div key={link.id}><span><b>{link.scope.toUpperCase()}</b><small>{link.status.toUpperCase()} · {link.proposalId ?? "PROJECT"}</small></span>{link.status === "active" && <Button variant="ghost" size="xs" type="button" onClick={() => onRevoke(link.id)}>REVOKE</Button>}</div>)}</div>
  </PopoverContent>;
}

export function NotificationPopoverPanel({ status, preferences, notifications, onSavePreferences, onToggleEvent, onMarkRead }: NotificationPopoverPanelProps) {
  return <PopoverContent className="notification-popover" align="end" sideOffset={8}>
    <header><b>NOTIFY</b><code>{status}</code><span><label>APP <Checkbox className="size-[11px]" checked={preferences.inAppEnabled} onCheckedChange={(checked) => void onSavePreferences({ ...preferences, inAppEnabled: checked === true })} /></label><label>EMAIL <Checkbox className="size-[11px]" checked={preferences.emailEnabled} onCheckedChange={(checked) => void onSavePreferences({ ...preferences, emailEnabled: checked === true })} /></label></span></header>
    <div className="notification-events">{EVENT_OPTIONS.map(([eventType, label]) => <label key={eventType}>{label}<Checkbox className="size-[11px]" checked={preferences.eventTypes.includes(eventType)} onCheckedChange={(checked) => onToggleEvent(eventType, checked === true)} /></label>)}</div>
    <div>{notifications.map((item) => <Button variant="ghost" key={item.id} type="button" className={item.readAt ? "is-read" : ""} onClick={() => onMarkRead(item.id)}><b>{item.eventType.replaceAll("_", " ").toUpperCase()}</b><small>{item.refs.planVersion ?? item.refs.proposalId ?? item.refs.conflictCode ?? `R${item.refs.revision}`}</small></Button>)}</div>
  </PopoverContent>;
}
