"use client";

import { useEffect, useState } from "react";
import { EyeIcon as Eye, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react";
import type { VenuePlan, VenueProposal } from "./domain/geometry";
import "./shared-review.css";

type SharedReviewProps = { token: string };
type SharedReviewData = {
  plan: VenuePlan;
  proposal: VenueProposal | null;
  project: { name: string; revision: number };
  scope: string;
  expiresAt: string;
};
type SharedReviewState = { status: "LOAD" | "READY" | "UNAVAILABLE"; data: SharedReviewData | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSharedReviewData = (value: unknown): value is SharedReviewData => {
  if (!isRecord(value) || !isRecord(value["project"]) || !isRecord(value["plan"])) return false;
  const project = value["project"];
  const plan = value["plan"];
  const proposal = value["proposal"];
  return (
    typeof project["name"] === "string" &&
    typeof project["revision"] === "number" &&
    typeof value["scope"] === "string" &&
    typeof value["expiresAt"] === "string" &&
    typeof plan["id"] === "string" &&
    typeof plan["version"] === "string" &&
    Array.isArray(plan["objects"]) &&
    (proposal === null ||
      (isRecord(proposal) && typeof proposal["id"] === "string" && Array.isArray(proposal["changes"])))
  );
};
const decodeSharedReview = (value: unknown): SharedReviewData => {
  if (!isSharedReviewData(value)) throw new Error("INVALID_SHARED_REVIEW");
  return structuredClone(value);
};

export function SharedReview({ token }: SharedReviewProps) {
  const [state, setState] = useState<SharedReviewState>({ status: "LOAD", data: null });
  useEffect(() => {
    let active = true;
    fetch(`/api/share/${encodeURIComponent(token)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body: unknown = await response.json();
        return decodeSharedReview(body);
      })
      .then((data) => {
        if (active) setState({ status: "READY", data });
      })
      .catch(() => {
        if (active) setState({ status: "UNAVAILABLE", data: null });
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (!state.data)
    return (
      <main className="shared-review-state">
        <ShieldCheck size={26} />
        <b>{state.status}</b>
      </main>
    );
  const { plan, proposal, project, scope, expiresAt } = state.data;
  return (
    <main className="shared-review">
      <header>
        <span>
          <ShieldCheck size={20} />
          <b>VenueMind</b>
        </span>
        <code>
          {scope.toUpperCase()} · R{project.revision}
        </code>
      </header>
      <section className="shared-review-heading">
        <span>
          <small>PROJECT</small>
          <h1>{project.name}</h1>
        </span>
        <span>
          <small>PLAN</small>
          <b>v{plan.version}</b>
        </span>
        <span>
          <small>EXPIRES</small>
          <b>{expiresAt.slice(0, 10)}</b>
        </span>
      </section>
      <section className="shared-review-grid">
        <article>
          <div>
            <Eye size={16} />
            <b>ACCEPTED</b>
            <span>{plan.objects.length} OBJ</span>
          </div>
          <dl>
            <dt>VENUE</dt>
            <dd>{plan.venue?.name ?? "—"}</dd>
            <dt>EVENT</dt>
            <dd>{plan.event?.date ?? "—"}</dd>
            <dt>CAPACITY</dt>
            <dd>{plan.metrics?.capacity ?? plan.occupancy?.venueMaximum ?? "—"}</dd>
          </dl>
        </article>
        {proposal && (
          <article>
            <div>
              <b>PROPOSAL</b>
              <span>{proposal.changes.length} CHG</span>
            </div>
            <code>{proposal.id}</code>
            <ul>
              {proposal.changes.map((change) => (
                <li key={change.id}>
                  <b>{change.shortTitle ?? change.title}</b>
                  <small>{change.id}</small>
                </li>
              ))}
            </ul>
          </article>
        )}
      </section>
    </main>
  );
}
