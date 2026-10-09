# Verification Evidence

Deployment-specific identities and resource IDs are anonymized. Example
hostnames are illustrative, not live services; verification describes the
original private installation. Forks must record their own acceptance evidence.


## Documentation baseline

Architecture, security, interfaces, compatibility acceptance, and operations were
written before production implementation. The upstream baseline is pinned to
`72579c80027c863ca51d5f9affda72a70ab0d8a6`.

## Status

Implementation and verification are in progress. A preview is deployed and
management/private-storage live checks pass. Full business parity and real Lark
authorization or operations are not established.

Record reusable test commands, expected red-stage failures, green-stage outcomes,
runtime integration results, and live acceptance here as work progresses.

## Local evidence (2026-10-08)

- Unit tests covered authorization, token refresh isolation, AES-GCM record
  binding, URL restrictions, command dispatch, SQL credential/OAuth persistence,
  artifact reservations and monthly budgets. Each production increment began
  with an expected missing-module or missing-behavior failure.
- The official MCP SDK client initialized the transport and discovered exactly
  three tools, requested schema, executed a fixture command, and observed denial
  after grant revocation.
- Workerd tests completed registration, browser-bound consent, S256 PKCE token
  exchange, authenticated MCP discovery, grant revocation and replay rejection.
  Real SQLite Durable Object storage and local R2 bindings were used.
- Playwright with local Chrome verified login, profile creation, secret-field
  clearing, simulated Lark device login, consent selection, usage and logout.
  Simulated device authorization does not establish real upstream interoperability.
- Dependency Cruiser inspected 53 modules and 72 dependency edges without a
  violation. TypeScript 6 is used because the installed analyzer does not support
  TypeScript 7; an empty dependency graph is not accepted as architecture evidence.
- Worker dry-run produced a 365 KiB compressed bundle before the latest UI additions.

The latest `pnpm check` passed 75 unit tests and 7 Workerd integration tests,
including type checking, the architecture check and a deployment dry-run. The
optional live and Wasm probes are excluded unless their environment is configured.
Two management browser tests passed before the revocation HTTP-only change.

## Cloudflare resource evidence

Account: `example.com` (`<cloudflare-account-id>`).
Bucket: `cf-lark-private`, Standard storage class, created on 2026-10-08.
Wrangler verified that public `r2.dev` access is disabled and no custom domains
are connected. The bucket has an enabled one-day expiration and incomplete
multipart-abort lifecycle rule.

Preview URL: `https://mcp.example.com`.
MCP URL: `https://mcp.example.com/mcp`.
Initial workers.dev preview version: `3657ebe8-7fb2-427c-aaa5-cbfc24cd00a3`.
Cloudflare reported 44 ms startup and a 1,254.37 KiB minified upload. Startup time
is not evidence of per-request CPU compliance.

On 2026-10-09 the reusable `test/live/service.test.ts` passed against the preview:
unauthenticated MCP challenge, OAuth discovery, administrator login, profile
listing, private R2 upload/read/access denial/delete, usage and logout. Fixture
artifacts were removed. The test does not call Lark or establish live MCP OAuth
client interoperability. Secrets were loaded from a private local file and were
not written to the repository or test output.

That preview used the retired secret login. Current opt-in authenticated checks
use `LARK_LIVE_URL` and `LARK_LIVE_ACCESS_COOKIE_FILE`. The latter identifies a
private JSON file containing the current Access session `cookie` string. A proxy-enabled
Node environment may also require `NODE_USE_ENV_PROXY=1`.

Upstream revocation regression tests first reproduced rejection of empty success
responses. The adapter now accepts empty successful revocation responses and
sends application credentials in the form body, matching the pinned upstream
contract. Token issuance remains strict and explicit upstream errors fail closed.

## Outstanding acceptance

All shortcut source entries remain pending. Real Lark authorization and operations,
full event-command compatibility, resumable operations, full file workflows and
free-tier runtime measurements remain outstanding. Callback signature validation,
encrypted event settings, deduplicated inbox persistence and bounded inbox reads
have local tests; real event delivery has not been verified. The generated API catalog
does not establish full CLI business parity.

## Custom domain acceptance (2026-10-09)

Bound `mcp.example.com` to the same Worker in the `example.com` account and deployed
version `cccd450c-ef37-457e-8311-5c64a075d283`. The canonical `PUBLIC_URL` is now
`https://mcp.example.com`; the workers.dev route is disabled. HTTPS management
returned 200. Protected resource metadata reports `https://mcp.example.com/mcp`
and the matching authorization server. The existing live acceptance test passed
against the new hostname, including administrator login and private R2 lifecycle.
The application secrets, Durable Objects and private R2 bucket were retained.

## Management error recovery (2026-10-09)

The reported JSON parser error was reproduced as a Cloudflare 1101 response from
`/api/admin/session`. Live tail identified invalid base64 passed to `atob` during
Durable Object construction in version `a867d4c7-6db6-42df-b041-4065e5435482`, a
version newer than the verified custom-domain deployment. The original backed-up
`ENCRYPTION_KEY` was restored independently. The current `ADMIN_SECRET` was kept.
The original management secret now returns 401; authenticated live storage checks
cannot be repeated with that old secret, and no successful current login is claimed.

Regression tests first reproduced malformed-key classification failure, the HTML
JSON parser error, and an uncaught Durable Object startup failure. The fix returns
sanitary JSON at the Worker boundary and a readable UI error for non-JSON
responses. Version `8266c83d-11bc-47a2-ab5d-c5101dc263c6` was deployed preserving
the existing secrets. The check suite passed 78 unit tests and 8 runtime tests.
Both local management browser tests passed after explicitly setting the local
upstream origin. The live Chromium test passed against `https://mcp.example.com`,
verifying page load, JSON 401 session/login responses and the visible invalid
management-secret message without a JavaScript exception.

## Authorization transport and automatic scopes (2026-10-09)

Native Workerd tests reproduced `AUTH_UPSTREAM_UNAVAILABLE` before any outbound
request. An isolated Request construction exposed the actual cause: Workers
rejects redirect mode `error` and supports only `follow` or `manual`. The earlier
fetch-receiver hypothesis did not explain the failure. Both authorization and
business adapters now use `manual` and reject redirect responses. Runtime tests
exercise native fetch against an outbound fixture service, including redirect
rejection, rather than replacing native fetch with a JavaScript mock.

Authorization now discovers application information with the application's own
tenant token, requests all scopes supporting user tokens, deduplicates them and
adds `offline_access`. The management scope input was removed. Discovery failure
prevents starting a partially scoped flow. The service route accepts an empty
request body and ignores caller scope overrides.

Validation passed 81 unit tests, 11 Workerd tests and two local browser tests.
Version `02058696-da45-4362-aaae-d9dd859d461f` was deployed to `mcp.example.com`,
preserving the existing secrets. In the user's existing authenticated browser,
the configured Feishu application successfully returned a real device
authorization link after clicking Authorize account. No upstream credentials
were extracted from the browser. The resulting page was left for the user to
complete consent. Device-token polling and final user consent are not included
in this live acceptance claim.

## Bulk MCP consent selection (2026-10-09)

Added Select all and Clear all controls to the consent page. Browser regressions
first failed because Select all was absent, then passed for both read-only and
write-requesting clients. Coverage verifies available accounts, bot-only profiles,
no initial selection, no automatic submission, clearing, individual adjustment,
and the exact final consent payload. All four browser tests, type checking and
the repository-language check passed. Deployment version
`39595413-9260-4775-b977-cd2d8195969d` serves the updated controls at
`https://mcp.example.com`; HTTPS page and JavaScript asset responses were both 200.

## Consent submission feedback and MCP identity discovery (2026-10-09)

Consent actions now disable synchronously, turn gray and display Authorizing or
Denying while pending. Failures restore the controls; successful responses retain
the disabled state through navigation. The browser regression first reproduced
the enabled button during a held request. Five browser tests subsequently passed,
including failure recovery and the disabled state observed at beforeunload while
the redirect response was held. Version `3f57fce5-ebb1-4234-910b-2aab3a87ee5d`
first deployed this UI behavior.

MCP discovery previously omitted the profile identifiers required for execution.
Search and schema responses now expose only grant-authorized execution choices.
Single-profile/account selection resolves server-side; ambiguous choices remain
explicit, and unauthorized caller IDs never fall back to another identity. New
regressions first failed for missing context and omitted IDs, then passed through
the official MCP client. The full check suite passed 84 unit tests, 11 Workerd
tests, type checking and architecture analysis (54 modules, 74 dependencies).
Version `484c236e-ee1e-49a1-8fde-2ff9b86c9df1` deployed both fixes. The external
GPT client's task query has not been replayed by the agent.

## Service naming migration acceptance (2026-10-09)

- Renamed the existing Worker to `cf-lark` in place; stable Worker ID
  `2220041dcdbe493f9114620013e4efdf` was preserved.
- Deployed version `9b4e34d7-98ae-4cc3-bc91-acbb8894eb07`.
- Both Durable Object namespace IDs remained unchanged:
  `911675a1acb342079cfe9b3bff4dc1fb` and
  `58bc6c642f4a4ba2b212640e62172733`. Cloudflare retains their original
  creation-time display labels; its public namespace API does not expose a label
  update operation. The owning Worker is now `cf-lark`.
- Both secret bindings were preserved without writing secret values.
- Switched the artifact binding to `cf-lark-private`, verified private managed
  access and one-day object/multipart expiry. The retired bucket was empty before
  migration and immediately before deletion.
- Renamed GitHub repository to `tenfyzhong/cf-lark` and updated the local origin.
- MCP SDK server-name regression failed with the previous name, then passed
  with `cf-lark`. Full checks passed: 84 unit tests, 11 runtime tests,
  TypeScript, architecture validation and production build.
- Live checks: management page HTTP 200, anonymous admin session JSON HTTP 401,
  unauthenticated MCP HTTP 401. Existing namespace continuity was verified;
  authenticated user operations were not replayed during the rename.

## Original favicon acceptance (2026-10-09)

- Documented an independent bird visual identity before creating the artwork.
- Added a 64 x 64 local PNG favicon and explicit HTML icon link.
- The favicon integration regression failed before implementation and passed
  afterward. Repository language checks now recognize PNG binary assets instead
  of decoding image bytes as source text.
- Both focused tests and the Vite build passed.
- Deployed version `1434109b-a05e-4cfa-8128-c42bf4743354`.
- Live HTML references the favicon; its response is image/png and its bytes
  exactly match the checked local asset.

## Durable Object namespace replacement acceptance (2026-10-09)

The owner selected migration with existing data retained. The replacement was
documented first and tested with native SQLite Durable Objects before deployment.

- Provisioned `cf-lark_Authority`:
  `<authority-namespace-id>`.
- Provisioned `cf-lark_EventInbox`:
  `<event-inbox-namespace-id>`.
- Froze both sources before copying. The authority snapshot contained one
  application profile, one account, two authorization flows, five OAuth/session
  records, one monthly artifact budget and one request-limit record. Artifact
  and event tables were empty.
- Verified identical source/destination SHA-256 digests:
  authority `deec87a7460989723a46e3270c77113136d388e97e2312606280a0ffe251e62b`;
  events `32fc09a951dfd94c0b97f5b1f3fe3f078009cf9624d63e23d561b5f9eca284e1`.
- Switched bindings only after verified copying. The original browser management
  session remained authenticated and displayed the existing application/account.
- Deployed v3 deletion migration in version
  `2fa6ad52-9cb2-4751-ac3d-5662d6b1977a`. Live namespace inventory confirmed
  exactly the two replacements and absence of both retired namespace IDs.
- Removed temporary migration RPC methods, control implementation and bindings.
  Deleted the temporary migration secret and local token file. Only the original
  ADMIN_SECRET and ENCRYPTION_KEY secret bindings remain.
- Live metadata returns 200; unauthenticated admin/MCP requests return 401;
  the retired migration route returns 404. The original browser session still
  worked after final cleanup.
- Final checks passed: 85 unit tests, 15 runtime tests, TypeScript, architecture
  boundaries and production build. Regression coverage retains record copying,
  digest rejection, retry behavior and event sequence preservation.

## Native Worker command validation repair (2026-10-09)

The client reported INVALID_ARGUMENT for task queries and previews. A native
Wrangler OAuth/MCP regression reproduced valid task-list preview requests failing
with INTERNAL_ERROR, while Ajv logged runtime schema compilation. Unlike the
production Worker, the earlier development test environment allowed dynamic
code generation. The exact external client error mapping remains unverified.

- Replaced request-time Ajv compilation with 239 unique standalone validators
  generated at build time for all API and event command schemas.
- Added a generated-source consistency check and fail-closed handling for
  schemas missing from the deployed bundle.
- The native Wrangler test now passes previews for task.tasks.list and
  task.tasklists.list through OAuth and MCP. Runtime tests execute both commands
  with user identity and mocked upstream responses.
- All catalog schemas are tested with dynamic Function construction disabled;
  malformed argument nesting and string-to-integer coercion remain rejected.
- Added sanitized tool failure warnings containing only tool name and error code.
- Checks passed: 86 unit tests, 17 runtime tests, six browser/native integration
  tests, typecheck, architecture boundaries and production build.
- Deployed version f9a03a27-a2b9-47d2-84b5-5887d2d8b0b0. Public page and resource
  metadata return 200; anonymous admin/MCP requests return 401.
- A real task query from Dots has not been replayed by this verification.

References:
- https://ajv.js.org/standalone.html
- https://developers.cloudflare.com/workers/runtime-apis/web-standards/

## Full implemented-command Worker audit plan

Audit every generated API command and the event inbox capability, including each
supported identity, through the MCP schema, preview and execution interfaces on
native local Wrangler. Use schema-derived synthetic arguments, including optional
fields, and explicit invalid arguments. Assert that previews never request a
token or contact an upstream service.

Execution uses the real HTTP request adapter with an injected local response
sender. Inspect its method, URL and body without contacting Lark. A separate
test-only Worker exposes synthetic grants and must only run through Wrangler's
local development server. It is not a production route or an authorization bypass.
This audit establishes local command plumbing and Worker compatibility, not
real upstream permissions, business correctness or full CLI shortcut coverage.

## Full implemented-command Worker audit results (2026-10-09)

All 252 command cases passed on native local Wrangler: 251 generated API commands
and event.inbox.read, spanning 16 domains. Each case retrieves the MCP schema,
generates synthetic arguments including optional fields, runs both preview and
execution for every supported identity, and verifies invalid argument rejection.

- All previews completed with zero token requests and zero upstream requests.
- API executions used the real LarkHttpClient with an injected response sender;
  HTTP method, encoded path, query values and JSON body matched the preview.
- Event execution used a local inbox fixture.
- No remaining runtime Ajv compilation, eval or Function construction was found
  in maintained production source outside generated modules. All 239 unique
  compiled schemas matched the generator output.
- TypeScript and repository language/whitespace checks passed.
- The reusable audit is test/browser/catalog.spec.ts; its isolated test Worker
  has no production bindings and is run only by local Wrangler.
- This is a server execution-path audit with synthetic inputs and responses.
  It does not establish real upstream permissions, business validation, Dots
  interoperability or coverage of still-unimplemented CLI shortcuts.
- No production implementation change or deployment was needed for this audit;
  the earlier shared-validator repair covers all audited commands.
- The audit covered 451 command/identity combinations. The complete browser and
  native Worker suite passed all 258 tests together, including management,
  consent and OAuth/MCP regression checks.

## Inline document and message workflows (2026-10-09)

A registry-derived inventory contains 538 upstream shortcuts, rather than the
424 source files previously counted. Full compatibility remains false.
The new docs.+create and im.+messages-send handlers implement the inline variants
specified in shortcut-parity.md. They do not implement local resources, media
upload, complete Markdown transformations, attachment workflows, or automatic
bot permission grants. Their full-command inventory status remains pending.

TDD evidence: all 22 shortcut workflow cases initially failed because no handler
was registered. They pass with request-shape, input-validation, asynchronous
completion, failure, and bounded-polling assertions. The inventory test initially
failed because shortcutCommands was absent. The OAuth integration regression
initially received 200 instead of the expected 403 insufficient_scope challenge.

Validation: 109 unit tests passed, 17 Workerd integration tests passed, and 262
browser/native-Worker tests passed. TypeScript, generated-validator consistency,
English-only/whitespace checks, and dependency-boundary checks passed. Four new
native-Worker cases exercise both shortcuts as user and bot with injected
upstream responses; they make no real Lark writes. Actual Dots requests and real
Lark document/message creation have not been verified in this session.

Deployed Worker version: 575c1b44-f0e8-485c-82fa-c02dea2827fd.
The domain remains mcp.example.com and the private R2 cap remains 2,000,000,000
bytes. The deployment preserves existing credentials, OAuth records and secrets.

### Resource scope discovery correction

Live inspection found that protected-resource metadata advertised only mcp:read,
even though authorization-server metadata supported mcp:write. The provider's
requiredScopes setting controls advertised scopes and challenges; its documented
contract leaves enforcement to the handler. Configure both advertised scopes
and retain grant-based read/write enforcement. Runtime regressions verify that
a token narrowed to read still lists tools and performs read discovery, while
write-only discovery, schema lookup and execution can request additional consent.
Protected-resource metadata now advertises both scopes. All 18 runtime tests and
262 browser/native-Worker tests passed after this correction; unit and boundary
checks also passed. A mixed read/write search continues returning authorized
read results and authorization guidance rather than requiring write consent.

Final deployed version: 918f508a-6a35-4eeb-89c2-4ce8b924c94e.

## Cloudflare Access management authentication

On 2026-10-09, the dedicated self-hosted Access application was configured via
computer use after user confirmation and the Worker was deployed with its real
issuer and AUD. Only `/api/admin` and `/consent` are protected by Access; MCP and
OAuth protocol endpoints retain their existing authentication. Verified
`@example.com` email identities use one-time PIN and an eight-hour application
session. Secret login is retired and the `ADMIN_SECRET` binding was removed.

The final main Worker version is `aeceb352-a122-43d7-85cc-1395b0eb28a6` following
secret removal from code deployment `84d32eea-28db-4506-b810-25c2a38b6ba7`.
Read-only Cloudflare settings verified unchanged current DO namespace IDs, R2
bucket and encryption-key binding. No secret values were read or reuploaded.

All 1,422 unit, 60 native runtime and 13 focused local browser tests passed.
Five deployed browser checks and public HTTP authentication/discovery checks
passed. The user completed a real mailbox PIN login; computer use verified the
existing application/account, collapsed scopes, storage usage, Clients and
shared consent-path session. Logout returned Cloudflare's success message.
No production MCP grant, Lark write or authenticated R2 fixture was created.
See [release verification](release-verification.md) for precise evidence bounds.
