# Fork the repository and deploy with your own Secrets

The primary deployment path is **your GitHub fork → your repository Secrets →
GitHub Actions → your Cloudflare account**. No local Node.js, pnpm or Wrangler
installation is needed for this route. GitHub runners install the locked tools.
The workflow is [`.github/workflows/cloudflare.yml`](../.github/workflows/cloudflare.yml).

Each fork is an independent installation. Your Cloudflare account, hostname,
private bucket, Access policy, encryption key and Lark credentials belong to you.
Upstream repository settings and production data are not copied into a fork.
Tracked templates contain illustrative values, not an owner's deployment identity.

## 1. Create your GitHub fork

1. Open the upstream **cf-lark** repository and select **Fork**.
2. Choose your GitHub account or organization as **Owner**, keep or customize
   the repository name, and select **Create fork**. Copying only `main` is sufficient
   once the deployment workflow has been released there.
3. Confirm the repository header now shows **YOUR_OWNER/YOUR_FORK**. All settings
   and workflow runs below must take place in this fork.
4. Open **Actions** and enable workflows if prompted. Confirm `main` contains
   `.github/workflows/cloudflare.yml`; if it does not, wait for the upstream
   implementation to reach main and synchronize your fork before deploying.

See GitHub's [fork instructions](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/fork-a-repo).
Forking creates your deployment source; it does not deploy anything by itself.

## 2. Prepare your Cloudflare installation

1. Select one Cloudflare account for all three Workers and the R2 bucket. Keep
   the Workers Free plan. Actions derives the account from your active DNS zone.
   There is no Account ID deployment Secret to copy.
2. Add your domain to that account and ensure its Cloudflare zone is active.
   Choose a hostname such as `mcp.example.com`. The workflow attaches it as a
   Worker Custom Domain; reserve it for this service and resolve conflicting
   DNS records or existing Worker bindings before deployment.
3. Activate R2 in that account. You do not need to create a bucket manually.
   Actions reads an existing Worker's `ARTIFACTS` binding to retain its bucket.
   For a new installation it derives a private Standard bucket name from the
   automatically selected Worker name and creates it before uploading Workers.
   The provisioner maintains a named `cf-lark-temporary-retention` rule for
   one-day object expiration and incomplete multipart upload cleanup, preserving
   all other lifecycle rules. It never enables public access or deletes a bucket.
4. Enable the Zero Trust Free service in your account if Cloudflare requires
   initial subscription/terms acceptance. Actions discovers or creates the Access
   organization, reuses or creates email one-time PIN, and creates a dedicated
   management application with an eight-hour email-domain Allow policy. Only
   `/api/admin` and `/consent` are protected; public MCP/OAuth stays reachable.
5. Choose the exact permitted email domain yourself. Actions does not infer an
   administrator policy from your service hostname. Existing narrow applications
   for that hostname are discovered and validated before reuse. Team issuer and
   application AUD are always read from Cloudflare, never entered as Secrets.

The default combined temporary-storage cap is **2,000,000,000 bytes**, with
24-hour retention. All permitted Access identities share administration of this
installation. Keep existing Worker/bucket names, encryption keys and migration
history when upgrading; use your own resources for a new installation.

## 3. Set your fork's repository Secrets

In **your fork**, open **Settings → Secrets and variables → Actions → Secrets**.
Select **New repository secret** for each row. Use repository Secrets, not
Cloudflare Worker dashboard variables or GitHub Environment variables; the
workflow reads `secrets.*` directly without selecting an Environment.

| Secret | Required | Value and source | Illustrative example/default |
| --- | --- | --- | --- |
| `WORKER_NAME` | No | Explicit instance name for multiple installations; stable on upgrades. With no override, reuse the hostname-bound Worker or default to `cf-lark` for a new installation | Lowercase letters/digits/hyphens, 1–51 characters |
| `DEPLOY_ENABLED` | No | Defaults to `true`; exact `false` suspends uploads | Optional `false` while staging |
| `PUBLIC_URL` | Yes | Canonical HTTPS origin using your chosen Custom Domain; no path, query, credentials or port | `https://mcp.example.com` |
| `ACCESS_EMAIL_DOMAIN` | Yes | Exact allowed lowercase email domain, without `@` | `example.com` |
| `CLOUDFLARE_API_TOKEN` | Yes | Token scoped to your account and hostname's zone | See token setup below |
| `ENCRYPTION_KEY` | Yes | Standard base64 encoding of exactly 32 random bytes | See key setup below |

Examples are placeholders. Replace them with your own settings; the configuration
renderer rejects `example.com`, `example.org` and `example.net` deployment origins.
An optional Secret may be omitted or left empty to use its default.

Only four Secrets are required: `CLOUDFLARE_API_TOKEN`, `PUBLIC_URL`,
`ACCESS_EMAIL_DOMAIN` and `ENCRYPTION_KEY`. `DEPLOY_ENABLED` is an optional control,
and `WORKER_NAME` is an optional namespace selection.
No deployment Variables are needed. Do not add `CLOUDFLARE_ACCOUNT_ID`,
`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `R2_BUCKET_NAME` Secrets;
these identifiers are discovered or derived and old overrides are ignored.
Each fork must configure its own required settings. Do not paste real values
into source, workflow YAML, PRs or issues.

Actions discovers an existing Worker from the Custom Domain matching `PUBLIC_URL`
and reads its bindings to retain the private bucket. For a new installation,
set `WORKER_NAME` to choose a distinct instance name
(default `cf-lark`). Actions refuses to update that name if it belongs to another
hostname. Internal engine names and the new bucket derive from the selected
public Worker. Multiple installations in one account need distinct hostnames
and Worker names; their buckets and Durable Object namespaces stay separate.
An existing
binding with missing/ambiguous service, storage or ownership metadata fails rather
than starting a fresh namespace. Keep the hostname and encryption key stable
when upgrading. Repository renaming does not change deployment identity.
Resource discovery uses the [Worker Domains API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/)
and [Worker settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/).

### Create the Cloudflare API token

In Cloudflare, open **My Profile → API Tokens → Create Token**. Start with the
Workers editing template or configure a custom token with these permissions:

| Resource | Permission | Access |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| Account | Workers R2 Storage | Edit |
| Account | Access: Apps and Policies | Edit |
| Account | Access: Organizations, Identity Providers, and Groups | Edit |
| Zone | Workers Routes | Edit |
| Zone | Zone | Read |

Restrict account resources to the selected Cloudflare account
and zone resources to the zone containing `PUBLIC_URL`. An IP restriction must
permit GitHub-hosted runners; do not restrict the token to your home IP.
Access discovery/provisioning always runs and requires both Access permissions
above, including for an existing installation. Upgrade older deployment tokens
that only have Worker/R2 rights before running deployment. Account discovery
requires Zone Read; no ambiguous account is selected automatically. Store the generated token
as `CLOUDFLARE_API_TOKEN`; do not use a Global API Key, R2 S3 access key, or Wrangler
OAuth login/refresh token. See [Cloudflare token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
and the [Workers GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

### Generate or retain the encryption key

For a **new installation**, generate a key once and back it up outside the
repository. For example, in a local terminal with OpenSSL:

```sh
umask 077
mkdir -p "$HOME/.config/cf-lark"
openssl rand -base64 32 > "$HOME/.config/cf-lark/encryption.key"
```

Run this only when that file does not already hold an existing installation's
key. Copy its base64 value into the `ENCRYPTION_KEY` repository secret, or upload
it directly with an authenticated GitHub CLI:

```sh
gh secret set ENCRYPTION_KEY --repo YOUR_OWNER/YOUR_FORK < "$HOME/.config/cf-lark/encryption.key"
```

For an **existing installation**, use its original encryption key instead of
generating another. Changing the key makes stored Lark application/account
credentials unreadable. This key is not a Lark App Secret or an Access AUD.
Never put it in repository Variables, tracked files, command arguments, screenshots or logs.

Lark App IDs, App Secrets and authorized user accounts are configured later in
management. They are not required as GitHub deployment Secrets.

## 4. Deploy from your fork

1. Confirm account activation and the four required Secrets are ready. Leave
   `DEPLOY_ENABLED` unset for its default `true`, or explicitly set it to `true`.
2. Open **Actions → Cloudflare → Run workflow**. Select the **main** branch and
   click **Run workflow**. Changing a Secret does not itself start
   a run; use this manual action after configuration changes.
3. Watch **Verify**, which calls the [Tests workflow](ci.md). **Unit tests**,
   **Integration tests** and **Release checks** run independently. Together they
   check generated schemas, TypeScript, unit tests, module boundaries, minified
   Worker builds, native runtime/engine tests and Chromium flows. They need no
   production Secrets. All must pass before deployment.
4. After verification succeeds, watch **Deploy production**. It validates your
   settings, resolves account/Access, prepares private files, provisions R2,
   deploys both internal engines, and uploads
   the public Worker together with its encryption key.
5. Open your `PUBLIC_URL` to visit management, sign in using an allowed email,
   and configure a Lark application and account. Connect an OAuth-capable MCP
   client to `${PUBLIC_URL}/mcp`, then approve the requested MCP permissions.
6. Actions runs bounded anonymous discovery/MCP/management smoke checks after
   upload. Complete actual mailbox PIN and Lark acceptance yourself. Check OAuth discovery
   at `${PUBLIC_URL}/.well-known/oauth-authorization-server`
   and verify your Lark application's callback settings. Use the authorized
   live checks in [deployment](deployment.md) when accepting an upgrade.

After setup, every push or merged PR to `main` runs verification and automatically
deploys if enabled. Feature-branch PRs run **Verify** only; **Deploy production**
being skipped there is expected. The main-only job uses step environment
conditions to read the Secret flag; when disabled, upload steps are skipped.
GitHub does not allow direct Secret references in job conditions; see
[using Secrets in conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
Set `DEPLOY_ENABLED=false` to suspend future uploads. Deployments are serialized
without cancelling a rollout in progress.
The workflow does not merge PRs.

Use the [release smoke checks](deployment.md#public-release-smoke-checks) and
[troubleshooting](#troubleshooting) when accepting a release. Successful upload
does not establish real-tenant support for every Lark command.

## 5. Upgrade without changing your deployment identity

Review upstream changes and migration notes before synchronizing. If you want to
stage an upgrade, set your fork's `DEPLOY_ENABLED` Secret to `false` first. In the
fork, use **Sync fork → Update branch** to bring upstream main changes into your
main, or resolve conflicts through a PR targeting your fork's main. See
[GitHub fork synchronization](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork).

A main update can trigger automatic deployment when enabled. Preserve your own
Secrets, encryption key, Worker/bucket names and existing migration records.
Source synchronization does not replace repository Secrets; no personal config
files need to be merged. After a staged upgrade, set the flag to `true` and
manually run **Cloudflare** on main, then verify existing accounts and MCP grants.
Do not delete Durable Object namespaces or rotate the encryption key to fix an
upgrade failure. Follow [operations and recovery](operations.md) instead.

## What the workflow manages

`configure:deployment` validates required inputs before API mutations. Account
lookup tries hostname suffixes from most specific to least, selecting one active
zone only. Access lists are paginated with a fixed page limit. Existing organization
and identity providers are retained. A hostname-matched application must match the narrow
management paths, email-domain-only policy, PIN provider and eight-hour session;
unsafe/ambiguous apps fail instead of being overwritten. A missing app is created,
and an app missing its policy can be repaired on rerun. Derived values are masked
in Actions logs and written only to ignored private configuration. The old
discovery override path is removed; generated runtime fields are still
written privately because Workers need the resolved issuer and AUD.

Worker names, private engines/service bindings, bucket name, Durable Object
namespaces/migrations, custom domain, static assets and validators are derived or
deployed automatically. Post-upload smoke checks verify public OAuth discovery,
unauthenticated MCP rejection and management authentication. They do not perform
real tenant writes or prove mailbox login. The encryption key remains a required
persistent input: GitHub cannot read back encrypted Secrets, and an ephemeral key
would prevent reliable upgrades/backups. Account activation, domain ownership,
API token creation and actual mailbox/Lark OAuth consent remain human steps.

`pnpm provision:r2` reads the generated production configuration and calls the
[Cloudflare bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
with the deployment token. Existing buckets and objects are retained. A creation
race is accepted only after another lookup confirms the bucket exists. Permission,
network and lifecycle failures stop deployment; raw API bodies and credential
values are never logged. Rerunning repairs a partially completed setup. The
managed retention rule is merged with existing rules using the
[lifecycle API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/update/).

The renderer changes account, origin, Access settings, Worker/service names and
bucket bindings while preserving tracked migration tags/classes and limits.
The default combined R2 temporary-storage cap remains **2,000,000,000 bytes**,
with 24-hour retention. No extra Actions Secret changes that default.

Private configuration and the encryption-secret file use mode `0600`, are ignored
by Git and are removed by unconditional cleanup. They are not published as
artifacts. The encryption key accompanies the public Worker via
`--secrets-file`; private engines receive no Lark credentials or encryption key.
Pinned action commits and locked dependencies keep the validation path
reproducible. Type declarations for Vite, Wasm, Go runtime and native Worker tests
are tracked so clean checkouts do not depend on local ignored files.

The workflow creates/reuses the R2 bucket; it does not activate subscriptions,
accept subscription terms or register Lark accounts. It provisions the dedicated
Access application/policy when a matching safe application is absent. Keep the selected Workers
plan and resource limits consistent with [deployment](deployment.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No **Run workflow** button | Enable Actions in your fork and ensure the workflow exists on the default `main` branch |
| **Deploy production** or its steps skipped | Use `main`, ensure **Verify** passed, and leave `DEPLOY_ENABLED` unset or set it to exact `true`; PR skipping is expected |
| Account/Access bootstrap failure | Confirm the active zone belongs to your selected account and the token has the documented Access rights; complete account activation first. Existing applications must match the narrow hostname destinations, PIN login and exact email-domain policy; they are discovered by hostname. Resolve ambiguous/conflicting resources instead of deleting them blindly |
| Deployment smoke checks fail | Check Custom Domain propagation, public OAuth discovery and the narrow Access destinations; Actions retries for a bounded period and does not roll back an uploaded version |
| `Missing NAME` / `Invalid NAME` | Add the named repository Secret; check the formats in the tables, replace placeholder origins, and use base64 encoding of exactly 32 bytes for the key |
| Cloudflare authentication/permission error | Check API token expiry, account/zone restrictions, token permissions and the account ID; do not substitute Wrangler OAuth credentials |
| Bucket not found | Confirm R2 activation and Workers R2 Storage Edit rights; inspect the provisioning step before any Worker upload |
| Custom Domain cannot be attached | Confirm the zone is active in the account and resolve conflicting DNS/Worker ownership for the hostname |
| Access login works but management returns 403 | Match team issuer, application AUD and exact email domain to the configured Access application/policy |
| Existing credentials cannot be decrypted | Restore the installation's original `ENCRYPTION_KEY`; do not regenerate it or delete stored data |
| A private engine succeeds but public deployment fails | Inspect the public upload error, fix the settings and rerun on main; the three-Worker release is sequential, not an atomic transaction |

Review the failing step in **Actions → Cloudflare → run → job**. Correct repository
settings and manually rerun on main. Keep credentials out of bug reports; report
the step, error code and configuration names rather than secret values.

## Alternative: deploy locally

Use this route only if you prefer local Wrangler instead of GitHub Actions.
It is not required for the fork-and-Secrets path above.

### Prepare local production files

Set the same four required environment values locally, keeping the encryption key
and API token out of command arguments and shell history. Then use the identical
bootstrap and R2 provisioners:

```sh
pnpm configure:deployment
pnpm provision:r2
```

They discover account, names and Access, then create the ignored private production
files. No account/team/AUD/name fields need manual entry. The renderer refuses to
overwrite existing private files; retain backups and deliberately remove those
local generated copies before regenerating. Do not replace the encryption key or
remove Cloudflare resources to resolve a local configuration-file conflict.

### Deploy

Authenticate Wrangler to your own account, activate R2, install the locked
packages and run the documented checks. `pnpm deploy:actions` uses the three
private production copies and uploads the generated encryption-secret file with
the public Worker. Run `pnpm verify:deployment` after upload.
`pnpm deploy:engines` deploys only their internal engines.
`pnpm build` continues to use the tracked templates for independent size checks.
Create and configure all three copies first; a missing configuration causes
Wrangler to reject that component's deployment.

Use your configured `PUBLIC_URL` to visit management and `${PUBLIC_URL}/mcp` for
MCP clients. Verify discovery URLs, Access login/logout, existing data when
upgrading, and your upstream Lark application callback settings. Live checks use
`LARK_LIVE_URL` and optionally `LARK_LIVE_ACCESS_COOKIE_FILE`.

The repository's verification history anonymizes deployment identifiers. Example
hostnames in those records are illustrative and do not name a public service.

### Inspect deployment preflight without changes

The Cloudflare workflow has an optional `inspect` input for manual runs. Select
it to inspect an existing installation using the repository Secrets. This mode
only sends GET requests, never creates resources, and never uploads Workers or
writes private deployment files. It reports readiness and named Access
compatibility checks without printing hostnames, account IDs, audiences,
credentials, policies or upstream response bodies. A failed check remains a
failed Actions job. Production deployment remains restricted to main.

Use this mode when bootstrap rejects an existing Access application. Compare
the named checks with the application settings instead of deleting the existing
application or changing its audience. Missing resources require a normal
deployment; inspection refuses provisioning requests.
