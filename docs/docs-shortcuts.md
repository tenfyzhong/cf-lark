# Document shortcuts

Document operations target docs_ai endpoints and preserve the pinned CLI's user and bot identities. Locators accept Docx, legacy Doc and Wiki URLs plus raw tokens; history rejects legacy Doc references. Wiki tokens are passed to docs_ai directly, matching the pinned CLI.

Fetch preserves scope, share-selection anchors, revision, language, comment sidecars and XML detail settings. Non-XML requests downgrade structural detail with a warning. Update validates each block operation, inclusive ranges and reference maps before any API request; append maps to insertion at the document-end sentinel. Search converts filter times, separates Drive folder and Wiki space restrictions, and adds ISO timestamp projections recursively.

Cloud text/file inputs use inline content or grant-owned artifacts rather than local paths. Creation, uploads, embedded resource processing and script transformations require additional orchestration; their parity status is tracked individually. No capability is marked complete solely because its primary endpoint is callable.

## Media and covers

Media export checks the selected identity's export permission first. Only the three upstream missing-scope error codes allow a best-effort download after the check; explicit export denial stops. Whiteboard export skips the Drive permission probe. Preview uses the dedicated media preview endpoint. All output is private artifact storage, authorized before any upstream request.

Cover download and deletion resolve Wiki references to Docx, read cover metadata and distinguish missing covers from malformed results. Cover deletion is idempotent and sends no patch when the document already has no cover. Resource type is explicitly limited to cover.

IM-Markdown conversion handles only known DocxXML tags and preserves unknown or truncated fragments. Nested same-tag structures use depth-aware matching. Tables and lists retain nested cell/item boundaries; inline code and fenced code select safe backtick lengths. Resource citations preserve the input tenant host, user mentions remain IM mention tags, and link destinations escape Markdown delimiters.

## Checkpointed media authoring

Media insertion and cover updates use a durable state machine. Each resume performs at most one Lark request. Insertion reads the document root, creates an image/file placeholder, uploads into that placeholder, and binds the returned media token. Definite upload or bind rejection schedules a separate best-effort rollback; uncertain write outcomes stop for reconciliation. File-wrapper child IDs are preserved for upload and binding. Cover updates upload before patching cover metadata and retain the uploaded token in their failure result.

Hosted clipboard input is an explicitly supplied clipboard-artifact ID, mutually exclusive with file or URL input. Cover URL input uses the injected unauthenticated remote-file transport. Image dimensions are computed from bounded PNG, JPEG, GIF, BMP, TIFF or WebP metadata when one dimension is supplied. Local paths are private artifact IDs.

## Exact parser feasibility probe

A build-time probe isolates the pinned CLI's pure DocxXML parser package, retaining its exact compatibility repair, word counting and block profiling logic. It copies only that package into a temporary module and exposes a JSON-in/JSON-out Go/Wasm function. Upstream source and module caches remain unchanged. This probe is not a production implementation until Worker startup, CPU, memory, concurrency and artifact size are verified. Source files containing non-English comments are never copied into this repository.

The isolated parser probe built a 5,261,982-byte Wasm module. Native Wrangler measurements on 2026-10-09 showed approximately 20 ms handler initialization plus 12 ms first parse, 1 ms warm parses for one or 100 short paragraphs, and 12 ms for 1,000 short paragraphs. Memory grew from 4.7 to 5.2 MiB. Module-scope startup was rejected because the Go runtime generates random data outside a request handler. These wall-time measurements were taken before private Durable Object engine integration and do not measure CPU directly. Native runtime tests now validate the production request initialization path.

The MCP dispatcher executes inside the Authority Durable Object, whose free-plan CPU budget differs from the front Worker. The parser therefore initializes lazily in a Durable Object request, caches its Go runtime per isolate, and executes the pinned parser synchronously behind an asynchronous port. It does not initialize Go in module scope. Build provenance records the upstream commit, Go version and Wasm SHA-256; the Go runtime and parser licenses accompany generated assets.

## Hosted draft workspaces

`docs.+script init-draft` saves the validated Presentation Decision as a private artifact and returns its ID as the workspace handle. It does not create an empty XML document. Subsequent parse calls may pass that workspace handle to reuse the baseline and supply inline XML or `@artifact-id` content. Parsing projects the exact pinned parser profile, then evaluates word-count bounds and required presentation blocks. Resource preflight checks artifact ownership and image sources before reporting a passed assessment.

### Shared pure message-card conversion

The bounded Go module also includes the pinned standard-library-only interactive
card and UserDSL formatters. It exposes a string-in/string-out formatter alongside
the document parser, shares one request-initialized runtime, and does not include
CLI networking, configuration, authentication, or filesystem commands. The IM
capability receives this formatter through a structural asynchronous port.

### Resumable document writes

Create and update prepare artifact-backed content and reference maps before the
first document mutation. XML resource tags are correlated using unique markers
returned in `document.new_blocks`; uploads never guess block IDs. Each upload,
async-task poll, and binding request is a separate workflow step. A lost mutation
response remains uncertain and is not automatically replayed. HTML5 and
whiteboard file inputs use private artifact handles in place of local paths.
Bot-created documents attempt a grant only for the single account already
selected by the caller's authorization; no unrelated account is inferred.

The same module exposes pinned Base matrix export, Markdown rendering, and gojq
operations through a JSON operation port. Query output is capped at 10,000 values;
the adapter validates and bounds input before invoking the pure engine.

### Free-tier engine groups

The pure engine is built as two independent Wasm modules: Docs/Card/Base and Mail.
Each production adapter imports only its own module. Private service Workers
execute these modules inside their Durable Objects, and the primary MCP Worker
uses injected ports over service bindings. This keeps the compressed deployment
size of each script below the free-tier limit while retaining exact upstream
transformations. The combined build is a local verification fixture only.

Fetched HTML5 blocks require matching reference-map entries. Entries over 1,024
UTF-8 bytes are saved as private HTML artifacts and returned as `path: @artifact`;
smaller entries remain inline. Artifact write authorization is checked before
saving any output, and Markdown code examples remain inert.

Image metadata normalization reads bounded headers for PNG, JPEG, GIF, BMP,
TIFF, and WebP. Document writes retain intrinsic pixel dimensions and convert
requested display dimensions to the upstream scale, capped below the 1,020-pixel
page width. Metadata inspection never decompresses image pixels.

IM-Markdown output is also generated by the pinned pure upstream converter in the
Docs engine, preserving its tag-specific semantics and tenant-link handling.
The TypeScript converter remains a local compatibility fallback for adapters
that do not provide the engine port.

`workspace` on `docs.+script` and `clipboard-artifact` on media insertion and cover
updates are deliberate hosted extensions. They represent grant-owned private
artifact handles because the server cannot read a client's working directory or
system clipboard. They do not grant access to arbitrary server files. The script
command itself has no unconditional Lark scope; only its optional online fetch
performs an upstream read under the selected account's existing authorization.

Inline Markdown resource parsing preserves nested image labels, angle-bracket
artifact destinations, quoted titles, balanced destination parentheses, and
inert code regions. Resource binding retries a definite transient failure only
after reading the target block and confirming that its token is still empty.
The response carries the latest successful resource-binding revision.

Async creation preserves nested business-failure diagnostics, rejects missing task
envelopes, and honors server polling hints with a 100–10,000 ms bound and a
3,000 ms default. Correlation rejects every resource sharing a returned block ID
before uploading any payload to that ambiguous block.

Read-only task polling retries transient transport and HTTP gateway/rate-limit
failures from the saved task checkpoint, with bounded backoff. Authorization
errors terminate polling; the document write is never replayed.

Ambiguous resource correlation never starts uploads. When every returned block
has the expected type and no unknown marker exists, cleanup visits each unique
candidate once, verifies its empty token, and deletes it with the current
revision. Duplicate-marker candidates share the same bounded cleanup workflow.

Native parser characterization uses text-heavy and node-heavy XML fixtures near
the input ceiling and records Wasm linear-memory high-water allocation. A parsed
profile must preserve the pinned word and block counts; memory failures are
reported explicitly rather than accepted as successful parsing.

The free-tier native measurement for 100,000 paragraphs in 19,200,021 bytes
allocated 111,673,344 bytes of Wasm memory before JavaScript request overhead.
The hosted parser therefore rejects XML with more than 32,768 markup delimiters
or 2 MiB of markup text before entering Go. The 20,000,000-byte input ceiling
still applies, and accepted documents retain exact pinned profile semantics.
These are explicit deployment resource limits, not truncated profiles.

Measured accepted native fixtures: 19,500,007 bytes of paragraph text produced
3,900,000 words and one block at 66,584,576 bytes of Wasm memory. A 19,773,095-byte
fixture with 16,382 paragraphs produced 3,931,680 words at 76,546,048 bytes of Wasm
memory. The measurements describe Wasm allocation; the tests also exercise the
private service request path, whose JavaScript and transport allocations are
additional. These are local native-runtime results, not production telemetry.
