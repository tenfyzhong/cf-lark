# Non-shortcut parity audit

## Scope and conclusion

This source audit compares upstream lark-cli 1.0.97, commit `72579c80027c863ca51d5f9affda72a70ab0d8a6`, with the current hosted implementation. It covers root commands and the common generated-API execution layer in addition to the 538 shortcut definitions, 251 generated API descriptors, and 25 EventKeys. It does not repeat domain shortcut acceptance or claim live Lark verification.

The shortcut and endpoint counts alone do not establish complete CLI parity. Two material business gaps remain: the unrestricted-by-catalog raw API escape hatch, and generic generated-API pagination/file transfer behavior. Configuration, authentication and terminal tooling require a different comparison: the hosted service intentionally replaces local profiles, keychains and processes with owner-managed credentials, OAuth grants, artifacts and durable workflows.

## Root command inventory

Upstream `cmd/build.go:486-498` registers `config`, `auth`, `profile`, `doctor`, `whoami`, `api`, `schema`, `completion`, `update`, `event`, and `skills`. Generated service domains and shortcut domains are mounted separately. There is no separate root `search` command in this pinned tree; hosted `lark_search` supplies catalog discovery.

| Upstream surface | Hosted equivalent or finding | Classification |
| --- | --- | --- |
| Domain shortcuts | Domain capability factories, resumable programs and shortcut coverage manifest | Separate domain acceptance applies |
| Generated service/resource/method APIs | `src/capabilities/api/generated/catalog.json` and `api/command.ts` | Endpoint coverage exists; generic execution behavior is incomplete |
| `api <method> <path>` | No generic raw capability in `catalog.ts` or `definitions.ts` | Missing remote Lark business capability |
| `schema [path or service resource method]`, domain help | `lark_search` and `lark_schema`, consent-filtered definitions with execution context | Hosted equivalent; upstream path-based schema lookup is not separately exposed |
| `event list/schema/consume/status/stop` | `event.*` lifecycle capabilities and durable callback consumers | Hosted equivalent with callback/polling adaptation; individual EventKey acceptance remains separate |
| `profile list/add/remove/rename/use` | Admin profile CRUD, authorized profile selection and automatic unambiguous selection | Hosted equivalent; no process-global active profile |
| `config init/show/remove` | Admin app ID/secret and brand management with encrypted storage | Hosted equivalent for application credentials |
| `auth login/logout/list/status` | Admin device login and polling, account listing/removal, token refresh | Hosted equivalent; MCP authorization is an additional independent OAuth layer |
| `auth scopes` | Login discovers enabled app user scopes; account metadata exposes granted scopes | Core scope discovery exists; no dedicated MCP app-scope inspection operation |
| `auth check --scope` | Granted scopes are visible to the owner in account metadata | No dedicated MCP scope comparison/diagnostic operation; administrative convenience gap |
| `whoami` | MCP search/schema execution context and execute selection; owner profile/account metadata | Identity selection equivalent; not a full token-health diagnostic response |
| `doctor` | Service health/management and structured operation failures | Local CLI/keychain/environment diagnosis does not transfer; no identical diagnostic report |
| `auth qrcode` | Login verification link | QR image/ASCII rendering is not implemented; presentation utility, not a missing Lark endpoint |
| `config default-as/strict-mode/risk-control/policy` | Explicit MCP identity plus grant identities/domains/read-write permissions | Different hosted authorization policy; no local YAML/plugin-policy import |
| `config tenant-access-token set/remove` | Tenant tokens acquired and refreshed from managed app credentials | No manually supplied tenant-token credential mode; management-mode difference |
| `config bind` | No host-workspace binding | Local agent workspace operation |
| `config plugins/keychain-downgrade` | No native CLI plugin loader or OS keychain | Local deployment/environment operation |
| `skills list/read` | Command descriptions and schemas only | Bundled guidance/reference browser absent; useful agent documentation gap, not remote CRUD |
| `completion` | MCP tool and argument schemas | Shell completion does not transfer |
| `update`, version/help startup notices | Worker deployment/version management | Binary self-update does not transfer |
| Extension platform/command packages | Static capability/port composition | Developer embedding interfaces and arbitrary third-party plugins are outside the pinned built-in business catalog |

## Material business gaps

### Raw API escape hatch

Upstream `cmd/api/api.go` accepts an HTTP method and an arbitrary Lark `/open-apis/` path, including endpoints absent from its embedded API catalog. It supports JSON query/body input, multipart file upload, binary output, dry-run, pagination, output format and jq. URL input is normalized to a Lark API path; query strings/fragments are rejected and query parameters belong in `params`.

The hosted `apiCapability()` requires a fixed `ApiDescriptor`; `Dispatcher.resolve()` rejects unknown command IDs. The current registration list has no equivalent generic API capability. Consequently a newly released or preview Lark endpoint cannot be invoked merely because its path is known. This is a functional gap even when every pinned catalog endpoint and shortcut is present.

A hosted implementation needs an explicit grant boundary for raw API use, path validation that cannot redirect credentials away from the selected Lark origin, method/risk enforcement, and the existing private artifact/streaming interfaces for files. Catalog presence must not be mistaken for this escape hatch. A raw capability must also preserve user/bot selection and dry-run isolation.

### Common generated-API behavior

Upstream `cmd/service/service.go:299-334` registers JSON parameters/body, binary output, pagination where supported, output formats, jq, and multipart upload when file fields exist. Typed flags override corresponding raw parameter entries. Execution handles these common branches independently of each endpoint's business metadata.

Hosted `src/capabilities/api/command.ts` substitutes path parameters, collects known query fields, forwards `args.body`, and performs exactly one JSON `context.lark.request()`. Generated schemas currently accept `params` and optional `body`; additional top-level properties are rejected. Therefore:

- Generic `page-all`, page limits and page delays are unavailable. Clients can manually follow returned tokens, but this does not reproduce CLI all-page execution or its output behavior.
- Generic multipart file inputs are unavailable through generated API commands. Dedicated file shortcuts do not cover arbitrary file-bearing typed endpoints.
- Generic binary response downloads are unavailable through that adapter, which always expects JSON. Dedicated resource download commands are not a universal substitute.
- JSON/query inputs from private artifacts are not a generic API input feature merely because individual shortcut wrappers support them.
- Shared jq projection and NDJSON/CSV/table output rendering are absent. Table display is a terminal adaptation; jq and export formats affect machine-consumable results and should be declared explicitly rather than silently omitted.

The appropriate reusable fix is a common API execution program with artifact input/output, pagination state, streaming transfer support and shared output projection. Changing only command counts or descriptions cannot resolve these branches.

## Authentication and management boundary

Existing owner-only routes in `src/adapters/http/admin.ts` provide profile CRUD, account listing/removal and device-login lifecycle. `src/application/credentials.ts` discovers app scopes for login, encrypts stored credentials and tokens, refreshes user tokens, and acquires/caches tenant tokens. This is evidence that app ID/secret and user authorization are already implemented; the audit does not recommend rewriting live configuration.

The remaining `auth check`, `whoami`, manually supplied tenant-token and QR differences should be labeled administrative or presentation adaptations. They do not justify exposing secrets to an MCP client. A grant-safe diagnostics response could expose selected identity, granted scope names, expiry and required reauthorization without returning tokens.

## Evidence and limits

Primary upstream files inspected: `cmd/build.go`, `cmd/api/api.go`, `cmd/service/service.go`, `cmd/schema/schema.go`, `cmd/auth/{auth,scopes,check,qrcode}.go`, `cmd/profile/profile.go`, `cmd/config/{config,bind,policy,tenant_access_token}.go`, `cmd/whoami/whoami.go`, `cmd/doctor/doctor.go`, and `cmd/skill/skill.go`.

Hosted files inspected: `src/capabilities/{catalog,definitions}.ts`, `src/capabilities/api/command.ts`, generated API catalog, event lifecycle capabilities, `src/application/{dispatcher,credentials}.ts`, and HTTP admin/MCP adapters.

This is a read-only source audit, not a test result for unimplemented branches. Changes made after this audit must update the findings and add reusable acceptance evidence before claiming complete non-shortcut parity.

## Remediation in this change

The audit above records the pre-remediation findings. `src/capabilities/raw-api/` now supplies `api.request` and a reusable durable API runner, with private JSON inputs, streamed multipart uploads, binary artifacts, paginated aggregation and exact jq. The typed API adapter is being connected to this same runner. See `docs/raw-api.md` for hosted representations and resource limits, and `test/raw-api.test.ts` for reusable branch coverage. Native MCP acceptance is in `test/runtime/raw-api-mcp.test.ts`; its result must be checked after bootstrap and generated-schema integration. This implementation evidence supersedes the missing-runner finding only after those integrations pass.
