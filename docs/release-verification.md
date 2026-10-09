# Hosted parity release verification

Verified on 2026-10-09 against lark-cli v1.0.97, commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6`.

## Scope

The generated command inventory records 531 implemented hosted business
shortcuts and seven explicitly excluded local Git/npm/scaffolding commands.
There are no partial or pending shortcut entries. The service also exposes 251
generated API commands, the generic `api.request` command, and 25 event keys.
The source-file inventory is separate from executable command coverage.

This is hosted business parity within the documented resource bounds, not
terminal/OS compatibility or proof that every operation has succeeded against a
real tenant. See [compatibility](compatibility.md), [raw API](raw-api.md),
[typed API execution](typed-api-execution.md), and each domain's source audit.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Full unit suite | 1,412 passed; five opt-in tests skipped |
| Native MCP/storage/streaming suite | 57 passed across 20 files |
| Separate private engine entrypoints | Six passed |
| Local browser suite | 272 passed |
| Generated command schemas | 708 verified |
| TypeScript | Passed |
| Dependency architecture | 367 modules, 916 dependencies; no violations |
| Public production HTTP smoke | Passed; authenticated management case skipped without a current secret |
| Production browser authentication boundary | Passed; JSON errors rendered without HTML parsing failures |

The native suite uses workerd, SQLite Durable Objects, private R2, and the pinned
pure Go transformations. Upstream Lark HTTP responses are fixtures. The suite
covers scheduled document creation, task queries, IM writes and pagination,
raw/typed API calls, event isolation, encrypted workflow checkpoints, 65 MiB
multipart artifact ingestion, and 18 MiB Mail attachment streaming. No real Lark
message or document was created by these checks.

## Deployed versions

| Worker | Version | Compressed upload |
| --- | --- | --- |
| `cf-lark` | `aeceb352-a122-43d7-85cc-1395b0eb28a6` | 975.24 KiB |
| `cf-lark-docs-engine` | `f91c7702-c2c4-4c5b-8858-bf9c3f9c3fe4` | 2,109.90 KiB |
| `cf-lark-mail-engine` | `cfb1251a-9c6a-416e-9961-b0b05875ae3e` | 2,772.59 KiB |

Production MCP remains `https://lark.tenfy.cn/mcp`. Cloudflare's live settings
confirm that all workers.dev and preview endpoints are disabled. Each private
engine has only its own Durable Object binding; neither receives credentials or
R2 access. The main service retains the existing Authority/EventInbox namespace
IDs, private bucket, encryption key, and 2,000,000,000-byte storage ceiling. This
release performs no credential rotation or data migration.

## Management UI follow-up

The 2026-10-09 UI follow-up replaces the green theme with Feishu-inspired blue
actions, neutral surfaces and underline tabs. It adds keyboard-accessible tab
selection and responsive layout checks. The obsolete compatibility preview
banner is removed. See [management UI design](management-ui-design.md).

Three new reusable local browser tests first failed because the original
navigation did not expose tabs. All eight focused management/design/consent
browser tests then passed, including application creation, storage, grant
revocation, select-all consent, disabled submission actions and 320/390-pixel
layouts. TypeScript, the repository English-content test, and architecture
checks passed (368 modules and 917 dependencies). Desktop and mobile screenshots
were visually inspected.

Only the main Worker and its static assets were redeployed for this follow-up.
The private engine versions above are unchanged. UI fixture checks do not use
production management credentials or exercise tenant-specific Lark operations.
The initial post-deployment desktop probe briefly received the prior green
assets while rollout propagated. The final production browser run passed all
three checks: desktop/mobile blue sign-in styling and JSON authentication
errors. The public HTTP smoke also passed; its authenticated case remained
skipped without a current management secret.

## Scope disclosure follow-up

Account and authorized-client scope lists now start collapsed with a count.
Native disclosures support click and keyboard expansion independently. Every
scope is retained; expanded lists wrap long identifiers and scroll within a
16rem height. Empty lists show a short message. Sign-out, revocation and OAuth
permission selection retain their existing contracts.

The two new reusable desktop/mobile checks first failed because disclosures
were absent. All ten focused management/design/consent/scope browser checks
then passed. TypeScript, repository English-content and architecture checks
passed (369 modules, 919 dependencies). Production UI checks use intercepted
fixture administration responses and deployed assets, without actual
production administrator credentials.
The main Worker/assets release is
`b675e739-9df3-4541-b047-6662aab2e707`; private engine versions are unchanged.
All five production browser checks passed, including both scope-disclosure
viewport cases and the existing blue-theme/authentication checks.

## Remaining user acceptance

A live Dots session and tenant-specific Lark operations have not been exercised.
Existing OAuth grants do not gain new domains or write permission automatically;
reauthorize when the requested command requires additional consent. Real API
availability still depends on the selected application's enabled scopes and the
upstream account's resource permissions. Resource limits and explicit local-only
exclusions remain part of the hosted contract.

## Cloudflare Access authentication follow-up

The dedicated `cf-lark-management` Access application was configured through the
Cloudflare dashboard in the tenfy.cn account after explicit user confirmation.
It protects `/api/admin` and its children and `/consent`, permits verified
`@tenfy.cn` email identities through one-time PIN, and uses an eight-hour session.
Its application ID is `a2953b3a-ddf6-4988-9757-1b0758be4e1d` and dedicated policy
ID is `7696e382-a55f-4cf9-a07c-67943d06f8d2`. Other applications and shared policies
were left unchanged. The Worker verifies the actual Access issuer and AUD.

The legacy secret-login regression first failed with an unexpected HTTP 200;
it now returns 410 without issuing a session. Signed JWT fixtures verify issuer,
audience, signature, expiry, email domain, CSRF, safe return paths and logout.
Native workerd tests also reproduced and fixed unsupported JWKS redirect mode.
All 1,422 unit tests passed (six opt-in cases skipped), all 60 native runtime
tests passed, and all 13 focused local browser tests passed. TypeScript,
architecture, asset build and the minified deployment dry run passed.

Only the main Worker and static assets were deployed. Public production HTTP
checks passed, including Access challenges for management and unchanged OAuth
discovery and MCP Bearer challenges. All five production browser checks passed,
including desktop/mobile blue styling, collapsed scope disclosures and the
Cloudflare email login page. Scope UI checks use intercepted fixture data.
The unused `ADMIN_SECRET` binding was removed; `ENCRYPTION_KEY` is retained.
Secret deletion published version `aeceb352-a122-43d7-85cc-1395b0eb28a6` from
code deployment `84d32eea-28db-4506-b810-25c2a38b6ba7`. Read-only live settings
confirmed Authority namespace `15644fd5d781451893e4a45fc2915b3a`, EventInbox
namespace `fd8fd01551b74b9db0d7ccbdb438a0c3`, and bucket `cf-lark-private`.
The private engine versions and the aggregate R2 ceiling remain unchanged.

The user completed mailbox PIN sign-in. Computer-use acceptance verified the
existing application and authorized account (163 scopes), the Storage page with
the 2,000,000,000-byte capacity, and the Clients page with no current grants.
Direct consent-path navigation shared the authenticated session. Sign-out
displayed Cloudflare's successful logout message and returned to email login.
No new production MCP grant was created. The authenticated production R2
lifecycle test was skipped without
an Access cookie file. These checks do not claim tenant-specific Lark operations
or Dots acceptance.

## Pull request delivery verification

The full local browser sweep passed all 279 tests. Its first run reproduced
invalid JSON parameter examples and simultaneous body/data aliases in the old
catalog fixture generator. Two reusable unit regressions now verify structured
union inputs, omission of alias/transport flags, and regular schema examples.
All 60 native runtime tests passed again. TypeScript and repository content
checks passed after final staging; four extra blank EOF lines were removed.
The two pinned Wasm binaries are data files and use non-executable file modes.
All six private engine tests also passed again. The compressed bundle reports
were 975.24 KiB (public), 2,109.90 KiB (Docs) and 2,772.59 KiB (Mail).
In this delivery run Wrangler printed its successful dry-run completion but
lingered during process shutdown; those completed bundling processes were
terminated. This is not a clean aggregate `pnpm check` exit. Component test,
type, architecture and validator checks are reported independently.
