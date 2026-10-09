# Deployment and Recovery

## Provisioning

Select your Cloudflare account explicitly using `CLOUDFLARE_ACCOUNT_ID` or the
account ID in all three ignored production configurations. Workers and the
private bucket must belong to that account. Set your canonical HTTPS origin in
`PUBLIC_URL`; its MCP resource is `${PUBLIC_URL}/mcp`. See
[independent fork deployment](fork-deployment.md).

For automatic releases, configure [GitHub Actions](fork-deployment.md). Actions
creates/reuses the private bucket and merges its one-day retention rule before
uploading Workers; existing data and unrelated lifecycle rules are retained. Update
deployment settings in repository Secrets; production identities
do not belong in tracked files. Set `DEPLOY_ENABLED=false` to suspend uploads.

The current hosted implementation surface contains 531 business shortcuts,
251 API descriptors, and 25 event keys; seven local Apps commands are excluded.
Use [deployment](deployment.md) for the three-Worker release sequence. Local
implementation evidence does not establish deployed or live Dots acceptance.

Use Workers Free, SQLite Durable Objects, Workers Static Assets, and one private
R2 Standard bucket. R2 requires activation and can charge beyond its account-wide
free allowance. No paid Workers upgrade is part of this deployment.

Configure a canonical HTTPS public URL, Cloudflare Access team issuer/AUD,
and your own `ACCESS_EMAIL_DOMAIN`. Preserve `ENCRYPTION_KEY` (32 random bytes
encoded as base64). Never put its value in tracked files, command arguments,
browser storage, or logs. Provision the encryption secret via stdin. Management
uses verified Access identities; deployment-secret login is removed. See
[Access configuration](cloudflare-access.md).

The deployment helper creates a new private JSON file containing a
random encryption key, refuses to overwrite an existing file, and sets file mode `0600`.
Keep this file outside Git and back it up securely. Wrangler's `--secrets-file`
option with `--config wrangler.production.jsonc` can upload it with the same
Worker version without printing values.

Keep production and preview namespaces and buckets separate. Production uses
the configured Custom Domain with workers.dev disabled. Private engine Workers
must retain no routes, preview URLs, or workers.dev exposure. Add application callback configuration and required upstream scopes
through the management UI and platform console. Application availability and
scope approval are upstream requirements.

## Defaults

| Setting | Default |
| --- | --- |
| Temporary storage | 2,000,000,000 bytes |
| Artifact lifetime | 86,400 seconds |
| Monthly R2 Class A budget | 100,000 |
| Monthly R2 Class B budget | 1,000,000 |

Quota enforcement reserves capacity before accepting data and fails closed when
accounting is unavailable. Cleanup continues after quota exhaustion. Account-wide
Cloudflare limits can be consumed by other deployments and are not controlled
by this service. Use platform billing notifications in addition to local budgets.

## Recovery

Back up configuration and encrypted state together with a separately protected
encryption key. Restore into isolated namespaces before traffic cutover. Keep
schema versions and forward migrations explicit. Do not restore active OAuth
sessions into a second simultaneously reachable deployment.

Management-secret rotation invalidates browser sessions. Do not rotate the encryption key by replacing its secret value: existing records
require the original key. Any future rotation must use an explicitly implemented
and verified re-encryption migration with recoverable backups. Credential changes invalidate obsolete refresh
results. Revoked grants stop pending operations before the next step.

Use artifact lifecycle rules as a secondary cleanup mechanism. Reconcile
incomplete uploads and expired reservations without making deleted files visible.
Never release storage accounting before confirmed cleanup.

The dedicated bucket uses a one-day object expiration and one-day incomplete
multipart abortion rule as a secondary safeguard. Application reads enforce
expiry independently of Cloudflare's asynchronous lifecycle cleanup.

## Acceptance evidence

Record deployment version, runtime CPU/subrequest measurements, artifact limits,
OAuth client behavior, and tested upstream domains in the verification report.
A local build or mocked test does not prove Cloudflare edge or upstream access.

## Custom domain

Your canonical hostname is bound directly to the existing Worker
with a Wrangler Custom Domain route. Cloudflare manages DNS and the certificate.
`PUBLIC_URL` must match this HTTPS origin so management cookies, CSRF checks and
OAuth resource discovery agree. The previous workers.dev endpoint is disabled.
MCP clients must use `${PUBLIC_URL}/mcp` and authorize against this origin;
management users must sign in again because cookies are host-bound. The existing
Durable Objects, encryption key and private R2 bucket are retained.

## Invalid encryption configuration recovery

`ENCRYPTION_KEY` is the original base64-encoded 32-byte encryption key, not a
management password. Restore the exact backed-up value if it is accidentally
changed; generating a replacement cannot decrypt existing records. Restore this
secret independently; management now uses Cloudflare Access rather than a password.
Worker boundary failures must return a sanitized JSON error. The management
client reports non-JSON responses as service failures without displaying HTML.

Local browser tests explicitly set the Wrangler local upstream to localhost;
otherwise a production Custom Domain route can rewrite the local request origin
and trigger canonical-origin rejection. Live browser tests run with
`LARK_LIVE_URL=<your-origin> pnpm exec playwright test --config
playwright.live.config.ts`. They verify Access sign-in, management challenges and
public MCP/OAuth boundaries. Fixture management responses verify deployed UI
assets without recording production Access tokens.

## Historical service naming migration

The canonical repository, package and Worker name is `cf-lark`. The private
artifact bucket is `cf-lark-private`. The public origin remains
your configured `PUBLIC_URL`, including the existing MCP and OAuth endpoints.

Rename the existing Worker through the Cloudflare Workers Edit API using its
stable Worker ID, with only the `name` property supplied. Do not create a
replacement Worker or replace either secret. Verify that both Durable Object
namespace IDs and the custom domain reference remain unchanged before deploying.
The existing v1 migration must remain intact.

Create the new private bucket with the same one-day expiration and multipart
cleanup rules. Inventory the old bucket before switching bindings. If it contains
objects, copy and verify them before switching; an empty bucket needs no copy.
Delete the retired bucket only after deployment verification and a second empty
inventory. Keep the 2,000,000,000-byte application quota unchanged.

Rename the GitHub repository and update its local origin. Replace the old service
label in maintained source, tests, configuration and documentation. Historical
verification entries use the current resource name for consistency.

## Historical Durable Object namespace replacement

The existing v1/v2/v3 migration history records namespace replacement; preserve
it on subsequent deployments. The private-engine addition does not require
replacing or deleting the active Authority or EventInbox namespaces.

Preserve existing data when replacing creation-time namespace labels. Provision
new SQLite namespaces for Authority and EventInbox while keeping the old bindings
active. A temporary migration control route is protected by a separate random
deployment secret; it never returns table contents or credentials.

Before copying, serialize with normal requests and persistently freeze both old
objects, including alarms and event RPC writes. Copy only the known application
tables and SQLite event sequence, with bounded rows and snapshot size. Import
inside a synchronous storage transaction into an empty target. Verify canonical
SHA-256 digests and per-table row counts before switching bindings. Retries must
be idempotent and reject mismatched existing destination contents.

The public origin, encryption key, administration secret, object names, R2
binding and quota settings remain unchanged. Copy OAuth records, admin sessions,
credentials, event settings/inbox, artifact ledger and operation budgets.
The maintenance interval returns retryable errors instead of accepting writes
that could be lost. If verification fails before cutover, resume the old objects.

After successful copy, route requests to the new namespaces and verify the
application. Only then deploy a deletion migration for the retired classes.
Remove the temporary control route, migration RPC methods and secret after
verification. The migration utility and regression tests remain as operational
documentation. Deleting the old namespaces is irreversible.

## MCP failure diagnostics

Tool failures emit a structured warning containing only the fixed tool name and
sanitized error code. They do not log arguments, profile/account identifiers,
task content, tokens or upstream response bodies. Use a live Worker tail to
distinguish server tool failures from errors rejected by an external client
before a request reaches the service.
