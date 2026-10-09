# Architecture

## Deployment boundary

The deployment contains the public `cf-lark` Worker, static management assets,
SQLite-backed Durable Objects, a private R2 Standard bucket, and two private
service-binding Workers: `cf-lark-docs-engine` and `cf-lark-mail-engine`. No paid Workers plan, external
database, container host, or permanent upstream WebSocket is required.

The entry Worker routes and streams requests. Substantial request processing is
performed in Durable Objects to keep the entry point within Workers Free CPU
limits. Pure document/Base/card and Mail transformations run in each private
engine Worker's own SQLite Durable Object. The engines expose no public route
and receive no credentials, OAuth grants, encryption key, or R2 binding. Each of
the three scripts must pass the independent 3 MiB compressed free-tier build
gate. See [private engines](pure-engines.md). Long operations execute bounded
steps with persisted progress.

## Modules

| Module | Owns | May depend on |
| --- | --- | --- |
| domain | Models, policies, errors, state transitions | Pure utilities |
| ports | External boundary contracts | domain |
| application | Use cases and authorization orchestration | domain, ports |
| capabilities | Command metadata and domain handlers | domain, ports |
| adapters | MCP, management HTTP, OAuth HTTP, callbacks | application, domain, ports, transport SDKs |
| infrastructure | SQL, R2, Lark HTTP, encryption, OAuth library | domain, ports, platform SDKs |
| bootstrap | Explicit construction and registration | All server modules |
| ui | Management screens | Public HTTP contracts |

Dependencies point inward. No domain may import another domain's private
capabilities. Cross-domain workflows use public command contracts. No mutable
global registry, service locator, catch-all context, or generic repository
framework is permitted. Architecture tests reject forbidden edges and cycles.

Transport DTOs, domain values, and persistence records are separate when their
semantics differ. Typed application errors are mapped to HTTP and MCP errors at
the adapters; internal exceptions and credentials are never sent to clients.

## Execution

A capability has a stable identifier, JSON input schema, domain, identity set,
scope requirements, risk classification, and handler. The application dispatcher
validates input and authorization before building an authorized execution context.
Handlers receive a bound upstream client and selected authorization context.
Artifact, workflow, and transformation ports are injected explicitly by factories;
application secrets and refresh tokens never enter command arguments.

Generated API descriptors and handwritten shortcuts are separate. Catalog
generation runs during development/build, never by evaluating user input.
Adding a command requires a module and explicit registration, not changes to
authentication, routing, or storage.

## Stateful responsibilities

The personal deployment uses a service authority for OAuth, management and
credentials, and a separate event-inbox Durable Object. Callback persistence
does not wait behind upstream API requests or token refresh. The event inbox
receives configuration only through private Durable Object RPC from authenticated
management routes. Profile removal clears its callback configuration and inbox.

OAuth state, credential refresh, artifact accounting, operations, and event inboxes
have explicit owners. Durable Object classes adapt storage and scheduling to
application services; business logic is testable without a Cloudflare runtime.
OAuth exchanges are serialized across the full read/validate/write transition.
SQL transactions protect local state; network calls do not run inside SQL
transactions. Upstream refresh uses a per-account single-flight lock and a
credential generation check before saving results.

Long operations persist immutable identity and grant references, input, status,
cursor, partial result, and error. States are pending, running, completed, failed, and uncertain. Every continuation checks grant validity. Writes with
unknown outcomes are not retried automatically. Clients call `workflow.resume`
with the returned workflow ID; scheduled continuations return `nextRunAt` and
`retryAfter` without blocking a Worker or running automatically in the background.
Completed resumes return the stored result without repeating upstream writes.

Large workflow state and output spill into chunk-encrypted private R2 objects,
using internal workflow-specific ownership and the same aggregate artifact quota.
This does not require public artifact write consent for read-only workflows.
SQLite compare-and-swap references and expiring reader leases protect snapshots
and cleanup. Records are bounded to 32 MiB serialized, 100,000 values, and 128
nesting levels; excess input fails explicitly. Completed records drop
intermediate state. See [workflow storage](workflow-storage.md).

## Temporary files

Reserve bytes atomically before upload, including in-progress multipart uploads.
The default cap is 2,000,000,000 bytes. Finalization checks actual size and owner.
Artifacts expire after 24 hours. Streaming HTTP upload/download, exact range
reads, and resumable 64 MiB upload parts keep transfers bounded. Merge inputs,
outputs, upload reservations, and internal workflow objects share the quota;
large transformations may require additional temporary capacity. Monthly Class A and B limits are 100,000 and
1,000,000 respectively. Every attempt, including retries, consumes its budget
before an R2 call. Cleanup remains available after budget exhaustion. Storage
reservations are released only after confirmed deletion or upload abortion.

## Architecture decisions

1. Use explicit ports instead of coupling use cases to Cloudflare SDK objects.
2. Use service-owned OAuth tokens instead of passing Lark tokens to MCP clients.
3. Use SQLite-authoritative OAuth state instead of eventually consistent grants.
4. Use three discovery/execution tools instead of loading every command into MCP
   client context.
5. Preserve business coverage in a pinned manifest; incomplete entries prevent
   a full-compatibility release.

## Capability composition and schema completeness

Keep the static definition catalog independent of runtime dependencies so the
build can precompile every registered schema without importing platform code.
A single capability factory composes production and native-test registries from
injected event, artifact, and workflow ports. A contract test compares its full
definition set against the static catalog. Adding a domain therefore requires
both a real handler and a matching build-time definition; drift fails checks
before deployment. The inventory still separately tracks upstream parity.

## Discovery and authorization

The hosted catalog contains 531 business shortcuts, 251 API descriptors, and 25
event keys from the pinned CLI baseline. Seven local Apps commands are explicitly
excluded; see [compatibility](compatibility.md). OAuth consent restricts discovery
and execution to granted domains, profiles, accounts, identities, and permissions.
Discovery returns authorized selection identifiers, and the dispatcher infers
profile/account selection only when unambiguous. User and bot identity remain
explicit. Upstream login discovers enabled user scopes for the selected app.

Domain-specific bounds remain explicit in their contracts, including document
parser complexity, Mail MIME sizes, endpoint upload sizes, pagination, and
workflow lifetimes. Hosting on the free tier does not imply unbounded CLI input
sizes or unrestricted account-wide Cloudflare consumption.
