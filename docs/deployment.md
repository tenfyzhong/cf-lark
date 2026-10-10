# Deployment

Each fork selects its own Cloudflare account and HTTPS origin. The tracked
Wrangler files are portable examples; production commands use ignored
`wrangler*.production.jsonc` copies. Follow [fork setup](fork-deployment.md)
before deploying. Management uses `PUBLIC_URL`, and MCP uses `${PUBLIC_URL}/mcp`.

## Components

| Component | Configuration | Exposure |
| --- | --- | --- |
| `cf-lark` | `wrangler.jsonc` | Custom domain, static management assets, OAuth, MCP, callbacks |
| `cf-lark-docs-engine` | `wrangler.engine-docs.jsonc` | Private `DOCS_ENGINE` service binding |
| `cf-lark-mail-engine` | `wrangler.engine-mail.jsonc` | Private `MAIL_ENGINE` service binding |
| `Authority`, `EventInbox` | Public Worker SQLite Durable Object bindings | Internal only |
| `PureEngineObject` | One namespace per private engine Worker | Internal only |
| `cf-lark-private` | Public Worker private R2 Standard binding | Authenticated service routes only |

Use Workers Free. Each of the three scripts must independently remain below
3 MiB compressed; `pnpm build` performs minified dry-run builds. Transformations
run inside the private engine Durable Objects. Engines receive neither Lark
credentials nor encryption keys, OAuth grants, or bucket access, and expose no
public routes, preview URLs, or workers.dev endpoints.

## Release sequence

[GitHub Actions](fork-deployment.md) automates validation and the three-Worker
upload sequence using repository Secrets. It deploys only main
after successful checks. It creates/reuses the private R2 bucket before uploads;
Account-level R2/Zero Trust activation remains a prerequisite; Actions derives the
account, Worker/bucket names and Access on every deployment. No discovered
identity needs a repository Secret.
It runs anonymous discovery and authorization-boundary checks after upload.
The following sequence also applies to manual deployments.

1. Install locked dependencies and run `pnpm check` plus browser checks appropriate
   to the change. Verify generated coverage and command schemas are current.
2. Verify the selected account, existing namespaces, private bucket, custom domain,
   and secret backups. Keep all existing migration entries and encryption keys.
3. Run the bootstrap to discover the dedicated Cloudflare Access application,
   team issuer and AUD, and validate your email-domain policy. See
   [Access setup](cloudflare-access.md).
   Preserve `ENCRYPTION_KEY` on the public Worker. Never upload stale secret
   backups or copy production secrets into tracked files or engine Workers.
4. Deploy private engines before the public Worker. `pnpm deploy` generates
   validators/assets, runs `deploy:engines`, then deploys the minified public
   Worker. Do not publish a public Worker with unresolved service bindings.
5. Verify OAuth discovery and the management origin, then perform authorized
   profile-specific Lark and Dots acceptance. Record deployed versions and actual
   outcomes separately from local mocks and native runtime tests.

R2 must be activated in the selected account. Keep the bucket private and retain
its one-day object-expiry and incomplete-upload cleanup safeguards. Application
expiry and accounting are authoritative before asynchronous lifecycle cleanup.
The default aggregate limit is 2,000,000,000 bytes, artifact TTL is 86,400 seconds,
and monthly Class A/B budgets are 100,000/1,000,000. Other account usage can consume
Cloudflare's allowances; local budgets do not guarantee account-wide free usage.

### Optional user OAuth settings

`LARK_OAUTH_PROTOCOL` and `LARK_DPOP_MODE` are optional repository Secrets for
Actions, or environment values for local `configure:deployment`. The workflow
passes them through bootstrap validation into the public Worker's generated
`vars`. Read-only deployment inspection validates the same settings. They are
never added to private engine configuration or the encryption-secret file.

Acceptance criteria for this configuration path:

- Omitted or empty values keep the existing `legacy` protocol and `disabled`
  DPoP defaults. Surrounding whitespace is ignored; values are case-sensitive.
- Protocol accepts only `legacy` or `oauthv3`; DPoP accepts only `disabled`,
  `preferred`, or `required`. Non-disabled DPoP requires `oauthv3`.
- Unknown values or incompatible combinations fail before Cloudflare discovery
  or provisioning and before private configuration files are written. Errors
  identify the setting without printing its supplied value.
- The generated public Worker configuration records both effective settings,
  including defaults, rather than inheriting an opt-in from a template.
- Rendering settings only prepares deployment files. It does not authorize or
  perform deployment, generate proof keys, or change existing accounts/grants.

Changing these settings changes user-authorization policy. Enabling OAuth v3 or
DPoP requires the deployment owner's explicit approval and separately authorized
staging verification. See [the OAuth/DPoP contract](cloud-oauth-dpop.md) for mode
semantics and recovery behavior; publishing this code does not opt in a deployment.

## Authorization and continuity

Register application profiles and upstream accounts in management. Account login
discovers enabled user scopes; users do not enter a scope list. MCP consent binds
profiles, accounts, identities, domains, and read/write permission. Existing
connections do not automatically gain newly available domains or write access.
Artifact routes require explicit artifact consent; internal encrypted workflow
checkpoints do not add artifact-write requirements to read-only business calls.

Retain the exact encryption key, authority data, OAuth state, and artifact ledger
through deployment. No new namespace replacement or deletion is required by the
engine split. Follow [operations and recovery](operations.md) for backups,
previous naming/namespace migrations, and recovery procedures; historical deletion
migrations are not instructions to delete the current namespaces.

## Public release smoke checks

Set `LARK_LIVE_URL` to the deployed origin and run the reusable tests in
`test/live/service.test.ts` to verify anonymous management Access challenges, OAuth discovery,
MCP authorization challenges, and private artifact access. The authenticated
management/R2 lifecycle case additionally requires `LARK_LIVE_ACCESS_COOKIE_FILE`,
a private JSON file containing the current Access session `cookie` string.
Do not substitute an old secret backup or reset production secrets to make
an acceptance test pass. The browser smoke check in `playwright.live.config.ts`
verifies that authentication failures remain usable and do not parse HTML as JSON.
These checks do not establish tenant-specific Lark API or Dots acceptance.
