# Compatibility and Acceptance

Baseline: [lark-cli v1.0.97](https://github.com/larksuite/cli/tree/v1.0.97),
commit `72579c80027c863ca51d5f9affda72a70ab0d8a6`, MIT licensed.

The later audited revision `9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d` is
tracked separately by [pinned contract checks](upstream-contract-check.md). Its
typed API schemas and registered business shortcut IDs match this inventory;
that does not imply identical behavior or live acceptance. Base reads retain
inline Markdown defaults and support while explicit NDJSON exports adopt the
new [single-page contract](base-record-read.md). OAuth v3/DPoP is
explicitly opt-in; existing deployments retain legacy authentication defaults.

Inventory API methods, shortcuts, events, authentication, profile configuration,
and file workflows separately. The manifest records stable command ID, source,
implementation status, cloud adaptation, and test evidence. Allowed statuses are
implemented, partial, pending, and excluded. Partial and pending business entries
prevent full acceptance.

Raw API access is a separate capability and does not establish shortcut parity.
Discovery must not advertise unimplemented commands or input variants as executable.
A partially implemented command exposes only its supported input schema and
explicit limitations; its full-command acceptance status remains pending. Generated API
descriptors need schema/path/identity/pagination contract tests; multi-step
shortcuts need workflow fixtures, not only endpoint existence checks.

## Domains

Messaging, documents, Drive, Markdown, Base, Sheets, Slides, Calendar, Tasks,
Wiki, Contacts, Mail, Meetings, Minutes, Attendance, Approval, OKR, Whiteboards,
and Apps are in scope. Feishu and international Lark are both supported.

Local paths become artifact IDs, directories become manifests/archives, and
long-running listeners become durable event subscriptions and cursor reads.
Terminal layout, installation, self-update, shell completion, and local process
management are excluded. Business semantics remain part of acceptance.

## Coverage gates

1. Every upstream business capability is inventoried.
2. Every implemented entry resolves to a real handler and reusable test evidence.
3. No entry is marked implemented solely because raw API forwarding exists.
4. No Chinese characters are persisted in generated descriptions or fixtures.
5. Live acceptance identifies exact profiles, domains, operations, and observed
   outcomes without storing secrets. Unavailable upstream scopes remain explicit.

## Test strategy

Pure policy and use-case tests use injected ports. Adapter tests cover HTTP and
storage behavior. Cloudflare integration tests run real Worker/DO bindings in
the local runtime. Browser tests cover management and OAuth consent. Real-client
and real-platform tests are recorded separately from all mocked verification.

## Registered shortcut inventory

The pinned upstream registers 538 shortcuts across 20 service names. Generate
this exact inventory with `node scripts/catalog/generate.ts /path/to/upstream`.
The build-time Go exporter calls the upstream public AllShortcuts registry;
it does not execute a command, read credentials, or send business requests.
Go and the upstream module dependencies are only needed for regeneration.

The hosted business surface comprises 531 shortcuts, 251 generated API descriptors,
and 25 event keys. The separately registered `api.request` escape hatch is not
counted as a shortcut or generated descriptor. Generated descriptors support the
shared CLI execution options documented in [typed API execution](typed-api-execution.md);
raw requests require their own `api` domain consent. Seven of the 538 registered
shortcuts are intentionally local:

- `apps.+init`
- `apps.+git-credential-init`
- `apps.+git-credential-list`
- `apps.+git-credential-remove`
- `apps.+plugin-install`
- `apps.+plugin-list`
- `apps.+plugin-uninstall`

These commands manage a local checkout, operating-system credential helper, or
local dependency installation. They have no hosted handler. Their exact source
contracts are recorded in [Apps shortcuts](apps-shortcuts.md). Remote Apps
creation, generation, publishing, database, access, files, and observability stay
inside the hosted business scope. Excluding terminal operations does not exclude
business workflows that happen to use local files in the CLI.

## Hosted adaptations and resource limits

Local files become grant-owned private artifacts; directories become explicit
manifests or archives. Output names remain metadata rather than filesystem paths.
Previews validate inputs and describe work without network requests or writes.
Long operations checkpoint bounded steps and return workflow IDs for
`workflow.resume`; clients honor returned scheduling delays instead of repeating
the initiating write. Event listeners become authenticated callback ingestion and
bounded cursor reads. Terminal rendering becomes structured MCP output.

The free-tier deployment uses three independently size-checked scripts, private
transformation Durable Objects, and private R2. All artifacts, reservations,
intermediate files, and encrypted workflow spill share the default 2,000,000,000-byte
cap and expiry policy. Streaming and range reads avoid whole-file buffering;
resumable ingress uses 64 MiB parts. Business endpoints retain their individual
file-size limits. Workflow records permit at most 32 MiB serialized, 100,000 JSON
values, and 128 nesting levels. Document parser complexity, MIME sizes, and
pagination have additional explicit guards; none silently truncate results.

Representative enforced ceilings include 25 MiB of final Mail MIME, an 8 MiB
combined Mail text/markup budget (UTF-8 bytes plus 256 bytes per markup delimiter),
and 20,000,000 bytes of document parser input with at most 32,768 XML markup
delimiters and 2 MiB of markup text. Raw/typed API artifact JSON input is limited
to 2 MiB; jq input is limited to 1 MiB and 16,384 JSON values. API pagination
defaults to ten pages and a 200 ms inter-page delay; an explicit zero page limit
removes that page-count cap while workflow and storage limits remain. Single
streaming multipart uploads are bounded to 5 MiB for IM images, 100 MiB for IM
files, 50 MiB for Task attachments, and 20 MiB for other endpoints. Dedicated
domain multipart workflows have their separately documented limits.

Consult [document contracts](docs-shortcuts.md), [Mail runtime limits](mail-runtime-limits.md),
[Mail streaming](mail-raw-stream.md), [raw API execution](raw-api.md),
[file transfers](file-transfers.md), [upload sessions](artifact-upload-sessions.md),
and [workflow storage](workflow-storage.md) for exact limits and adaptations.
Tests exercise these bounded hosted contracts; they do not claim unrestricted
local-process or arbitrarily large input equivalence.

## Evidence-backed shortcut status

`scripts/catalog/*-status.json` manifests record explicitly reviewed shortcuts,
covered flags, reusable tests, and cloud adaptations. The generator rejects
unknown command IDs, nonexistent evidence, duplicate flags, and any implemented
entry that omits an upstream flag. A partial implementation remains `partial`;
it never counts toward full compatibility. Unlisted shortcuts remain `pending`.
These labels describe source and fixture coverage, not live tenant acceptance.

The authoritative generated inventory is `docs/generated/coverage.json`; regenerate
it after domain manifests change. Counts above describe the intended completed
hosted implementation surface. A stale generated report must be refreshed and
all final checks must pass before release acceptance. Local unit/native/browser
evidence, deployed Cloudflare verification, real Lark permissions, and live Dots
behavior are separate evidence categories. This refresh does not claim the current
changes are deployed or that Dots acceptance has completed.
