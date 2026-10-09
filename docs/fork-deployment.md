# Fork the repository and deploy with your own Secrets

The primary deployment path is **your GitHub fork → your repository Secrets →
GitHub Actions → your Cloudflare account**. No local Node.js, pnpm or Wrangler
installation is needed for this route. GitHub runners install the locked tools.

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

Follow [Cloudflare resource preparation](github-actions.md#1-prepare-your-fork-and-cloudflare-resources):
select an account, activate your domain's zone, reserve a service hostname, and
create a private Standard R2 bucket. Keep Workers Free and public bucket access
disabled. The default combined temporary-storage cap is **2,000,000,000 bytes**,
with 24-hour retention.

Configure a Cloudflare Access self-hosted application for the service hostname's
`/api/admin` prefix and `/consent` path. Enable email one-time PIN and allow your
chosen email domain. All permitted identities share administration of this
installation. Leave public MCP/OAuth endpoints outside the Access application.
Copy your account ID, team issuer and application AUD from your own dashboard.
See [Access configuration](cloudflare-access.md).

The workflow creates/updates Worker scripts and their bindings. It does not create
the bucket, activate R2 or provision Access policies. Use a fresh encryption key
for a new installation and preserve the original key when updating an existing
one. Never use credentials or namespace IDs from somebody else's deployment.

## 3. Set your fork's repository Secrets

Open **YOUR_OWNER/YOUR_FORK → Settings → Secrets and variables → Actions →
Secrets → New repository secret**. Add each required Secret using your own values.
Do not add Actions Variables or edit the tracked Wrangler templates.

| Secret | Required | What to supply |
| --- | --- | --- |
| `DEPLOY_ENABLED` | Yes to deploy | Start with `false`; change to exact `true` when ready |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your account's 32-character lowercase hexadecimal ID |
| `PUBLIC_URL` | Yes | Your canonical HTTPS service origin, without path/query/port |
| `ACCESS_TEAM_DOMAIN` | Yes | Your HTTPS Access team issuer ending in `.cloudflareaccess.com` |
| `ACCESS_AUD` | Yes | Your Access application's 64-character hexadecimal audience |
| `ACCESS_EMAIL_DOMAIN` | Yes | Your allowed lowercase email domain, without `@` |
| `CLOUDFLARE_API_TOKEN` | Yes | Token scoped to your account and domain's zone |
| `ENCRYPTION_KEY` | Yes | Your installation's base64-encoded 32-byte encryption key |
| `WORKER_NAME` | No | Defaults to `cf-lark`; private engine names derive from it |
| `R2_BUCKET_NAME` | No | Defaults to `${WORKER_NAME}-private`; must identify an existing bucket |

Use [configuration formats and sources](github-actions.md#2-add-deployment-configuration-secrets)
and [token/key setup](github-actions.md#3-add-credential-secrets) for detailed
instructions. Secrets are configured independently in every fork. Do not paste
actual values into issues, PRs, source files or workflow YAML.

A renamed GitHub repository does not automatically change Worker or bucket names.
Different forks in the same Cloudflare account should use distinct `WORKER_NAME`,
`R2_BUCKET_NAME` and service hostnames to avoid updating each other's installation.
Keep those names stable after the first deployment.

## 4. Deploy from your fork

1. Verify all required Secrets, bucket and Access settings, then update the
   `DEPLOY_ENABLED` Secret to `true`.
2. In your fork, select **Actions → Cloudflare → Run workflow → main →
   Run workflow**. Updating a Secret alone does not trigger a deployment.
3. Wait for **Verify** to pass, then check the **Deploy production** steps. The
   private Docs/Mail Workers deploy before the public Worker and its encryption
   key. A failed verification blocks upload; PR/feature-branch runs never deploy.
4. Visit your `PUBLIC_URL`, sign in with an allowed email, and register your own
   Lark application credentials in management. Authorize your Lark user account.
5. Set your MCP client's URL to `${PUBLIC_URL}/mcp` and complete MCP OAuth consent.
   Lark App IDs/Secrets are management records, not additional GitHub Secrets.

Check OAuth discovery, Access sign-in/out, an authorized business operation and
private artifact access as applicable. Successful deployment does not prove that
your Lark application's permissions support every command. Use the
[release smoke checks](deployment.md#public-release-smoke-checks) and
[troubleshooting table](github-actions.md#troubleshooting) when accepting a release.

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

Configure an Access application for your hostname's `/api/admin` prefix and
`/consent` path, with an Allow policy for your email domain and email one-time
PIN. Eight hours is the recommended application session. See
[Access configuration](cloudflare-access.md). Do not protect the public MCP and
OAuth protocol endpoints with Access.

Provision a new encryption key for a new installation and back it up outside
Git. Preserve existing keys and migration entries when updating an installation.
Upload secrets using the public production configuration. Never reuse another
installation's credentials, Access audience, namespaces or secret backup.

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
