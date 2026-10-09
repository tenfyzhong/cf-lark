# Drive shortcut compatibility

Drive commands target the pinned lark-cli 1.0.97 contracts. Resource URLs are
parsed by path, tokens are encoded as individual path segments, and each command
retains its own accepted resource types. Permission mutations preserve explicit
false values, Wiki page/container scope, collaborator identity type, batch
partial results, and user-only notification restrictions.

Folder creation checks the UTF-8 name limit and retains a successful creation
when a best-effort bot-to-user permission grant fails. All previews validate
without upstream access. Local file and directory operations use private
OAuth-grant-owned artifacts and durable workflows; these adaptations are
reported by command metadata rather than pretending a Worker has a local disk.

Regression acceptance uses exact upstream request/response fixtures. Registry
presence alone is not compatibility evidence. Live write verification remains a
separate deployment acceptance activity.

Comment shortcuts unwrap Wiki objects before calling Drive. Simplified text,
mention, and link elements map to the appropriate v1 reply schema or v2 comment
schema. Combined text is limited to 10,000 Unicode code points before escaping
angle brackets. New comments support document blocks, zero-based sheet cells,
slide XML anchors, Base record/view anchors, and supported binary file titles.

Metadata workflows preserve Wiki identity for title updates and unwrap Wiki only
for copy/inspection. File rename keeps the existing extension unless the caller
explicitly selects allow. Version-history pagination uses the last raw history
entry's edit_time even when that entry is omitted from the displayed versions.

Search distinguishes document owner filters from original creator filters, clones
shared filters into document and Wiki scopes, limits opened-time queries to
90-day slices, and snaps edited/commented bounds outward to whole hours. Absolute
unqualified dates use UTC in the cloud runtime; send RFC3339 offsets for another
zone. Returned timestamp fields gain ISO timestamps without replacing originals.

Move and delete checkpoint their initial mutation before polling task_check.
Thirty pending polls return an explicit follow-up task lookup rather than
reporting success. Task-result supports Drive import/export/task_check and Wiki
move, move-to-drive, delete-space, and delete-node status shapes. Missing output
tokens keep import/export status pending even when job_status is zero.

Successful import status polling retains the CLI best-effort bot permission grant only when the MCP grant includes Drive write permission. A read-only MCP grant receives the task result with an explicit skipped permission-grant outcome and performs no mutation.

## Download, cover, preview, and historical exports

Download commands return private artifact IDs, filenames, sizes and authenticated download paths. Output paths and output directories become filename hints; every artifact receives a new immutable ID, so local overwrite and rename policies cannot overwrite another request's artifact. The account-wide 2 GB staging limit applies to streamed responses, including unknown-length responses.

File downloads and preview operations perform authoritative entity lookup with the CLI fallback behavior. Explicit Wiki inputs fall back to Wiki node lookup; online documents are rejected in favor of export. Download checks export permission before transferring bytes, tolerates only upstream scope failures for that optional check, and uses metadata only for automatic naming. Preview selection normalizes all 28 upstream types and 17 statuses, preserves explicit candidate ordering, and prefers ready candidates for image aliases. Source-file downloads skip preview-result discovery. Cover lists are local, with seven fixed presets. Version identifiers remain strings.

Acceptance tests cover no-network cover listings, rejected flag combinations, Wiki fallback, authoritative non-file rejection, export permission denial, ready image alias selection, inherited preview versions, source-file bypass, historical version requests and streamed artifact content.

## Import and export workflows

Import reads a private artifact using `file` and its original filename using `file-name` (required when the artifact ID has no extension). The existing `name` flag remains the target cloud-document title. Every upstream extension/type combination and per-format size limit is validated before upload. Root staging omits `parent_node` for a single-part import and includes an empty node for multipart preparation. The optional folder is checked against Wiki nodes, and existing-target imports are restricted to Base.

Export resolves Wiki nodes before validating source/format compatibility. CSV requires a sub-table ID; schema-only export requires Base format. Markdown export uses the document fetch API directly; other formats create a task, checkpoint its ticket, poll, then stream its exported bytes to a private artifact. Import similarly checkpoints upload state, task creation and polling. Poll errors never replay a submitted mutation, and incomplete tasks return an explicit status command. Local filename rules are represented by a sanitized artifact filename.

## Directory manifests and streaming hashes

Cloud directory operations use immutable JSON manifest artifacts instead of accessing the client's filesystem. `local-dir` identifies a manifest with `version: 1` and `entries`, each containing a safe relative `path`, `type` (`file` or `directory`), `artifact_id` for files, and optional `modified_time` in epoch seconds, milliseconds, microseconds or RFC3339. Empty directories are retained. Artifacts and manifests remain private to the authorizing grant; a returned manifest replaces the caller's previous snapshot. Local deletion removes a manifest entry, preserving shared artifact bytes until explicit removal or expiry.

The runtime injects a `ContentHasher` port. Its Cloudflare adapter pipes the incoming readable stream into native `crypto.DigestStream('SHA-256')`, so exact comparison does not allocate a file-sized buffer. Relative paths reject traversal, absolute paths and Windows separators. Recursive remote listings retain online documents and shortcuts for conflict and deletion protection, while only binary files participate in transfers. Duplicate paths fail before mutation unless an explicit file-only resolution policy applies. Destructive mirror flags require `yes`; deletion is skipped after transfer failures. Interactive `ask` becomes explicit per-path `conflict-decisions` and returns unresolved conflicts before any mutation.

Published flags, supported identities and unconditional scope metadata are checked against the pinned upstream inventory. Conditional scopes remain enforced by the selected upstream API branch. Copy completion verifies the returned file token and retains the CLI best-effort bot permission grant.

Comment creation preserves the CLI's type-specific output anchors: `anchor_block_id` for Docx and Slides, the original `sheet!cell` in `block_id`, and `base_block_id` plus record/view IDs for Base. Wiki Base aliases normalize to bitable; unsupported app objects are rejected before a comment mutation. These output distinctions are tested separately from request construction.

Subsequent asynchronous status polls request a durable 2-second delay. Early resume calls return scheduling metadata without contacting Lark. Wiki creation/copy lock retries use 250 ms then 500 ms backoff. Neither polling nor a delayed retry sleeps inside the Worker request.
