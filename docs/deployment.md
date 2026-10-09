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
account and discovers or provisions Access when complete manual overrides are absent.
It runs anonymous discovery and authorization-boundary checks after upload.
The following sequence also applies to manual deployments.

1. Install locked dependencies and run `pnpm check` plus browser checks appropriate
   to the change. Verify generated coverage and command schemas are current.
2. Verify the selected account, existing namespaces, private bucket, custom domain,
   and secret backups. Keep all existing migration entries and encryption keys.
3. Configure the dedicated Cloudflare Access application, team issuer, AUD and
   your email-domain Allow policy using [Access setup](cloudflare-access.md).
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
