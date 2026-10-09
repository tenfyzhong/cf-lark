# Deploy with GitHub Actions

This guide deploys your own fork using GitHub Actions. You do not need Wrangler
installed locally. Deployment settings belong in GitHub repository Secrets; do not edit the tracked Wrangler templates with personal values.

The workflow is [`.github/workflows/cloudflare.yml`](../.github/workflows/cloudflare.yml).
It checks pull requests and main revisions without production credentials, then
deploys successful main revisions when `DEPLOY_ENABLED=true`. Manual deployment
also runs the checks first. PRs and feature branches never deploy.

## 1. Prepare your fork and Cloudflare resources

1. Fork the repository into your GitHub account. In your fork, open **Actions**
   and enable workflows if GitHub asks. The workflow must exist on `main` before
   you can select **Run workflow**. An unmerged implementation PR is not a
   deployable main revision.
2. Select one Cloudflare account for all three Workers and the R2 bucket. Keep
   the Workers Free plan. Obtain its **Account ID** from the Cloudflare account
   dashboard; it is a 32-character hexadecimal identifier, not a Zone ID.
3. Add your domain to that account and ensure its Cloudflare zone is active.
   Choose a hostname such as `mcp.example.com`. The workflow attaches it as a
   Worker Custom Domain; reserve it for this service and resolve conflicting
   DNS records or existing Worker bindings before deployment.
4. Activate R2 and create a **private Standard bucket**, for example
   `cf-lark-private`. Keep public access disabled. Configure one-day object
   expiration and incomplete multipart upload cleanup as described in
   [deployment](deployment.md). The workflow binds an existing bucket; it does
   not create it or activate R2.
5. Configure Cloudflare Access using [Access setup](cloudflare-access.md): enable
   email one-time PIN, create a self-hosted application protecting your host's
   `/api/admin` prefix and `/consent` path, and allow your chosen email domain.
   Use an eight-hour application session. Leave MCP, OAuth discovery and token
   endpoints publicly reachable; they enforce their own authorization.
6. Record the Access **team domain** from your Zero Trust organization settings
   and the application's **Application Audience (AUD)** from its application
   details. The issuer is an HTTPS `cloudflareaccess.com` origin; the AUD is a
   64-character hexadecimal tag. These values must match the application you
   just created, and its policy must match `ACCESS_EMAIL_DOMAIN` below.

This installation shares administrator access among permitted Access identities.
Use your own resources and credentials. For an existing installation, retain its
Worker names, bucket, encryption key and migration history to preserve data.

## 2. Add deployment configuration Secrets

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
| `WORKER_NAME` | No | Public Worker name; lowercase letters/digits/hyphens, 1–51 characters, starting with a letter or digit | Defaults to `cf-lark` |
| `R2_BUCKET_NAME` | No | Existing private bucket name; lowercase letters/digits/hyphens, 3–63 characters, starting/ending with a letter or digit | Defaults to `${WORKER_NAME}-private` |

Examples are placeholders. Replace them with your own settings; the configuration
renderer rejects `example.com`, `example.org` and `example.net` deployment origins.
An optional Secret may be omitted or left empty to use its default.

For `WORKER_NAME=cf-lark`, the deployment creates/updates `cf-lark`,
`cf-lark-docs-engine` and `cf-lark-mail-engine`. Engine names and service bindings
are derived automatically; do not add separate engine-name Secrets.
`R2_BUCKET_NAME` must match the bucket created in step 1.

Store `CLOUDFLARE_ACCOUNT_ID` and every other configuration value in **Secrets**.
Do not create repository Variables for deployment. The two credentials below
also belong in **Secrets**. Each fork must configure its own
settings; the upstream repository's settings are not copied into a fork.

## 3. Add credential Secrets

Open **Settings → Secrets and variables → Actions → Secrets** in your fork.
Select **New repository secret** for each of these exact names:

| Secret | Required | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token restricted to your deployment account and zone |
| `ENCRYPTION_KEY` | Yes | Standard base64 encoding of exactly 32 random bytes |

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

## 4. Run the first deployment

1. Confirm the bucket, Access policy, six required configuration Secrets and both Secrets
   are ready. Set `DEPLOY_ENABLED` to `true`.
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
[using Secrets in conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets). Set `DEPLOY_ENABLED=false` to suspend future
uploads. Deployments are serialized without cancelling a rollout in progress.
The workflow does not merge PRs.

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
