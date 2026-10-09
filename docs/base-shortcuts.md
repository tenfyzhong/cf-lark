# Base shortcut parity

The Base adapter targets lark-cli v1.0.97 at commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6`. Each shortcut preserves its
argument names, upstream API requests, validation and result envelope. IDs and
names remain opaque path segments and are URL encoded independently.

Implementation proceeds through source-derived command families. Only verified
handlers enter the exported registry. The status manifest lists missing command
variants explicitly; registration alone is not evidence of full parity.

JSON input accepts native JSON values or inline JSON strings. Local `@file`
inputs use grant-owned artifacts in the cloud; those inputs require the artifact
read permission. Previews perform validation without contacting Lark. Multi-step
writes and exhaustive reads use durable workflow checkpoints rather than hidden
unbounded fan-out. Write failures never trigger automatic replay.

Acceptance covers exact request shapes, all flag branches, result envelopes,
invalid inputs before network access, preview isolation, pagination, and partial
failure behavior. Synthetic upstream tests do not prove live tenant permissions.

Core reads retain CLI pagination semantics: table and field list return a single
legacy page of at most 300 rows; view and option pages allow at most 200 rows.
Role operations decode the nested business response independently of the outer
HTTP response, including double-encoded JSON and empty success envelopes.
Advanced-permission toggles send the explicit `enable` query value. Workflow
get/enable/disable preserve workflow coordinates and never infer an enable step
after creation.

Base directory commands preserve the distinction between a selected block and a
table. Block type filtering is local to the list response; moving a block to the
root sends a null parent explicitly, and before/after positions are exclusive.
Template discovery projects only the documented template/category response
fields and retains string pagination cursors.

Workspace and BaseApp navigation retain separate coordinate types. Workspace
entity pages accept 1–30 entries; BaseApp page and block pages accept positive
page sizes. App creation requires an existing workspace and returns that token.
Workspace creation promotes returned token and URL into the result envelope.
Page deletion is an explicit write and returns the deleted page coordinate.

Table creation, table inspection, batch view creation, workflow listing and
BaseApp page uniqueness checks are durable programs. Each resume performs at
most one upstream request. Table inspection reads every field and view page;
page writes check every page of existing names before writing. Completed
programs return the CLI result envelope and never replay previous writes.

Form CRUD preserves optional nonempty names/descriptions and explicit deletion
coordinates. Share updates accept exactly one present field, including `false`.
Form identity/login settings and dashboard source visibility remain nested under
`settings`. Dashboard share output removes only the backend-gated
`enable_auto_analysis` setting. All other response fields are preserved.

Dashboard navigation preserves single-page cursors, default page sizes and
result envelopes. Computed chart data deliberately omits dashboard/page
coordinates that its endpoint does not use. Arrange submits an empty body and
marks the returned result as arranged; it is never inferred from a read or used
as a replacement for an explicit position update.

Cloud JSON file references use `@artifact-id`. Execution verifies artifact read
permission and ownership, reads at most 2 MiB, and parses the exact bytes before
any Lark request. Previews report deferred artifact validation without storage
or credential access. Native JSON objects and arrays avoid the file adaptation.

Field extension updates use strict keys at every nested level. Empty objects
clear the extension; completion prompts permit text or field-reference segments
with mutually exclusive payloads. Cell update ranges distinguish column/view
selection from explicit row IDs. Formula and lookup field updates require the
CLI guide acknowledgement and return a readback recommendation.

Batch field creation validates the complete submitted array before starting,
spaces request starts by at least 500 milliseconds, and checkpoints each
successful field. Known upstream rejection after partial success returns an
item ledger with created, failed, and not-attempted entries. Unknown outcomes
remain uncertain and are not converted into safe-to-retry failures.

Form question creation accepts at most ten objects and distinguishes new fields
from existing-field references. Question updates preserve full overwrite
semantics, including null values, and do not invent merge behavior. Deletion
removes underlying fields by default; `keep-field` explicitly preserves them.
Form list uses durable cursor pagination and form detail uses a share token.

Button binding first resolves a field name or ID into a canonical `fld` ID and
then performs the requested relation operation in a separate durable step.
Binding never enables the workflow. Title search restricts Drive search to Base
objects, strips search highlight tags, and returns either one resolved resource
or an explicit candidate list. Data queries require a dimensions or measures
key and preserve caller-provided DSL values.

Table copies default to schema-only. All-range copies retain task IDs and return
explicit status continuation when not waiting. Waiting is a durable program with
3-second exponential polling capped at 30 seconds and a maximum 30-minute
deadline. Submission is never retried, and timeouts preserve the submitted task
coordinates. Cloud continuation uses structured MCP arguments instead of shell
commands.

Record deletion requires an explicit unique selection of at most 200 IDs, from
repeatable arguments or JSON, never both. Share-link generation deduplicates at
most 100 IDs and preserves missing-record omissions from the API. Record history
reads one record with a positive optional version cursor and a 1–50 page size.

Base create/copy is checkpointed before table initialization and optional bot
permission grants. Custom first-table creation waits one second before deleting
only the platform-created default table. A name-only request renames that table.
Bot auto-grants select only an unambiguous account already authorized by the MCP
grant and report granted, failed, or skipped without losing the created Base.

Workflow definition create/update preserves full replacement semantics and the
pinned CLI's AI analysis/classification validators. Classification requires at
least two distinct classes, valid earlier-step content references, ordered case
links, and a default branch only under the configured no-match policy. Other
step types pass through without inventing an undocumented schema.

Record writes preserve the CLI top-level field map and batch body contracts.
Upsert selects creation or an explicit record update solely from `record-id`;
it never guesses business keys. Batch updates retain the upstream response and
do not report record existence or confirmed cell changes without readback.

URL resolution is based on URL path rather than hostname. BaseApp/form-share
coordinates resolve locally. Wiki nodes must resolve to bitable. Base selections
are initially block IDs, and only directory evidence can turn one into a table,
dashboard, workflow, folder or document. Optional readback enrichment failures
preserve resolved coordinates and a next-step hint rather than guessing data.

## Block configuration contracts

Dashboard block create/update preserve the upstream distinction between full create validation and partial update validation. Chart rollups and sort modes are normalized only when local validation is enabled; ranking defaults and NPS exclusions remain type-specific. App block writes use durable steps to check every page for duplicate names, resolve an existing block before validating a configuration patch, and verify list data belongs to the app workspace. Preview performs local validation without reading remote state. `no-validate` skips semantic checks, but JSON must still be an object and workspace/name checks still run.

## Attachment and form file workflows

Local paths become owner-bound private artifact IDs. Optional `artifactNames` maps each source ID to its original filename, since the artifact storage protocol does not retain upload filenames. The deprecated record-upload `name` flag remains rejected. Uploads preflight every artifact before the first upstream write, preserve the 2 GiB per-file ceiling, resolve attachment fields, and use shared resumable media upload steps. Form uploads use `bitable_tmp_point` with the share token in `extra`, deduplicate shared source artifacts, and merge complete attachment values into submitted fields. Record append/remove bodies preserve single-cell semantics. Downloads preserve Base-specific `extra_info`, selected token ordering and failure progress, returning private artifacts instead of writing a local directory; `output` names the artifact export and `overwrite` is unnecessary for immutable artifact IDs.

Copy polling retries only safe status reads on transient transport, throttling and server failures. Terminal polling errors retain the last known task and table so a failed wait cannot accidentally trigger another copy. Empty custom field input is treated as absent, matching the CLI.

Image metadata detection supports PNG, GIF, JPEG, classic TIFF, Windows BMP and WebP using bounded artifact range reads. It reads dimensions without decoding image pixels. TIFF follows only the first IFD and scalar width/height tags; WebP limits chunk traversal to 4096 entries, matching upstream. Unsupported or malformed image headers leave dimensions absent without preventing upload.

Analysis DSL supplied as inline JSON or an artifact retains its original numeric lexemes in the upstream request. This preserves identifiers and integer filters larger than JavaScript's safe integer range. Native object input follows ordinary JSON number semantics.

## Hosted compatibility aliases

The hosted schema deliberately retains these compatibility aliases in addition to the pinned CLI flags: `page-size` on the legacy table/field/view/options, template list/search and record list/search adapters maps to the CLI page limit; `query` and `url` are alternate resolver inputs where a client previously supplied those names; `record-ids` aliases the record selection for share-link creation; and record reads accept `table`, `field` and `view` aliases for their corresponding IDs. The bounded `timeout` option on table-copy is an explicit durable polling extension. Attachment upload and form-submit accept `artifactNames` to restore filenames that private artifact storage does not retain. These extensions do not add permissions or infer extra writes.
