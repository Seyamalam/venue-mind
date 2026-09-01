import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, DownloadSimple, Plus, SignOut, Trash, UserPlus } from "@phosphor-icons/react";
import { ORGANIZATION_ROLES } from "./domain/accounts";
import { browserNavigate, navigateInternalLink } from "./navigation";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import "./organization-settings.css";
import type { DomainList, DomainRecord } from "./ui-types";

const downloadJson = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

type OrganizationSettingsProps = {
  organizationId: string;
  account: DomainRecord;
  accountStore: DomainRecord;
  navigate?: (href: string) => void;
};

export function OrganizationSettings({ organizationId, account, accountStore, navigate = browserNavigate }: OrganizationSettingsProps) {
  const organization = account.organizations.find((item: DomainRecord) => item.id === organizationId);
  const administrator = organization?.roles.includes("organization-administrator");
  const [members, setMembers] = useState<DomainList>([]);
  const [events, setEvents] = useState<DomainList>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteToken, setInviteToken] = useState("");
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [status, setStatus] = useState("SYNC");

  const refresh = async () => {
    if (!administrator) { setMembers([]); setEvents([]); setStatus("READ ONLY"); return; }
    try {
      const [membershipResult, auditResult] = await Promise.all([accountStore.listMemberships(), accountStore.organizationAudit()]);
      setMembers(membershipResult.memberships);
      setEvents(auditResult.events);
      setStatus("SYNCED");
    } catch (error: unknown) { setStatus((error as { code?: string }).code ?? "FAILED"); }
  };
  useEffect(() => { void refresh(); }, [organizationId]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await accountStore.inviteMember({ email, roles: [role], expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
      setInviteToken(result.token);
      setEmail("");
      setStatus("INVITED");
      await refresh();
    } catch (error: unknown) { setStatus((error as { code?: string }).code ?? "FAILED"); }
  };
  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { await accountStore.createOrganization({ name: newName, slug: newSlug }); setNewName(""); setNewSlug(""); setStatus("CREATED"); }
    catch (error: unknown) { setStatus((error as { code?: string }).code ?? "FAILED"); }
  };
  const changeRole = async (userId: string, nextRole: string) => { await accountStore.setMembershipRoles(userId, [nextRole]); await refresh(); };
  const remove = async (userId: string) => { await accountStore.removeMembership(userId); await refresh(); };
  const exportAccount = async () => downloadJson(await accountStore.exportAccount(), `venuemind-account-${account.user.id}.json`);
  const deleteAccount = async () => { await accountStore.deleteAccount(); };

  return <div className="organization-shell">
    <header><a href="/projects" onClick={(event) => navigateInternalLink(event, navigate, "/projects")}><ArrowLeft size={15} /> PROJECTS</a><strong>VenueMind</strong><span>{status}</span></header>
    <main>
      <section className="organization-title"><div><small>ORGANIZATION</small><h1>{organization?.name ?? "—"}</h1><code>{organizationId}</code></div><Select value={organizationId} onValueChange={(value) => accountStore.selectOrganization(value)}><SelectTrigger className="organization-select" aria-label="Organization"><SelectValue /></SelectTrigger><SelectContent className="settings-select-content" position="popper"><SelectGroup>{account.organizations.map((item: DomainRecord) => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select></section>

      <section className="settings-grid">
        <article><div className="settings-heading"><span>MEMBERS</span><strong>{members.length}</strong></div>{members.map((member) => <div className="member-row" key={member.userId}><span><strong>{member.displayName || member.email}</strong><small>{member.email}</small></span><Select disabled={!administrator || member.userId === account.user.id} value={member.roles[0]} onValueChange={(value) => changeRole(member.userId, value)}><SelectTrigger className="member-role-select" aria-label={`Role for ${member.displayName || member.email}`}><SelectValue /></SelectTrigger><SelectContent className="settings-select-content" position="popper"><SelectGroup>{ORGANIZATION_ROLES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select><Button className="member-remove-button" variant="ghost" size="icon-sm" disabled={!administrator || member.userId === account.user.id} type="button" onClick={() => remove(member.userId)} aria-label="Remove member"><Trash /></Button></div>)}</article>

        <article><div className="settings-heading"><span>INVITE</span><UserPlus size={18} /></div><form onSubmit={invite}><Input className="settings-input" required type="email" placeholder="EMAIL" value={email} onChange={(event) => setEmail(event.target.value)} /><Select value={role} onValueChange={setRole}><SelectTrigger className="settings-form-select" aria-label="Role"><SelectValue /></SelectTrigger><SelectContent className="settings-select-content" position="popper"><SelectGroup>{ORGANIZATION_ROLES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select><Button className="settings-submit-button" disabled={!administrator} type="submit">SEND</Button></form>{inviteToken && <div className="invite-token"><small>TOKEN</small><code>{inviteToken}</code><Button className="invite-copy-button" type="button" onClick={() => navigator.clipboard?.writeText(inviteToken)}>COPY</Button></div>}</article>

        <article><div className="settings-heading"><span>NEW ORGANIZATION</span><Plus size={18} /></div><form onSubmit={createOrganization}><Input className="settings-input" required placeholder="NAME" value={newName} onChange={(event) => setNewName(event.target.value)} /><Input className="settings-input" required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="SLUG" value={newSlug} onChange={(event) => setNewSlug(event.target.value.toLowerCase())} /><Button className="settings-submit-button" type="submit">CREATE</Button></form></article>

        <article><div className="settings-heading"><span>ACCOUNT</span><code>{account.user.email}</code></div><div className="account-actions"><Button className="account-action-button" type="button" onClick={exportAccount}><DownloadSimple data-icon="inline-start" />EXPORT</Button><Button className="account-action-button" type="button" onClick={() => accountStore.revokeSession()}><SignOut data-icon="inline-start" />SIGN OUT</Button><AlertDialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteConfirmation(""); }}><AlertDialogTrigger asChild><Button className="account-action-button danger" variant="destructive" type="button"><Trash data-icon="inline-start" />DELETE</Button></AlertDialogTrigger><AlertDialogContent className="account-delete-dialog"><AlertDialogHeader><AlertDialogTitle>DELETE ACCOUNT</AlertDialogTitle><AlertDialogDescription>TYPE DELETE</AlertDialogDescription></AlertDialogHeader><Input className="delete-confirmation-input" aria-label="Delete confirmation" autoComplete="off" placeholder="DELETE" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /><AlertDialogFooter><AlertDialogCancel>CANCEL</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleteConfirmation !== "DELETE"} onClick={deleteAccount}>DELETE</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></article>
      </section>

      <section className="audit-table"><div className="settings-heading"><span>AUDIT</span><strong>{events.length}</strong></div>{events.map((event) => <div key={event.id}><code>{event.occurredAt}</code><strong>{event.type.toUpperCase()}</strong><span>{event.actorUserId}</span><code>{event.fingerprint.slice(0, 16)}</code></div>)}</section>
    </main>
  </div>;
}
