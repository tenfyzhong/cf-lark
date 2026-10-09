# Sheets shortcut compatibility

The adapter follows the pinned lark-cli Sheets handlers. It uses the Sheet AI
read/write invocation endpoints and decodes their JSON-string output. Workbook
and object reads preserve upstream results, with explicit projections for sheet
lists and revisions. History pagination remains caller-controlled.

Locators accept a spreadsheet token, token alias, or spreadsheet/wiki URL.
Wiki URLs resolve through the wiki node endpoint during execution only. Missing
sheet selectors resolve only when the workbook contains exactly one named sheet;
ambiguous workbooks require an explicit selector. Preview validates without upstream Lark I/O; explicit artifact inputs may be read.
Writes are never replayed after an uncertain transport result.

Acceptance tests cover request envelopes, locator validation and wiki resolution,
selector ambiguity, projections, revision bounds, and malformed tool output.
Coverage status is maintained per shortcut; unimplemented handlers are not
advertised by this module. Tests use synthetic upstream responses, not live Lark.

Structure writes preserve pinned defaults (200 rows, 20 columns), explicit zero
omission, tab-color clearing, and irreversible deletion's explicit selector.
Dimension insert preserves the anchor/side mapping for inherited styles. Freeze
updates both axes in one request; zero clears both. Cell merges, clearing,
dropdown reads, and structure include categories use the CLI's wire vocabulary.

Object mutations validate their structured properties with precompiled copies of
the pinned upstream flag schemas. JSON objects and JSON strings are accepted;
local file references use owner-bound private artifacts in the cloud Worker. Conditional formatting
checks each attribute against its sibling rule type, and sparkline updates
require per-item IDs. Object deletes retain their specific object ID field.

Read output-path is adapted to a grant-owned private artifact. It returns an
artifact ID and completeness receipt instead of writing a server filesystem path.
Artifact write permission is checked before fetching data. The same default read
budgets and recursive truncation markers are retained; explicit caps remain
caller-controlled. CSV row prefix removal preserves all other output fields.

Pivot creation leaves its placement sheet unspecified by default, allowing the
upstream tool to create a new sheet. Explicit placement is never inferred from
the sole source sheet. Filter update/delete resolve sheet names to IDs and use
that exact ID as filter_id. Preview requires an ID for those filter operations.

Sheet moves resolve missing IDs and source indexes from workbook structure.
Dimension moves convert one-based row/column ranges to native zero-based,
inclusive-end indices. Both validate offline before any lookup or mutation.

Search preserves the original search term, optional positive offset, and search
option flags. Replace requires the replacement flag to be present and permits an
empty replacement. Floating-image updates require the complete core geometry and
name, preserve explicit offset/z-index values, and leave the image source intact
when neither image-token nor image-uri is supplied.

Range transforms map source and destination ranges, paste vocabulary, fill
series, and ordered sort keys into transform_range inputs. Sort keys are checked
before any mutation. Moving/copying across sheets uses destination_sheet_id.

Dropdown writes stamp bounded cell matrices. Multi-range update/delete emits one
atomic batch, preserving explicit false highlight and null validation deletion.
The aggregate matrix and operation counts are bounded before allocation.

Scattered dimension deletion validates one axis and nonoverlapping spans, then
orders them descending inside a single batch so earlier deletions cannot shift
later targets. Empty or overlapping batches fail before any request.

Cell writes accept structured matrices or JSON strings, expand single-cell
anchors, pad ragged rows with no-op cells and reject overflowing payloads, and narrow oversized target
ranges with an explicit warning. Scattered writes become one fail-fast batch;
all items are validated before transmission. An uncertain write is never retried.

Style stamping preserves flat style fields and border objects without changing
cell values. Batch style and clear commands require sheet-prefixed ranges, cap
operations at 100, and send one batch request after all inputs pass validation.

CSV paste requires an explicit start-cell or range alias and reports its computed
write footprint when RFC 4180 parsing succeeds. The range alias contributes only
its top-left cell. Inline path-looking CSV is rejected to avoid writing a local
filename into a spreadsheet.

Batch-update translates CLI-shaped shortcut inputs through the same builders as
standalone writes. It rejects reads, nested batches, and operations requiring
unavailable preflight steps. Continue-on-error retains local validation failures
with original indices and submits only valid operations; fail-fast validates the
entire payload before the request. Successful remote operations are never rolled
back or automatically retried.

Read-tool retries are bounded to three attempts with 400/800 ms backoff for
transport failures, HTTP server failures, and recognized transient tool failures.
Rate limits and all writes return immediately. Raw token flags never reinterpret
their contents as URLs. Missing structure indexes are invalid upstream responses.

Row/column resizing accepts a uniform range or a nonoverlapping map of sizes.
Map entries are sorted by position. Pixel, standard, and row-only auto modes keep
the upstream vocabulary; columns reject implausibly small pixel widths.

Formula verification passes plural sheet selectors and ranges directly to the
read tool, with no client polling. Exit-on-error maps errors_found to a typed MCP
error carrying the report; partial remains a successful, explicitly partial
report. Unknown statuses fail when exit-on-error is requested.

Declarative styles run as durable workflows, at most one batch request per
resume. Each sheet applies merges, style stamps, row sizes, column sizes, then
freeze in that order. Whole-axis style ranges require a preceding structure read
to bind the sheet grid. Applied chunks are checkpointed and never replayed.

### Typed table reads

`table-get` is a resumable read program: discover sheets once, probe the full
physical grid for the used region, then read styled raw cells. An explicit
selector plus range skips discovery. Each resume performs at most one Lark
request. Types are inferred across every nonempty value; mixed columns become
strings, dates use spreadsheet serial dates, and duplicate headers fail with a
positional-read hint. Truncation remains visible, including empty clipped reads.
The character budget applies to the entire workbook.

Artifact output uses a private artifact per completed sheet and a final manifest.
This cloud adaptation avoids storing large cell matrices in Durable Object
checkpoints. Artifact read and write permissions are checked at every resume;
normal inline output retains the bounded default budget. The manifest preserves
sheet order and each sheet artifact contains the canonical typed table object.

### Spreadsheet images

Image flags reference private artifact IDs in the hosted service. Cell images
validate a single-cell range, read encoded image dimensions, upload through the
shared multipart media workflow, and checkpoint the returned token before
embedding it. Floating images preserve position, size, offsets and z-index;
image source flags are mutually exclusive. Imported Office spreadsheet tokens
use `office_sheet_file` media parents; native sheets use `sheet_image`.

### Typed writes and workbook creation

Typed table writes validate all input before creating or changing a workbook.
Column dtypes preserve numeric, boolean, date and text semantics. A single program
shares table writes between `table-put` and `workbook-create`: discover sheet IDs,
adopt a new workbook's default sheet, create missing named sheets, probe append
positions across the physical grid, and write bounded chunks of at most 50,000
cells. Resume checkpoints record completed chunks and sheets. Earlier writes are
not transactional; a later error must be reconciled before restarting.

Workbook creation accepts either untyped values or a typed sheets payload.
Optional visual styles run after the data writes. Inline inputs remain subject
to the service workflow state bound, with encrypted private artifact spill for large checkpoints; large source files use artifact-based
import rather than a JSON payload that exceeds this bound.

### Semantic chart operations

Basic chart creation sends the upstream `basic_chart` protocol after validating
data dimensions, role indexes, paired sizes and semantic settings. Configuration
and data edits read the editable snapshot first, preserve unaffected fields,
and submit a partial snapshot patch. Batch chart updates checkpoint every read
before sending any mutation; duplicate chart targets are rejected. Local
validation failures are reported with original operation indexes when continuing
on error. The batch is not transactional.

### Workbook conversion

Workbook import and export reuse the Drive conversion program with the document
type fixed to `sheet`. CSV export requires a sheet ID. Export without output-path
returns the ready file token; output-path stages a private downloadable artifact.
Import takes a private artifact plus its original file-name and detects XLS/XLSX
container mismatches before upload. Task tickets and completed upload tokens are
checkpointed, so a resumed poll does not create another import or export task.

Discovery metadata includes spreadsheet creation, import/export, and image-upload
scopes in addition to spreadsheet read/write permissions. Snapshot-based chart
updates and typed table writes also require spreadsheet read permission.

Chart creation also supports print-example without a spreadsheet locator or
network access. The examples preserve upstream snapshot structure; placeholder
titles are translated into English to keep repository content English-only.

### Input normalization

JSON flags first use strict JSON parsing. A fallback accepts unambiguous Python
literals, single-quoted strings, trailing commas and unquoted text. It rejects
truncated containers, mismatched brackets, unsupported escapes and digit-led
ambiguous text. Quoted content is never rewritten. Style normalization preserves
canonical-field precedence by rejecting conflicting aliases rather than choosing
one silently. These transformations run before property schema validation.

Image metadata is inspected through bounded private artifact ranges. JPEG segments,
WebP chunks, and TIFF directories may point beyond the first megabyte; resumable
metadata inspection follows those offsets without loading the complete image.
Batch update and batch chart creation responses omit nested chart snapshots,
matching the CLI's compact response contract.

Conditional-format input accepts the CLI's unambiguous comparison aliases,
scalar comparison thresholds, single-object attributes, and cell-style font
spellings. Shape-specific operators remain unchanged. Chart JSON recursively
normalizes bare hexadecimal strings only under color keys; arbitrary text stays
unchanged. Ambiguous aliases remain visible to schema validation.

Flat string enums use the pinned CLI's case-insensitive canonicalization and
explicit cross-vocabulary aliases. Retired `dim-insert` inheritance value `none`
is treated as omitted. Invalid enum values still fail before any upstream call.

Sheets discovery lists canonical flag names. Runtime validation also accepts the
pinned command/domain aliases and separator/casing variants, then checks the
canonical flag whitelist and scalar types. This applies equally to standalone
commands and batch suboperations; unknown inputs are rejected before execution.

Bare range lists are accepted for conditional formats and batch clear with
quote-aware comma splitting. Bare dropdown option text is lifted to one option
only when it contains no comma. Detached chart headers must match the data
orientation and provide exactly one header per selected dimension.

File-capable JSON/CSV flags accept `@artifact-id` in place of CLI `@path` inputs.
Reads are scoped to the current grant and require artifact read permission in
preview and execution. Hosted text inputs are bounded to 20 MiB and decoded as
UTF-8 before normal shortcut validation. Inline text replaces terminal stdin;
`-` has no interactive stdin meaning in MCP. CSV file aliases identify private
artifacts rather than host paths.

Composite JSON flags are checked against validators compiled from the pinned
Sheets schemas after the documented normalization pass. Typed cell matrices
reject invalid content types before upstream execution.

A sheet qualifier in a range is lifted into the selector when every qualified
area names the same sheet. Quoted commas, doubled apostrophes, escaped separators,
and full-width separators follow the pinned reference grammar. Explicit sheet
selectors retain precedence; conflicting multi-sheet qualifiers are not guessed.

Chart update batches reject repeated targets before any mutation. A batch mixing
sheet IDs and names for the same chart ID resolves the workbook sheet names once
and compares their canonical IDs, preventing two stale-snapshot updates to one
chart in the same request.

Chart label deletion sends an explicit null in the mutation patch while omitting
labels from the returned view model, matching the pinned client transformation.

Repeated spellings of a flag coalesce when their JSON values are equal. Conflicting
values are rejected; object property order does not change equality.

## Source audit and acceptance boundary

The 91 registered Sheets handlers target upstream commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6` (1.0.97). The implementation status
records handler availability and the source-derived contract fixtures below; it
must not be interpreted as successful writes against a real tenant.

| Source family | Hosted implementation | Regression evidence |
| --- | --- | --- |
| Workbook, sheet structure, dimensions, ranges, cells, search and formula verification | `commands.ts`, `inputs.ts`, `matrices.ts`, `cell-writes.ts`, `resize-inputs.ts`, `read-output.ts` | `sheets-shortcuts.test.ts` |
| Flag aliases, enums, composite JSON repair and property schemas | `flag-normalization.ts`, `json.ts`, generated validators and enum tables | `sheets-normalization.test.ts`, `sheets-properties.test.ts`, `sheets-file-inputs.test.ts` |
| Cell styling, border vocabulary and declarative styles | `normalize.ts`, `styles.ts`, `declarative-styles.ts` | `sheets-border-vocabulary.test.ts`, `sheets-workflows.test.ts` |
| Charts, semantic snapshot updates and batches | `chart-input.ts`, `chart-program.ts`, `chart-batch-program.ts`, `chart-targets.ts`, `batch.ts` | `sheets-charts.test.ts` |
| Typed table creation, writes and reads | `table-write-input.ts`, `table-write.ts`, `table-read.ts` | `sheets-table-write.test.ts`, `sheets-table-read.test.ts` |
| Cell and floating images | `images.ts`, `image-metadata.ts` | `sheets-images.test.ts`, `sheets-image-metadata.test.ts` |
| Workbook import and export | `conversions.ts`, shared Drive conversion workflows | `sheets-conversion.test.ts` |

Generated flag vocabulary, enum/property tables, chart examples and validators
are compiled from the pinned source rather than manually inferred from command
names. Runtime definitions remain separate from workflow implementations.

The suite contains 136 offline Sheets tests. Native Workers separately verify
numeric JSON lexeme preservation. This evidence covers behavioral regressions and
synthetic upstream transcripts; tenant permissions, backend feature availability,
and the worst-case CPU cost of large JSON inputs still require integration and
resource-budget verification. Text artifact inputs have a 20 MiB cap. Long
operations return workflow receipts; output files return private artifact
receipts. These are explicit hosted adaptations of terminal execution.
