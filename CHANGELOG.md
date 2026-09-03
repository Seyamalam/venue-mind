# Changelog

This file is generated from reviewed JSON notes in `release/notes/`.

## 1.0.0 — 2026-09-03

First complete VenueMind product release with supervised venue revision, deterministic validation, durable operations, agent interfaces, and public documentation.

### Product

- Runs the inspect, preview, validate, human approval, auditable commit, and export loop with stable object IDs and versioned Plans.
- Adds deterministic simulation, event-day occupancy and incidents, post-event reporting, collaboration, recovery, and responsive review surfaces.

### Agent platform

- Publishes shared WebMCP and MCP contracts, bounded structured results, public schemas, llms.txt, llms-full.txt, typed SDK artifacts, and six versioned agent skills.
- Keeps Approval and destructive Project deletion outside every agent tool surface.

### Operations

- Uses Vercel for the sole Next.js frontend and Cloudflare Workers with D1 for the API and durable state; file storage remains disabled.
- Adds local verification, migration rehearsal, release checksums, deployment smoke tests, and data-preserving rollback procedures.
