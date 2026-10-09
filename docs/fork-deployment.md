# Deploying an independent fork

Tracked Wrangler files are example templates. They contain no owner's Cloudflare
account, live hostname, Access issuer/AUD or email domain. Example URLs under
`example.com` must be replaced before deployment. A fork is an independent
personal deployment: all permitted Access identities share administrator access.

## Automated deployment

For automatic deployment, follow [GitHub Actions setup](github-actions.md).
Configure repository Variables and Secrets instead of committing deployment
settings. The workflow generates private configuration, checks PRs and deploys
successful main revisions. The manual instructions below remain available.

## Prepare private configuration

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

## Deploy

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
