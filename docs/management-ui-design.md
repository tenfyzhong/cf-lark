# Management UI design

## Visual system

The management interface uses Feishu-inspired blue accents with an independent
layout: primary blue `#3370ff`, dark neutral text `#1f2329`, muted text
`#646a73`, a pale gray canvas `#f5f6f7`, and white surfaces. Shared CSS tokens
own color, spacing and borders; no remote fonts or UI framework are required.

Use compact headings, generous form spacing, subtle panel borders and restrained
corner radii. The existing original bird favicon also appears in the header.
The MCP endpoint is a quiet utility row, separate from the main content.
The obsolete in-progress compatibility banner is removed following the hosted
parity release; detailed compatibility boundaries remain in the documentation.
Application and client cards have a clear title and secondary metadata.
Actions retain readable labels, visible focus rings and gray disabled states.

## Navigation

Applications, Storage and Clients form an accessible tab list. Tabs have a
transparent background and a bottom indicator instead of button-shaped borders
or filled selected surfaces. The selected tab uses blue text and a blue line.
Only the selected tab is in the Tab sequence. Left/Right arrows wrap between
tabs; Home and End select the first and last tabs. Selection moves keyboard focus
and reveals the associated labeled tab panel.

OAuth consent remains outside the tab panel so switching management tabs does
not dismiss an authorization request. All account, credential and grant
operations keep their existing API contracts.

## Responsive layout

The centered content is at most 1080 pixels wide. Two-column application forms
collapse to one column on small screens. Header controls and action groups wrap;
IDs, scope lists and endpoint URLs wrap without forcing horizontal scrolling.
Tabs remain usable at 320 pixels wide. Form controls and actions have practical
touch targets, and reduced-motion preferences disable decorative transitions.

## Scope disclosures

Account and authorized-client cards show a compact `Scopes (count)` summary.
Native details/summary disclosures start closed and toggle independently by
click or keyboard. Expanding reveals every scope, one per line, in a scrollable
list capped at 16rem. Long identifiers wrap on mobile. Empty disclosures show
`No scopes.`. Account sign-out and client revocation remain outside disclosures.
This presentation does not modify granted scopes or OAuth permission selection.

## Acceptance

Reusable browser checks cover computed blue action styling, unfilled tabs,
selection and keyboard behavior, consent submission states, application
creation, storage, client revocation, logout, and 320/390-pixel layouts.
Local management tests use fixtures or signed Access test assertions. Live checks verify
the public sign-in page and anonymous API boundaries; they do not exercise
production administrator credentials or create Lark business content.

Management sign-in uses a Cloudflare Access link with domain-independent email wording. There is
no secret input. Logout redirects to Cloudflare Access. See [Access
authentication](cloudflare-access.md).
