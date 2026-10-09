# Security and Authorization

Management authentication uses Cloudflare Access email identities limited to
`tenfy.cn`. The service verifies each assertion's RS256 signature, exact issuer,
application AUD, expiry and email domain. Mutations require the canonical Origin
and an assertion-bound CSRF token. Secret login and legacy admin cookies cannot
authenticate. See [Access authentication](cloudflare-access.md).
Dynamic client registration allows ten attempts per IP per five minutes, enforced by an atomic
SQLite counter before the OAuth provider processes the request.

Control-plane JSON and OAuth request bodies are limited to 1 MiB. Raw artifact
uploads use their declared byte reservation instead of this JSON limit.

## Trust boundaries

The administrator, MCP client, service, and Lark platform are distinct principals.
Management uses verified Cloudflare Access assertions, separately from MCP
bearer tokens. Mutation endpoints require an exact trusted Origin and CSRF
token. Cloudflare handles email verification; the service rate-limits dynamic
client registration.

Workers Secrets holds the preserved 256-bit encryption key. Encrypt application
secrets and upstream tokens using AES-GCM with a fresh
nonce and authenticated record identity. Record the key version. Do not expose
secrets in profile responses, errors, URLs, logs, or command execution contexts.

## MCP authorization

Use the Cloudflare OAuth provider library behind a tested infrastructure adapter.
Support discovery, dynamic client registration, authorization code with PKCE S256,
refresh, and revocation. Require PKCE for all clients. Enforce exact redirects,
canonical resource audience, requested/granted scope intersection, and expiry.

The administrator selects allowed profiles, accounts, domains, and read/write
permissions on a consent page. Persist this immutable grant selection. New
accounts and changes to global defaults do not enlarge existing grants.
Application authorization runs on every tool call and operation continuation.

Authorization codes are single use. Serialize exchange and refresh transitions
against SQLite state, including library storage calls. Revocation is authoritative
and immediate for subsequent calls. Do not cache positive grant authorization
across revocation. Persist token hashes rather than plaintext service tokens.

## Upstream authorization

Profiles select exactly one brand: feishu or lark. Application IDs and account
IDs are scoped to profiles. Credentials never cross profiles. User execution
requires the explicitly selected account; bot execution uses the profile's
tenant token. Never fall back from a failed user credential to bot identity.

Device authorization starts with the upstream verification URL and an opaque
local flow ID. Keep the upstream device code server-side. Enforce expiry,
polling interval, slow_down, denial, cancellation, and profile generation.
Validate account identity before persisting tokens. Refresh on demand with a
per-account lock. Token refresh failure requires reauthorization.

Token revocation sends application credentials in the upstream form body, matching
the pinned CLI. A successful empty response is accepted only for revocation;
token issuance still requires a valid JSON token. HTTP failures and explicit
OAuth errors remain failures and never expose response secrets.

Only official, explicitly resolved brand endpoints receive credentials. For raw
API calls, accept an API path rather than an arbitrary origin; reject traversal,
encoded traversal, schemes, credentials, fragments, and caller Authorization
headers. Disable redirects for authenticated upstream requests. Unknown raw
operations require write authorization.

## Events and artifacts

Validate callback signatures and timestamps, decrypt configured payloads, verify
application identity, and deduplicate event IDs before acknowledging persistence.
Expose events only through the original authorized profile.

Event delivery accepts a five-minute timestamp skew and a maximum 1 MiB body.
Lark URL verification uses the configured verification token, as in the official
SDK; ordinary events additionally require the body signature. Encryption uses
the upstream AES-CBC envelope. Events are retained for 24 hours with a bounded
per-profile inbox; callbacks fail closed when persistence is unavailable.

Artifacts belong to a grant or management session. Retrieval, multipart parts,
finalization, and deletion verify ownership and expiration. Private buckets have
no public listing or public access. External downloads must not leak upstream
authorization headers through redirects.

## Verification

Test PKCE mismatch, code replay, redirect mismatch, refresh concurrency, expiry,
revocation, CSRF, account isolation, encrypted record substitution, upstream
redirects, event replay, and artifact ownership. Never infer real OAuth acceptance
from mocked unit tests alone.

## Automatic account scopes

Account authorization discovers the selected application's current permissions
from its application information endpoint using its tenant token. Request every
scope whose `token_types` contains `user`, deduplicate the set, and include
`offline_access` for refresh. Tenant-only permissions are not user OAuth scopes.
Discovery failure stops authorization rather than silently requesting a partial
set. Browser callers do not supply scopes. New application permissions take
effect when authorization is started again; MCP consent restrictions still apply.

Default HTTP transports call the Workers global fetch function without binding
it to a service instance. Runtime coverage must exercise the native fetch path,
not only an injected JavaScript mock.

Workers supports only `follow` and `manual` request redirect modes. Authenticated
upstream transports use `manual` and reject redirect responses. The browser/Node
`error` mode throws during Request construction in Workers before any network
request is sent. Native runtime tests cover both successful requests and redirects.

Consent bulk-selection controls are explicit local UI actions. They do not grant
access until Authorize client is pressed and the existing server-side selection
validation passes. Select all includes write permission only if `mcp:write` was
requested, and does not select user identity for an application without accounts.

Callback verification tokens are authentication material, not event business
data. After verification, the top-level token and header token are removed
before persistence. Inbox reads apply the same projection to historical rows,
so existing stored callbacks cannot expose the verification secret through MCP.
Business fields within the event body are preserved.
