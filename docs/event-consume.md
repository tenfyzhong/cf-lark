# EventKey consumption

The pinned CLI has 25 EventKeys in addition to its legacy `event.+subscribe`
shortcut. The hosted contract exposes catalog listing, parameter/schema discovery,
consume start/poll, status, and stop. Mail is not part of this pinned EventKey
catalog. Its independent mail watch shortcut retains its own API contract.

A consumer belongs to one MCP grant and execution selection. Durable cursors,
emit counts, timeout deadlines, processing checkpoints and output artifacts replace
local processes, NDJSON pipes, filesystem directories and the daemon socket. Each
poll processes bounded work and returns structured emissions plus its consumer ID.
A client resumes with that ID; starting another consumer is a distinct operation.
JQ uses the exact pinned gojq implementation through the shared pure adapter.

The service validates EventKey identities, parameters, required business domain
authorization and output artifact permission before setup. App callbacks are
profile-wide: consumer ownership isolates state and outputs. Account-restricted user grants
only receive events whose recipient can be proven to match the selected account.
Ambiguous envelopes require an explicit bot/app-level event grant; otherwise they
are dropped with diagnostics. Profile equality alone never establishes access.

Subscription groups are keyed by profile, identity, account, EventKey and the
server's resource identity. Whiteboard IDs create separate groups. Group setup
and cleanup have durable transition locks; another consumer never joins a group
whose setup or teardown is in progress. Refcounts prevent one consumer stopping a
shared upstream subscription. Task and card keys allow one active consumer per
group. Approval and Task setup create durable upstream relations and have no
unsubscribe API in the pinned implementation. VC, Minutes and Whiteboard clean up
only when their last consumer stops. Expired consumers need scheduled cleanup.

Unknown setup, processing-write or teardown outcomes remain uncertain and are not
automatically repeated. Definite setup failures retain progress and diagnostic
context. Callback verification, deduplication and verification-token stripping
remain in the existing callback pipeline.

Processors preserve native envelopes for native EventKeys and produce the pinned
custom projections for message/card/application, approval, meeting lifecycle,
recording, note and minute events. Enrichment uses bounded retries with persisted
backoff rather than sleeping inside a Worker. Local timezone output becomes UTC;
explicit source timestamps and business payloads are otherwise preserved.

## Exported interfaces and integration

`EventConsumeService` receives an `EventConsumerStore`, callback inbox,
`ArtifactStore`, optional exact JQ adapter and optional interactive-card formatter.
`eventConsumerCapabilities(service)` exports five service commands.
`eventConsumerDefinitions` is pure static metadata.
`createEventConsumerCleanup(service, createClient)` supplies an alarm callback.
The encrypted `SqliteEventConsumerStore` owns separate consumer, group and member
tables; no callback payload or callback credential is copied into group indexes.
The inbox exposes `tail(profile)` and `configured(profile)` through its Durable
Object without exposing callback credentials.

A new consumer starts at the inbox tail. Supplying `cursor` explicitly opts into
retained-event replay. Polling handles at most one matching event per invocation,
and advances across nonmatching events. Successful JQ output counts as an emit;
only the first JQ result is emitted, including JSON null, matching the pinned CLI.
Quiet mode suppresses per-event diagnostics. Output directories are logical
artifact filename prefixes. The consumer ID replaces a local process ID.

The 25 definitions and resolved output schemas in `catalog.json` were extracted
from lark-cli 1.0.97 at commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6` using `event list --json`.
Nine common envelope descriptions were translated into English. The source is
copyright Lark Technologies Pte. Ltd. and distributed under the MIT license.

None of the pinned user EventKey output contracts supplies a trustworthy recipient
account field. Until recipient routing is available, account-only user consumers
advance their cursor with `recipient_not_proven` diagnostics and emit no ambiguous
payload. A grant that explicitly includes bot event access may consume the app
profile's events while using a user identity for upstream subscription APIs.
Actor, organizer, assignee and arbitrary payload fields never prove a recipient.
The direct inbox command is bot-only to prevent bypassing this restriction.

## Platform adaptations and verification boundary

There is no daemon process to discover, kill or share across operating-system
users. Status and stop address durable consumers owned by the current grant;
local PID, socket, SIGKILL and orphan-process flags have no server equivalent.
App console permission preflight remains an upstream configuration prerequisite;
verified callback readiness is checked before setup. Live permissions and callback
delivery must be verified with the deployed app. Unit tests prove state ownership,
subscription sharing/cleanup, singleton locks, uncertainty handling, native and
custom projections, privacy filtering, exact JQ result handling and timeout cleanup.

Consumer storage is capped at 100 active records per grant, 1,000 retained records
and 32 MiB of encrypted consumer payloads. Stopped records expire from storage one
day after their deadline. Uncertain records retain their audit state and are not
silently discarded or replayed.

Visibility is rechecked for persisted enrichment checkpoints after every grant
change. Rejected app events expose no event identifiers. Cleanup skips in-flight
and uncertain operations so frozen records cannot starve eligible expirations.

Grant revocation writes a durable owner tombstone before attempting unsubscribe.
The tombstone blocks starts, reads and resumed emissions even if stale grant props
are supplied. Scheduled cleanup retries definite failures using each consumer's
captured execution selection. Unknown outcomes remain frozen. Provider revocation
succeeds independently of best-effort upstream cleanup. The deletion trigger resolves the service grant ID from OAuth grant metadata.

The OAuth SQLite adapter captures actual provider grant deletion with an atomic
SQLite trigger into a revocation outbox. It validates the pinned provider key and
record shape and stores only `metadata.grantId`, never token material. Access-token
revocation leaves the grant intact and does not stop other sessions. A post-delete
hook attempts outbox delivery; the alarm drains remaining intents. Grant deletion
and expiry purge both use this path. Event cleanup marks the owner revoked before
network work, preserving retry intent if upstream unsubscription fails.

Immediate revocation attempts at most ten consumer teardowns; remaining records
stay eligible for the scheduled cleanup batch. One outbox owner is delivered per
provider grant deletion. Alarm integration can choose its own bounded drain limit.
