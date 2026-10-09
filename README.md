# cf-lark

An authenticated Lark and Feishu MCP service built for Cloudflare's free tier.
Deploy a fork to your own HTTPS origin. Management uses `PUBLIC_URL`; MCP clients
connect to `${PUBLIC_URL}/mcp` and authorize through OAuth. Application credentials
never belong in endpoint URLs.

The hosted business surface covers 531 shortcuts from pinned lark-cli v1.0.97,
251 generated API descriptors, and 25 event keys. Seven shortcuts that manage a
local project, Git credential helper, or local plugins remain local CLI operations.
See [compatibility](docs/compatibility.md) for this boundary and evidence rules.
This describes implementation coverage, not deployment or live Dots acceptance;
final validation and live-client acceptance are separate release gates.

Clients discover commands with `lark_search`, inspect exact schemas with
`lark_schema`, and invoke them with `lark_execute`. Discovery includes authorized
profile/account choices. Unambiguous selections can be inferred; multiple choices
require explicit selection. Long operations return a workflow ID and continue
through `workflow.resume`. Generated API commands also support typed parameter
flags, JSON/artifact input, pagination, file transfer, jq, and structured output
formats. `api.request` provides the raw Open API escape hatch under separate
`api` domain consent; GET requires read access and mutation methods require write
access. See [typed API execution](docs/typed-api-execution.md) and
[raw API execution](docs/raw-api.md).

## Deployment

Choose your own Cloudflare account. The public `cf-lark` Worker serves management,
OAuth, MCP, and callbacks. Private `cf-lark-docs-engine` and
`cf-lark-mail-engine` Workers run pure transformations in their own SQLite
Durable Objects. Each script must fit the free-tier 3 MiB compressed limit.
No external compute service or paid Workers plan is required.

The private `cf-lark-private` R2 bucket has a default aggregate limit of
**2,000,000,000 bytes** and a 24-hour artifact lifetime. Upload reservations,
intermediate files, and encrypted workflow spill share this quota. Streaming
uploads, resumable multipart sessions, and bounded range reads support large
files without loading each whole file into memory. Account-wide Cloudflare
usage remains outside the service's accounting boundary.

## Documentation

- [Deploy an independent fork](docs/fork-deployment.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Operations, recovery, and migration history](docs/operations.md)
- [Security and authorization](docs/security.md)
- [Public interfaces](docs/interfaces.md)
- [Compatibility and acceptance](docs/compatibility.md)
- [Implementation evidence](docs/verification.md)

## Local development

Use Node.js and pnpm 10.32.1. Install with `pnpm install --frozen-lockfile`.
Configure Cloudflare Access with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and
your own `ACCESS_EMAIL_DOMAIN`; management no longer accepts a deployment secret.
Create an ignored `.dev.vars` containing the base64-encoded 32-byte
`ENCRYPTION_KEY`. Back it up securely; replacing it cannot decrypt existing
state. See [Access setup and local test fixtures](docs/cloudflare-access.md).

Run `pnpm exec vite build` before `pnpm dev` to generate management assets.
Configure the private service bindings when exercising transformation commands.
`pnpm check` runs schema freshness, types, unit tests, architecture checks,
independent Worker builds, and native runtime/engine tests.
`pnpm exec playwright install chromium` followed by `pnpm test:browser` runs
management browser tests against isolated local persistence.

Write English documentation before implementation and add a reusable failing
test before changing production behavior. Keep repository documentation,
comments, generated metadata, and fixtures in English; runtime multilingual
content remains supported. The compatibility baseline is commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6` of lark-cli v1.0.97.
