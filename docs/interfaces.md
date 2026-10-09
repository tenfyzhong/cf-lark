# Public Interfaces

Configure callback credentials with `PUT /api/admin/profiles/:id/events` using
`verificationToken` and `encryptKey`. These values are write-only and encrypted
at rest. Lark delivers callbacks to `/callbacks/lark/:profile_id`.
`GET /api/admin/profiles/:id/events?cursor=...&limit=...` reads the persisted
inbox with a monotonically increasing cursor. Repeated event IDs are acknowledged
without duplicate insertion. The inbox retains at most 10,000 events per profile
and 64 MiB of payloads globally, with a 24-hour retention period.
MCP clients use the `event.inbox.read` command through `lark_execute`; the selected
profile and the consented `event` domain determine access. Each read is bounded
to 100 events and returns a continuation cursor.

The management UI provides application profiles, credential rotation, upstream
account login/logout, OAuth grant revocation, consent, and storage usage. Secrets
stay in transient form fields and are cleared after submission. The UI never
stores credentials in browser storage. Device authorization polling is explicit
and displays the next allowed poll time.

Temporary files use `POST /api/admin/artifacts` with a raw body and an exact
`Content-Length`. Metadata is returned as JSON. `GET /api/admin/artifacts/:id`
streams content and `DELETE /api/admin/artifacts/:id` removes it. These routes
require management authentication; upload and deletion also require CSRF.
Storage reservations remain charged after interrupted writes until cleanup
confirms deletion. The bucket has no public access route.

OAuth authorization starts at `/authorize` and redirects to the management UI's
`/consent?handle=...` screen. The opaque, one-use handle is bound to a browser
cookie by the OAuth provider. After management login, the UI reads
`GET /api/admin/consent/:handle` and submits the chosen profiles, accounts,
identities and domains to `POST /api/admin/consent/:handle`. Approval requires
CSRF protection; the server validates every selection against current records.
Token revocation is supported at `/token` as advertised by the provider's
discovery document; `/revoke` is an alias for the same handler.

## MCP

`/mcp` accepts authenticated Streamable HTTP. OAuth resource metadata is published
at `/.well-known/oauth-protected-resource/mcp`; authorization-server discovery is
at `/.well-known/oauth-authorization-server`. Unauthorized MCP requests return
401 with a discovery challenge. Tokens are supplied through the Authorization
header, never URL parameters.

| Tool | Input | Result |
| --- | --- | --- |
| lark_search | query, optional domain, cursor, limit | Command summaries and next cursor |
| lark_schema | command | Schema, examples, scopes, identities, risk |
| lark_execute | command, args, optional profileId/accountId, identity, dryRun | Structured command result |

Search and schema output are restricted to the caller's authorization. Limit
defaults to 20 and is bounded to 100. Unknown commands fail explicitly. Execution
input is validated before any upstream call. Identity is user or bot and must be
explicit. Read-only grants cannot invoke write operations. `api.request` requires
the separate `api` domain: GET requires read permission, while POST, PUT, PATCH,
and DELETE require write permission even though discovery can expose the mixed-risk
command to read-only grants.

Successful command results contain `ok: true`, `identity`, `data`, and optional
`meta`. Failures contain `ok: false`, `identity`, and an error with a stable code,
safe English message, and optional actionable details. MCP failures also set
`isError`. Unknown upstream outcomes are identified rather than called successes.

Long operations return `status: pending` and a `workflowId`. Continue with
`workflow.resume` and `{ "id": "<workflowId>" }`; do not repeat the initiating
write. Scheduled steps also return `nextRunAt` and `retryAfter` in milliseconds.
Each resume rechecks the original grant and selection. Completed resumes replay
the stored result without repeating writes; interrupted writes remain uncertain.

## Management

All `/api/admin/` endpoints require a verified Cloudflare Access identity,
except the retired secret-login handler, which returns HTTP 410. Mutation
requests require exact Origin and assertion-bound CSRF protection. Responses
never return stored secrets or upstream tokens.

- `GET /api/admin/access-login`: redirect an Access-authenticated browser to a validated local management return path.
- `POST /api/admin/login`: retired; returns HTTP 410 and never creates a session.
- `POST /api/admin/logout`: validate CSRF, clear the legacy cookie and return the Cloudflare logout destination.
- `GET /api/admin/session`: verified email and CSRF information.
- `/api/admin/profiles`: list and create application profiles.
- `/api/admin/profiles/:id`: inspect, update, and delete profiles.
- `/api/admin/profiles/:id/accounts`: inspect account authorization status.
- `/api/admin/profiles/:id/login`: initiate device authorization.
- `/api/admin/flows/:id`: inspect, poll, or cancel an authorization flow.
- `/api/admin/grants`: list and revoke MCP grants.
- `/api/admin/usage`: inspect artifact capacity and operation budgets.

Profile creation accepts name, brand, app_id, and app_secret. App ID and brand
are immutable; a different application is a new profile. Secret replacement
increments the credential generation. Removing profiles invalidates their local
authorizations and prevents outstanding work from continuing.

## OAuth and callbacks

Use `/authorize`, `/token`, `/register`, and `/revoke` for OAuth. Consent records
bind the validated client request to a browser session. Approval cannot accept an
unvalidated redirect or scopes supplied by a modified browser form.

`/callbacks/lark/:profile_id` handles upstream verification and events. The
callback has its own cryptographic authentication; an MCP token is not required.

## Artifacts

Artifact creation reserves bytes and returns an opaque ID. Upload operations
support bounded parts; completion verifies the reservation and observed size.
Downloads are streamed. The management UI and MCP use the same artifact service
and ownership checks. Service-owned artifact URLs do not contain upstream tokens.

Account authorization begins with `POST /api/admin/profiles/:id/login` and no
request body. The service discovers the application's enabled user scopes on
every new authorization attempt; caller-supplied scopes are not used. The
management UI has no scope input. Permission-discovery failures are explicit
errors and do not start an authorization with an incomplete permission set.

The MCP consent page provides explicit `Select all` and `Clear all` controls.
Select all chooses every application bot identity, user identities with available
accounts, every available account and domain, and write access only when requested
by the client. Applications without accounts retain bot-only selection. Clear all
resets these selections. Neither control submits consent; the administrator can
adjust individual items before pressing Authorize client. Nothing is preselected
on initial load.

Consent actions disable immediately on submission and display a gray processing
button. A synchronous submission guard prevents duplicate approval or conflicting
denial. Controls remain disabled after a successful response until navigation
completes; a failed request restores the controls for retry and displays the error.

MCP command discovery and schemas include `executionContext.profiles`, containing
only the profile IDs, account IDs and identities already present in the current
OAuth grant. These identifiers are not secrets. Clients use this context without
asking the user to locate internal IDs. `lark_execute.profileId` may be omitted
when exactly one granted profile supports the requested identity and command.
For user identity, `accountId` may be omitted when that profile has exactly one
granted account. Identity remains explicit: use user for personal tasks and bot
for application actions. Ambiguous selections return the authorized choices and
require selection; explicit unauthorized IDs are rejected, never replaced with
defaults. Revoked or expired grants expose no discovery context.

## Worker-safe command validation

Command validation must work during a production Worker request without runtime
JavaScript code generation. Preview and execution use the same validator and
must accept the nested params/body object returned by command discovery. Compile
catalog validators at build time and bundle the generated functions; never use
Ajv.compile in the request path.

A native Wrangler integration check must authorize a local fixture client and
call task-list previews over MCP. Unit tests running under Node and Vitest's
development runtime alone do not establish production compatibility.

## Shortcut command arguments

For `docs.+create`, pass arguments such as
`{"title":"Example","content":"**Hello**","doc-format":"markdown"}`.
For `im.+messages-send`, pass arguments such as
`{"user-id":"ou_recipient","text":"Hello","idempotency-key":"unique-request"}`.
Use the exact schema returned by lark_schema. These examples use flat shortcut arguments;
generated API commands retain their params/body envelope and additionally accept
the typed flags advertised by their schemas. Typed flags override matching keys
in `params`. Preview uses the same validation and request preparation without
upstream calls or writes; artifact-backed inputs may be deferred when no
authorized artifact context is available.

Search results include authorization.permissions, authorization.domains, and
writeAccess. A write scope challenge uses HTTP 403 and WWW-Authenticate. A
client must request mcp:read and mcp:write, and the user must approve the desired
domains and Allow write operations. Existing connections do not gain new domains
or write access when the server's command catalog expands. Consent domain choices
are derived from the actual registered capabilities, including every business
domain and `api`; the UI displays that complete server-provided list. Reauthorize
an existing connection to approve newly introduced domains.

## Streaming artifact sessions

For large input files, create a grant-owned session at
`POST /mcp/artifacts/uploads`, send ordered exact-length 64 MiB parts to
`PUT /mcp/artifacts/uploads/{id}/parts/{partNumber}`, and complete it at
`POST /mcp/artifacts/uploads/{id}/complete`. The final part may be shorter.
`GET /mcp/artifacts/uploads/{id}` inspects progress and `DELETE` aborts it.
See [upload sessions](artifact-upload-sessions.md) for retry and uncertain-write
semantics. Domain file workflows use bounded private range reads. The shared
2 GB accounting includes reservations, intermediate files, and internal encrypted
workflow state; internal checkpoints are not publicly accessible artifacts.

## Raw and generated API options

Invoke `api.request` with `method`, `path`, and optional `params` and `data`
(`body` is an alias). Only GET, POST, PUT, PATCH, and DELETE are supported. A URL
contributes its validated Open API path; credentials are sent only to the selected
Lark brand origin. Query strings belong in `params`, not the path. For example,
`{"command":"api.request","identity":"user","args":{"method":"GET","path":"/open-apis/task/v2/tasks","params":{"page_size":20}}}`
uses the selected authorized account.

Both raw and generated APIs support `page-all`, `page-limit`, `page-delay`,
`file`, `output`, `jq`, `format`, and `json` where allowed by the command schema.
Generated APIs also expose their typed parameter flags and compatibility `yes`
and `dry-run` arguments. Use `lark_schema` for each endpoint's exact options.
`params` and `data` accept JSON values, JSON strings, or `@artifact:<id>` for
private JSON files up to 2 MiB. Multipart file input is
`[field=]artifact:<id>/<filename>` or an artifact object; generated endpoints must
declare an upload field. Binary `output` names a new private artifact. Artifact
read/write permissions are checked separately from API permissions.

Pagination defaults to ten pages and 200 ms between pages. `page-limit: 0` removes
the explicit page cap within the workflow's storage and lifetime limits. Partial
results retain an explicit indication of more data or a later-page failure.
`jq` evaluates the success envelope, including `.data`, and cannot accompany
binary output or non-JSON formats. Its hosted input limit is 1 MiB and 16,384 JSON
values. `ndjson`, `csv`, and `table` return structured records with a requested
format marker; they do not create terminal-formatted text. See
[raw API execution](raw-api.md) and [typed API execution](typed-api-execution.md)
for conflict rules, transfer bounds, and response adaptations.
