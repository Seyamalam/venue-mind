import { useEffect, useState } from "react";
import { ArrowLeft, DownloadSimple, Plus, SignOut, Trash, UserPlus } from "@phosphor-icons/react";
import { ORGANIZATION_ROLES } from "./domain/accounts.js";
import "./organization-settings.css";

const downloadJson = (value, filename) => {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function OrganizationSettings({ organizationId, account, accountStore }) {
  const organization = account.organizations.find((item) => item.id === organizationId);
  const administrator = organization?.roles.includes("organization-administrator");
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteToken, setInviteToken] = useState("");
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [status, setStatus] = useState("SYNC");

  const refresh = async () => {
    if (!administrator) { setMembers([]); setEvents([]); setStatus("READ ONLY"); return; }
    try {
      const [membershipResult, auditResult] = await Promise.all([accountStore.listMemberships(), accountStore.organizationAudit()]);
      setMembers(membershipResult.memberships);
      setEvents(auditResult.events);
      setStatus("SYNCED");
    } catch (error) { setStatus(error.code ?? "FAILED"); }
  };
  useEffect(() => { void refresh(); }, [organizationId]);

  const invite = async (event) => {
    event.preventDefault();
    try {
      const result = await accountStore.inviteMember({ email, roles: [role], expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
      setInviteToken(result.token);
      setEmail("");
      setStatus("INVITED");
      await refresh();
    } catch (error) { setStatus(error.code ?? "FAILED"); }
  };
  const createOrganization = async (event) => {
    event.preventDefault();
    try { await accountStore.createOrganization({ name: newName, slug: newSlug }); setNewName(""); setNewSlug(""); setStatus("CREATED"); }
    catch (error) { setStatus(error.code ?? "FAILED"); }
  };
  const changeRole = async (userId, nextRole) => { await accountStore.setMembershipRoles(userId, [nextRole]); await refresh(); };
  const remove = async (userId) => { await accountStore.removeMembership(userId); await refresh(); };
  const exportAccount = async () => downloadJson(await accountStore.exportAccount(), `venuemind-account-${account.user.id}.json`);
  const deleteAccount = async () => {
    if (window.prompt("TYPE DELETE", "") !== "DELETE") return;
    await accountStore.deleteAccount();
  };

  return <div className="organization-shell">
    <header><a href="/projects"><ArrowLeft size={15} /> PROJECTS</a><strong>VenueMind</strong><span>{status}</span></header>
    <main>
      <section className="organization-title"><div><small>ORGANIZATION</small><h1>{organization?.name ?? "—"}</h1><code>{organizationId}</code></div><select value={organizationId} onChange={(event) => accountStore.selectOrganization(event.target.value)}>{account.organizations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></section>

      <section className="settings-grid">
        <article><div className="settings-heading"><span>MEMBERS</span><strong>{members.length}</strong></div>{members.map((member) => <div className="member-row" key={member.userId}><span><strong>{member.displayName || member.email}</strong><small>{member.email}</small></span><select disabled={!administrator || member.userId === account.user.id} value={member.roles[0]} onChange={(event) => changeRole(member.userId, event.target.value)}>{ORGANIZATION_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button disabled={!administrator || member.userId === account.user.id} type="button" onClick={() => remove(member.userId)} aria-label="Remove member"><Trash size={15} /></button></div>)}</article>

        <article><div className="settings-heading"><span>INVITE</span><UserPlus size={18} /></div><form onSubmit={invite}><input required type="email" placeholder="EMAIL" value={email} onChange={(event) => setEmail(event.target.value)} /><select value={role} onChange={(event) => setRole(event.target.value)}>{ORGANIZATION_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button disabled={!administrator} type="submit">SEND</button></form>{inviteToken && <div className="invite-token"><small>TOKEN</small><code>{inviteToken}</code><button type="button" onClick={() => navigator.clipboard?.writeText(inviteToken)}>COPY</button></div>}</article>

        <article><div className="settings-heading"><span>NEW ORGANIZATION</span><Plus size={18} /></div><form onSubmit={createOrganization}><input required placeholder="NAME" value={newName} onChange={(event) => setNewName(event.target.value)} /><input required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="SLUG" value={newSlug} onChange={(event) => setNewSlug(event.target.value.toLowerCase())} /><button type="submit">CREATE</button></form></article>

        <article><div className="settings-heading"><span>ACCOUNT</span><code>{account.user.email}</code></div><div className="account-actions"><button type="button" onClick={exportAccount}><DownloadSimple size={16} />EXPORT</button><button type="button" onClick={() => accountStore.revokeSession()}><SignOut size={16} />SIGN OUT</button><button className="danger" type="button" onClick={deleteAccount}><Trash size={16} />DELETE</button></div></article>
      </section>

      <section className="audit-table"><div className="settings-heading"><span>AUDIT</span><strong>{events.length}</strong></div>{events.map((event) => <div key={event.id}><code>{event.occurredAt}</code><strong>{event.type.toUpperCase()}</strong><span>{event.actorUserId}</span><code>{event.fingerprint.slice(0, 16)}</code></div>)}</section>
    </main>
  </div>;
}
