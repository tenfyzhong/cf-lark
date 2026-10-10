# Opt-in cloud OAuth v3 and DPoP

## Contract and acceptance criteria

The default deployment remains legacy OAuth with Bearer tokens. Explicit deployment
configuration selects `LARK_OAUTH_PROTOCOL=oauthv3`; `LARK_DPOP_MODE` is `disabled`
(default), `preferred`, or `required`. Non-disabled DPoP with the legacy protocol
is invalid configuration. These settings apply to user authorization; tenant/bot
credentials retain their existing authenticated tenant-token endpoint and Bearer scheme.

- OAuth v3 uses the selected brand's accounts origin at `/oauth/v3/token` for new
  user tokens and refreshes. Device authorization and revocation retain their
  existing endpoints. Existing credentials retain their issuance protocol on refresh.
- Preferred and required issuance use an ES256/P-256 proof key generated for the
  authorization flow. Preferred may accept an explicit Bearer response during
  initial issuance. Required rejects it. Neither mode retries a failed proof as
  Bearer. This deliberately avoids ambiguous issuance fallback.
- Every bound resource request uses `Authorization: DPoP` and a fresh signed proof
  containing a random `jti`, uppercase `htm`, query/fragment-free `htu`, integer
  `iat`, and SHA-256 access-token hash `ath`. Token proofs omit `ath`.
- The public JWK and RFC 7638 thumbprint must match the private key. Missing,
  corrupt, or inconsistent bindings fail locally. Bound refresh must return DPoP;
  it never silently becomes Bearer, even when deployment mode is later disabled.
- Required mode blocks existing unbound user accounts pending reauthorization.
  The token-only compatibility accessor cannot expose a bound token as Bearer.
- Flow and account private keys are encrypted using record-specific SecretBox
  contexts. Public management responses contain no private keys, device codes,
  access tokens, refresh tokens, or proof JWTs. Flow key material is removed when
  authorization terminates. Existing JSON records without new fields remain valid.
- Redirects are not followed. Proof-bearing requests are not automatically replayed.
  Token rejection preserves the stored credential and key for explicit recovery.

## Verification boundary

Unit and Cloudflare runtime fixture tests cover defaults, both brand endpoints,
proof signatures and claims, request freshness, encrypted persistence, refresh,
required-mode rejection, and no-downgrade behavior. They do not create real grants
or use existing credentials. Live OAuth v3 availability, tenant security policies,
revocation behavior for bound tokens, nonce challenges, and server clock recovery
require separately authorized staging verification. Nonce negotiation and automatic
clock correction are not implemented; rejections fail closed without replay.

Cloud keys use encrypted software storage, not the upstream CLI's platform-backed
keychain/TPM signing. This is a cloud adaptation, not a claim of local signer parity.

## Wire contract and verification evidence

The compatibility reference is the upstream `lark-cli` commit
`9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d`, specifically
`internal/auth/device_flow.go`, `internal/auth/uat_client.go`, and
`internal/dpop/dpop.go`. Device token polling sends form-encoded parameters;
OAuth v3 refresh sends JSON, matching those callers. Proof validation uses the
existing `jose` dependency and Cloudflare WebCrypto; no new dependency is needed.

Reusable regression suites:

- `test/cloud-oauth-dpop.test.ts`: brand endpoints, explicit opt-in, modes,
  proof verification/freshness/hash, canonical URLs, private/public mismatch,
  proof rejection, persisted protocol choice, and required-policy tightening.
- `test/cloud-credential-dpop.test.ts`: encrypted flow/account bindings,
  restart recovery, refresh concurrency, preserved credentials on rejection,
  missing/corrupt keys, flow cleanup, and read-only diagnostics.
- `test/http-authorization.test.ts`: proof-aware resource transport and legacy
  Bearer compatibility.
- `test/runtime/cloud-dpop.test.ts`: native WebCrypto and Durable Object SQLite
  persistence, bound refresh after disabling issuance, JSON/stream/upload/download
  proof boundaries, and rejection before network activity.

The initial endpoint regression failed against the unchanged legacy adapter
(expected accounts `/oauth/v3/token`, received Open API `/authen/v2/oauth/token`).
The credential lifecycle regressions then failed for missing persisted proof
state and the absent proof-aware accessor before their implementations were
added. A policy-tightening regression also failed before requiring the stricter
current mode for an existing preferred flow. These are local fixture tests, not
live OAuth verification.

Setting these variables in production changes authorization policy and can cause
new private keys or upstream grants to be created when a user next authorizes.
Enabling them requires the deployment owner's explicit approval and a separately
authorized staging authorization. This change does not enable them, migrate real
accounts, request live grants, or alter production configuration. Keep a tested
recovery plan: bound credentials continue using their keys when issuance is
later disabled; replacing them with Bearer credentials requires a fresh, explicit
authorization rather than an automatic fallback.

## Refresh error compatibility

OAuth errors returned during refresh, including `invalid_grant` and `expired_token`,
are authorization failures (`UPSTREAM_AUTH_ERROR`, HTTP 401), never malformed token
payloads (HTTP 502). Only device polling may return the recognized OAuth polling
states to its caller. Bound refresh must still identify proof rejection as
`DPOP_TOKEN_REJECTED` without exposing provider descriptions or retrying as Bearer.
Regression acceptance covers successful and error HTTP envelopes, ordinary refresh
errors, proof errors, and unchanged device-polling states using local fixtures.
