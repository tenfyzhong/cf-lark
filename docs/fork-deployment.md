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
   the Workers Free plan. Obtain its **Account ID** from the Cloudflare account
   dashboard; it is a 32-character hexadecimal identifier, not a Zone ID.
2. Add your domain to that account and ensure its Cloudflare zone is active.
   Choose a hostname such as `mcp.example.com`. The workflow attaches it as a
   Worker Custom Domain; reserve it for this service and resolve conflicting
   DNS records or existing Worker bindings before deployment.
3. Activate R2 and create a **private Standard bucket**, for example
   `cf-lark-private`. Keep public access disabled. Configure one-day object
   expiration and incomplete multipart upload cleanup as described in
   [deployment](deployment.md). The workflow binds an existing bucket; it does
   not create it or activate R2.
4. Configure Cloudflare Access using [Access setup](cloudflare-access.md): enable
   email one-time PIN, create a self-hosted application protecting your host's
   `/api/admin` prefix and `/consent` path, and allow your chosen email domain.
   Use an eight-hour application session. Leave MCP, OAuth discovery and token
   endpoints publicly reachable; they enforce their own authorization.
5. Record the Access **team domain** from your Zero Trust organization settings
   and the application's **Application Audience (AUD)** from its application
   details. The issuer is an HTTPS `cloudflareaccess.com` origin; the AUD is a
   64-character hexadecimal tag. These values must match the application you
   just created, and its policy must match `ACCESS_EMAIL_DOMAIN` below.

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
| `DEPLOY_ENABLED` | Yes to deploy | Exact lowercase `true` enables uploads; use `false` while preparing | Start with `false`, then set `true` |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your selected Cloudflare account's 32-character lowercase hexadecimal ID | Copy **Account ID**, not **Zone ID** |
| `PUBLIC_URL` | Yes | Canonical HTTPS origin using your chosen Custom Domain; no path, query, credentials or port | `https://mcp.example.com` |
| `ACCESS_TEAM_DOMAIN` | Yes | Your Access team's HTTPS issuer; include `https://` | `https://your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | Yes | Dedicated Access application's 64-character lowercase hexadecimal audience tag | Copy **Application Audience (AUD)** |
| `ACCESS_EMAIL_DOMAIN` | Yes | Exact allowed lowercase email domain, without `@` | `example.com` |
| `CLOUDFLARE_API_TOKEN` | Yes | Token scoped to your account and hostname's zone | See token setup below |
| `ENCRYPTION_KEY` | Yes | Standard base64 encoding of exactly 32 random bytes | See key setup below |
| `WORKER_NAME` | No | Public Worker name; lowercase letters/digits/hyphens, 1–51 characters, starting with a letter or digit | Defaults to `cf-lark` |
| `R2_BUCKET_NAME` | No | Existing private bucket name; lowercase letters/digits/hyphens, 3–63 characters, starting/ending with a letter or digit | Defaults to `${WORKER_NAME}-private` |

Examples are placeholders. Replace them with your own settings; the configuration
renderer rejects `example.com`, `example.org` and `example.net` deployment origins.
An optional Secret may be omitted or left empty to use its default.

For `WORKER_NAME=cf-lark`, the deployment creates/updates `cf-lark`,
`cf-lark-docs-engine` and `cf-lark-mail-engine`. Engine names and service bindings
are derived automatically; do not add separate engine-name Secrets.
`R2_BUCKET_NAME` must match the bucket created in step 2.

All ten entries use repository **Secrets**; no deployment Variables are needed.
Each fork must configure its own settings. Do not paste real values into source,
workflow YAML, PRs or issues.

A renamed GitHub repository does not automatically change Worker or bucket names.
Different forks in the same Cloudflare account should use distinct `WORKER_NAME`,
`R2_BUCKET_NAME` and service hostnames to avoid updating each other's installation.
Keep those names stable after the first deployment.

### Create the Cloudflare API token

In Cloudflare, open **My Profile → API Tokens → Create Token**. Start with the
Workers editing template or configure a custom token with these permissions:

| Resource | Permission | Access |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| Account | Workers R2 Storage | Edit |
| Zone | Workers Routes | Edit |
| Zone | Zone | Read |

Restrict account resources to the account identified by `CLOUDFLARE_ACCOUNT_ID`
and zone resources to the zone containing `PUBLIC_URL`. An IP restriction must
permit GitHub-hosted runners; do not restrict the token to your home IP.
Cloudflare Access configuration is performed separately and does not require
Access policy editing rights on this deployment token. Store the generated token
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

1. Confirm the bucket, Access policy and all eight required Secrets are ready.
   Set `DEPLOY_ENABLED` to `true`.
2. Open **Actions → Cloudflare → Run workflow**. Select the **main** branch and
   click **Run workflow**. Changing a Secret does not itself start
   a run; use this manual action after configuration changes.
3. Watch **Verify**. It checks generated schemas, TypeScript, unit tests,
   module boundaries, minified Worker builds, native runtime/engine tests and
   Chromium browser tests. It needs no production Secrets.
4. After verification succeeds, watch **Deploy production**. It validates your
   settings, prepares private files, deploys both internal engines, and uploads
   the public Worker together with its encryption key.
5. Open your `PUBLIC_URL` to visit management, sign in using an allowed email,
   and configure a Lark application and account. Connect an OAuth-capable MCP
   client to `${PUBLIC_URL}/mcp`, then approve the requested MCP permissions.
6. Check OAuth discovery at `${PUBLIC_URL}/.well-known/oauth-authorization-server`
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

The workflow does not create the R2 bucket, activate subscriptions, provision
Access identities/policies, or register Lark accounts. Keep the selected Workers
plan and resource limits consistent with [deployment](deployment.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No **Run workflow** button | Enable Actions in your fork and ensure the workflow exists on the default `main` branch |
| **Deploy production** or its steps skipped | Use `main`, ensure **Verify** passed, and set repository Secret `DEPLOY_ENABLED` to exact `true`; PR skipping is expected |
| `Missing NAME` / `Invalid NAME` | Add the named repository Secret; check the formats in the tables, replace placeholder origins, and use base64 encoding of exactly 32 bytes for the key |
| Cloudflare authentication/permission error | Check API token expiry, account/zone restrictions, token permissions and the account ID; do not substitute Wrangler OAuth credentials |
| Bucket not found | Activate R2 and create the exact `R2_BUCKET_NAME` in the selected account |
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

### Prepare private configuration

Copy the three templates before editing:

```sh
cp wrangler.jsonc wrangler.production.jsonc
cp wrangler.engine-docs.jsonc wrangler.engine-docs.production.jsonc
cp wrangler.engine-mail.jsonc wrangler.engine-mail.production.jsonc
```

These production copies are ignored by Git. Set `CLOUDFLARE_ACCOUNT_ID` explicitly
for every Wrangler operation, or add the same account ID to all three private
copies. Create a private R2 bucket in that account. In the public configuration:

- Set the custom-domain route and `PUBLIC_URL` to your own HTTPS origin.
- Set `ACCESS_TEAM_DOMAIN` to your Access team's HTTPS issuer, `ACCESS_AUD` to
  the dedicated application's audience, and `ACCESS_EMAIL_DOMAIN` to your exact
  permitted email domain.
- Set `ARTIFACTS.bucket_name` to your own private bucket. Keep the default
  aggregate `MAX_STORAGE_BYTES` at 2,000,000,000 unless intentionally changed.
- If changing Worker names, update both engine configurations and their public
  service binding names together. Keep the engine routes and preview URLs off.

Reuse the resource/Access setup and encryption-key instructions above. Upload
the public Worker encryption secret using its production configuration before
first use; retain the same key for upgrades. Never upload it to private engines.

### Deploy

Authenticate Wrangler to your own account, activate R2, install the locked
packages and run the documented checks. `pnpm deploy` uses the three private
production copies; `pnpm deploy:engines` deploys only their internal engines.
`pnpm build` continues to use the tracked templates for independent size checks.
Create and configure all three copies first; a missing configuration causes
Wrangler to reject that component's deployment.

Use your configured `PUBLIC_URL` to visit management and `${PUBLIC_URL}/mcp` for
MCP clients. Verify discovery URLs, Access login/logout, existing data when
upgrading, and your upstream Lark application callback settings. Live checks use
`LARK_LIVE_URL` and optionally `LARK_LIVE_ACCESS_COOKIE_FILE`.

The repository's verification history anonymizes deployment identifiers. Example
hostnames in those records are illustrative and do not name a public service.
