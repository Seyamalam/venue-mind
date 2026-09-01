"use client";

import { useEffect, useState } from "react";
import { Eye, ShieldCheck } from "@phosphor-icons/react";

export function SharedReview({ token }) {
  const [state, setState] = useState({ status: "LOAD", data: null });
  useEffect(() => { let active = true; fetch(`/api/share/${encodeURIComponent(token)}`, { headers: { accept: "application/json" } }).then(async (response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))).then((data) => active && setState({ status: "READY", data })).catch(() => active && setState({ status: "UNAVAILABLE", data: null })); return () => { active = false; }; }, [token]);
  if (!state.data) return <main className="shared-review-state"><ShieldCheck size={26} /><b>{state.status}</b></main>;
  const { plan, proposal, project, scope, expiresAt } = state.data;
  return <main className="shared-review">
    <header><span><ShieldCheck size={20} /><b>VenueMind</b></span><code>{scope.toUpperCase()} · R{project.revision}</code></header>
    <section className="shared-review-heading"><span><small>PROJECT</small><h1>{project.name}</h1></span><span><small>PLAN</small><b>v{plan.version}</b></span><span><small>EXPIRES</small><b>{expiresAt.slice(0, 10)}</b></span></section>
    <section className="shared-review-grid"><article><div><Eye size={16} /><b>ACCEPTED</b><span>{plan.objects?.length ?? 0} OBJ</span></div><dl><dt>VENUE</dt><dd>{plan.venue?.name ?? "—"}</dd><dt>EVENT</dt><dd>{plan.event?.date ?? "—"}</dd><dt>CAPACITY</dt><dd>{plan.metrics?.capacity ?? plan.occupancy?.operationalLoad ?? "—"}</dd></dl></article>{proposal && <article><div><b>PROPOSAL</b><span>{proposal.changes.length} CHG</span></div><code>{proposal.id}</code><ul>{proposal.changes.map((change) => <li key={change.id}><b>{change.shortTitle ?? change.title}</b><small>{change.id}</small></li>)}</ul></article>}</section>
  </main>;
}
