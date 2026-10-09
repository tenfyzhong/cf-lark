# Calendar shortcuts

The Calendar adapter targets the 14 shortcuts registered by lark-cli 1.0.97.
Primary-calendar defaults, current-user attendees, explicit false notifications,
RSVP states, all-day dates, recurrence scope, room availability, rich descriptions,
and event output fields are part of the compatibility contract.

Remote operations with pagination, fanout, range splitting, or multiple writes
use durable workflows. Each durable resume performs at most one upstream API request.
Unknown mutation outcomes are not replayed. Date-only defaults use UTC in the
hosted environment; explicit ISO offsets and timezone flags are preserved.

Calendar search and attendee listing preserve upstream cursors even when local
filters return an empty list. Agenda retrieval uses instance views and bounded
range splitting for upstream overflow errors. Busy intervals are clipped and
merged before deriving per-user or shared free windows.

Descriptions are Markdown input, with private artifact references replacing local
image paths. Tests verify rich description transport and recurrence
branches before their command is reported as fully implemented. Structured JSON
replaces terminal formatting. Mocked tests do not establish live permissions.

## Hosted interfaces

All 14 shortcut handlers are exported from `src/capabilities/calendar/index.ts`.
`calendarCapabilities(workflows)` supplies command handlers and
`calendarPrograms(artifacts)` supplies the durable programs. Definitions live in
pure modules so static catalog generation never loads runtime dependencies.

Calendar create and update accept inline Markdown or `@artifact:<id>` in
`description`. An image URL such as `![Diagram](artifact:<id>)` reads an artifact
owned by the current grant and uploads it to Drive with the calendar parent type.
Each checkpoint resolves one distinct image; duplicate references reuse its URL.
Description files are limited to 256 KiB and inline images to 20 MiB. PNG, GIF,
and JPEG dimensions are included when available; unknown formats omit dimension
hints, matching the upstream fallback. Local paths and stdin are replaced by
artifact references and inline values. Artifact reads require artifact permission.

Recurring mutations classify normal events, masters, instances, and exceptions
before any event mutation. Whole-series operations scan yearly windows, preserve
pagination, cap exception state at 5,000 entries, and process one exception at a
time. Time changes delete obsolete exceptions; field-only edits propagate only
explicit changes. Tail operations truncate at midnight in the event timezone and
create the following series with attendee inheritance. Known rate-limit responses
checkpoint bounded backoff; unknown write outcomes propagate to the workflow's
uncertain state. Exceptions that fail definitively are summarized while remaining
exceptions and the master continue. Deleted-event code 193003 is idempotent success.

Room prechecks request existing room attendees before time or recurrence changes.
Unavailable or approval-required rooms return their structured reasons before
writes. The explicit `skip-room-check` input bypasses that precheck. User and bot
identities are selected by the MCP grant; the hosted service never automatically
switches a user calendar operation to a bot calendar.

Single-shot availability commands perform at most two API calls when current-user
identity resolution is needed. Durable steps perform at most one upstream API
operation, plus private artifact IO. UTC replaces the CLI machine-local timezone
only when no explicit timezone or offset is provided.

## Verification

Reusable tests cover RSVP and shared joins, filtered cursor preservation, typed
get projections, search time bounds, transfer recurrence checks, meeting relation
fanout, free/busy interval algebra, room lookup pagination, agenda range splitting,
create compensation, unknown mutation outcomes, image artifacts, recurring scope,
timezone truncation, cancelled exceptions, tail attendee inheritance, unchanged
all-day dates, rate-limit backoff, bounded checkpoint queues, moved exceptions,
and room blocking. These tests mock API responses and do not establish live
Lark app permissions or live client acceptance.

`share-token` is a hosted input alias for the pinned `token` flag on join-event;
conflicting aliases are rejected. Declared mutation scopes match the pinned CLI,
including update-only scope metadata for update's recurrence-read workflow.
