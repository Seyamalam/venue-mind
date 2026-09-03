# Browser and device support

VenueMind is desktop-first for precision spatial editing. Review and human Approval are supported on tablets. Phones provide read-only review.

## Viewports

| Mode | Minimum viewport | Review | Request Adjustment | Approve | Spatial editing |
| --- | --- | --- | --- | --- | --- |
| Desktop | 1024 × 720 | Yes | Yes | Yes | Yes |
| Tablet | 768 × 900 | Yes | Yes | Yes | No |
| Mobile | 360 × 640 | Yes | No | No | No |

Widths below 360px are not supported. On coarse-pointer devices, tablet layout keeps evidence and decisions beside the Plan, while mobile layout removes every Proposal mutation and precision-edit entry point while retaining Plan, evidence, history, comparison, and export review. Fine-pointer desktop browsers retain the desktop command set when browser zoom narrows the CSS viewport; the workspace reflows without removing Edit or Approval at 200% zoom.

Docs, Projects, Studio, exported/printed views, and Shared Review support the same minimum width. Touch targets are at least 44px on coarse-pointer devices. Standard-density and high-density displays use the same geometry and stable IDs; pixel density does not change validation.

## Browsers

| Browser family | Minimum | WebMCP | Product UI |
| --- | ---: | --- | --- |
| Chromium | 131 | Runtime detection | Full |
| Safari | 18 | MCP SDK/manual fallback | Full |
| Firefox | 133 | MCP SDK/manual fallback | Full |

Newer stable versions are supported. Browser recognition never authorizes a feature: VenueMind checks the required API directly. When `document.modelContext.registerTool` is absent, WebMCP remains unregistered and Studio, persistence, exports, the public SDK, and the standalone MCP server continue to work.

## Interaction and platform behavior

- Mouse and trackpad support the complete desktop editor.
- Keyboard supports review controls, decisions, menus, export selection, comments, and history.
- Touch supports tablet review and Approval; drag-precision editing remains disabled.
- Clipboard uses the asynchronous Clipboard API first, then a selection-based copy fallback. If neither is available, the action reports unavailable without discarding the source value.
- Downloads use Blob URLs and the browser download surface. JSON, text, SVG, CSV, PDF, and audit data remain generated from the same validated export command.
- Print styles remove interactive chrome and preserve the Plan/evidence or Shared Review record.
- Project recovery uses local storage. Operational stores prefer IndexedDB and retain their memory fallback when it is unavailable. Remote records remain authoritative after refresh.

## Local verification

Run `npm run test:browser` for the capability and responsive contract checks. Run `npm run typecheck`, `npm run lint`, and `npx next build --webpack` for the full local frontend gate. VenueMind does not use GitHub Actions.
