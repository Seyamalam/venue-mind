import { bullets, links, prose, type DocsPage } from "../blocks.ts";

export const trustPages = [
  {
    slug: "privacy",
    group: "Trust",
    title: "Privacy notice",
    eyebrow: "Actual data flows",
    summary: "What VenueMind stores, excludes, retains, exports, and deletes in the current hosted preview.",
    audience: ["operators", "administrators", "reviewers"],
    compatibility: ["Data protection schema 1", "VenueMind 0.7.0"],
    sections: [
      {
        id: "collection",
        title: "Collected and excluded data",
        blocks: [
          bullets(
            "Stored: account identity, organization membership, venue geometry, briefs, Plans, Proposals, comments, approvals, aggregate operations, incidents, and audit evidence.",
            "Excluded by design: attendee records, individual check-in events, raw integration credentials, free-form accessibility records, and retained generated export files.",
            "Browser recovery stores the current Project envelope locally; Cloudflare D1 stores durable application state. Vercel serves the frontend and Cloudflare runs the API Worker.",
            "Diagnostics use allowlisted bounded metadata and never raw geometry, Project payloads, identity attributes, cookies, credentials, or comment content.",
          ),
        ],
      },
      {
        id: "purpose",
        title: "Purpose and sharing",
        blocks: [
          prose("VenueMind processes data to authenticate users, keep Project state, validate and simulate Plans, coordinate supervised review, generate requested exports, secure the service, and measure aggregate product reliability. Project data is not sold or used to train a model by VenueMind."),
          bullets(
            "Vercel processes frontend requests; Cloudflare processes API and D1 data. Their own service terms govern their infrastructure handling.",
            "Hashed share tokens allow the recipient selected by a user to read a bounded shared review. Revocation immediately removes that access.",
            "External adapters receive only the scoped values required for the configured operation; secret values remain environment bindings.",
          ),
        ],
      },
      {
        id: "retention",
        title: "Retention, export, and deletion",
        blocks: [
          bullets(
            "Project content remains until deletion; deleted Projects default to 30 days of recovery before primary purge.",
            "Operational-sensitive records default to 365 days and security evidence to 400 days. Organization administrators may select only the documented bounded ranges.",
            "Account export includes identity, memberships, relevant organization audit events, and Projects. Project exports are generated on demand and are not retained by VenueMind.",
            "Project deletion purges browser recovery immediately and D1 data at the configured deadline. Provider backups expire under the documented provider boundary after primary purge.",
            "Account deletion revokes sessions, suspends memberships, and anonymizes identity fields while retaining opaque security evidence until expiry.",
          ),
          links({ label: "Full data-protection contract", href: "/guides/data-protection.md" }),
        ],
      },
      {
        id: "choices",
        title: "Your controls",
        blocks: [
          bullets(
            "Export Project or account data from the product controls before deletion.",
            "Delete a Project with its exact-name confirmation or delete the account from organization settings.",
            "The current preview keeps optional product analytics off; essential integrity and security logs remain active.",
            "Revoke shared-review links and external adapter grants when no longer needed.",
          ),
        ],
      },
    ],
  },
  {
    slug: "terms",
    group: "Trust",
    title: "Preview terms",
    eyebrow: "Effective 3 September 2026",
    summary: "Terms for the open-source, pre-release VenueMind hosted preview.",
    audience: ["operators", "administrators", "reviewers"],
    compatibility: ["Preview terms 1", "MIT License"],
    sections: [
      {
        id: "use",
        title: "Use and authority",
        blocks: [
          prose("Use the hosted preview only for lawful planning and evaluation work, submit only data you are authorized to process, and protect account and share credentials."),
          bullets(
            "A qualified human remains responsible for venue rules, local requirements, emergency decisions, and final approval.",
            "VenueMind is not a licensed architect, engineer, accessibility professional, fire authority, security service, emergency system, or legal adviser.",
            "Agents cannot approve a Plan, create authority, override Locks, or manufacture evidence.",
          ),
        ],
      },
      {
        id: "acceptable-use",
        title: "Acceptable use",
        blocks: [
          prose("Do not cross organization boundaries, bypass human approval or Locks, forge audit evidence, expose another person's data, attack the service, or use VenueMind to create an unlawful or unsafe event. Security research follows the published coordinated-reporting policy."),
        ],
      },
      {
        id: "availability",
        title: "Preview availability",
        blocks: [
          prose("The preview may change, be interrupted, or be withdrawn and has no service-level commitment. The software is provided under the MIT License. To the extent permitted by applicable law, contributors disclaim implied warranties and losses from reliance on the preview, automated checks, simulations, or exports."),
          links({ label: "Complete terms", href: "/guides/terms.md" }, { label: "MIT License", href: "/LICENSE.txt" }),
        ],
      },
    ],
  },
  {
    slug: "trust-safety",
    group: "Trust",
    title: "Trust and safety",
    eyebrow: "Supervised planning",
    summary: "The exact line between configured VenueMind evidence and professional, legal, or emergency authority.",
    audience: ["operators", "reviewers", "agents"],
    compatibility: ["Authorization policy 1", "Validation 2.7.0"],
    sections: [
      {
        id: "policy",
        title: "Configurable policy",
        blocks: [
          prose("A Validation PASS means the Plan satisfies the versioned Constraint policy and model input shown in its evidence. It is not a certification of every law, code, permit, accessibility obligation, structural requirement, fire-safety rule, or live venue condition."),
          bullets(
            "Teams confirm current local requirements and obtain appropriate venue and professional review.",
            "Warning Waivers record a human decision; they do not waive an external duty.",
            "Simulation is scenario evidence, not a prediction or emergency instruction.",
          ),
        ],
      },
      {
        id: "authority",
        title: "Human-only authority",
        blocks: [
          bullets(
            "Only an authorized human approves a Proposal into accepted Plan truth.",
            "Agents cannot manufacture Warning Waivers, Emergency Reviews, permissions, or Locks.",
            "Emergency response remains with venue operators, local emergency services, and on-site leaders.",
            "Incidents and live deviations preserve the approved baseline rather than rewriting it.",
          ),
        ],
      },
      {
        id: "reporting",
        title: "Security reporting",
        blocks: [
          prose("Use GitHub private vulnerability reporting for a security-sensitive finding and include the smallest non-sensitive reproduction plus its correlation ID. Do not put credentials, private venue data, or exploit details in a public issue."),
          links({ label: "Security policy", href: "/guides/security.md" }, { label: "Complete trust boundary", href: "/guides/trust-and-safety.md" }),
        ],
      },
      {
        id: "licenses",
        title: "Licenses and notices",
        blocks: [
          links(
            { label: "VenueMind MIT License", href: "/LICENSE.txt" },
            { label: "Third-party notices", href: "/THIRD_PARTY_NOTICES.txt" },
            { label: "Machine-readable license inventory", href: "/third-party-licenses.json" },
          ),
        ],
      },
    ],
  },
] as const satisfies readonly DocsPage[];
