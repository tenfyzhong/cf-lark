# Management authentication with Cloudflare Access

## Contract

Cloudflare Access replaces deployment-secret management login. All allowed
`tenfy.cn` email identities have administrator access to this personal service's
shared applications, accounts, artifacts and MCP consent. This does not introduce
per-user tenant isolation.

A dedicated self-hosted application protects `lark.tenfy.cn/api/admin` (including
children) and `lark.tenfy.cn/consent`. An Allow policy includes only emails ending
in `tenfy.cn`, with an eight-hour session. Email one-time PIN provides login
without another identity provider. No Everyone, Bypass or service-token rule
grants management access.

The root page is a public static shell with a Cloudflare Access sign-in link.
The link targets `/api/admin/access-login`, preserving only a local root or
consent return path. Access authenticates that navigation before the Worker
redirects back. The management API validates Access on every request.

MCP `/mcp` and artifact children, OAuth `/authorize`, `/token`, `/register`,
`/revoke`, discovery `/.well-known/*`, and signed Lark callbacks remain outside
Access. Their existing OAuth, consent, rate limits and callback checks remain.
The OAuth authorization endpoint redirects the user to the protected consent
page; approving consent requires Access and CSRF validation.

## Verification and CSRF

The infrastructure adapter verifies `Cf-Access-Jwt-Assertion` using the configured
team's `/cdn-cgi/access/certs` JWKS, RS256, exact issuer and application AUD.
Expiration, issuance time, subject and an exact `@tenfy.cn` email suffix are
required. Unsigned, forged, expired, foreign-audience, foreign-issuer and
non-human tokens fail closed. An identity email header is never authentication.
Remote JWKS are cached, time bounded and restricted to the configured endpoint.

The session endpoint returns the verified email and a CSRF token bound to that
signed assertion. Mutations require the exact configured Origin and CSRF token.
The old administrator cookie cannot authenticate. Secret login returns HTTP 410
and provisions no session, even if an old secret binding still exists.
Logout validates CSRF and redirects the browser to Cloudflare's
`/cdn-cgi/access/logout`, clearing the legacy cookie as well.

## Configuration and migration

- `ACCESS_TEAM_DOMAIN`: the team's HTTPS cloudflareaccess.com origin.
- `ACCESS_AUD`: the dedicated application's audience tag.
- `ACCESS_EMAIL_DOMAIN`: `tenfy.cn`.
- `ENCRYPTION_KEY`: preserve the existing 32-byte encryption key.

Configure Access through the Cloudflare dashboard, then deploy the Worker with
the actual issuer and AUD. Remove the unused `ADMIN_SECRET` binding after
verification. Existing encrypted applications, accounts, grants, DO namespaces
and the private R2 quota remain. No local secret fallback exists.

Local browser fixtures use signed test JWTs and a loopback-only JWKS server.
HTTP issuers are permitted only when both the service and issuer origins are
loopback HTTP; public deployments require a valid HTTPS Access team origin.
Fixtures never disable signature validation or add a production bypass.

## Acceptance

Tests cover signature, issuer, AUD, expiry, exact email domain, CSRF, local return
path validation, legacy secret/cookie rejection, UI sign-in and logout, and native
MCP PKCE authorization. Live anonymous checks distinguish Access challenges on
management paths from unchanged MCP OAuth challenges. Actual email PIN login
requires access to the user's mailbox. All changes remain on the free tier.
