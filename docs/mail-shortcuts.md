# Mail shortcuts

The Mail adapter targets all 31 shortcuts registered in lark-cli 1.0.97.
Message and thread projection, pagination, labels and folders, receipt actions,
mail rules, draft lifecycle, reply recipients, quoted bodies, signatures,
templates, HTML lint, MIME attachments, and ICS content are separate behavioral
contracts; raw OpenAPI access is not shortcut parity.

The selected authorized account identifies the mailbox. JSON files and stdin
become inline JSON. Local attachments, body files, MIME downloads, and temporary
files become private grant-owned artifacts with explicit filenames. Long-running
polling uses durable event inboxes rather than a Worker request kept open.

Fanout and multiple remote mutations use durable workflows. Each resume performs
at most one upstream call. Unknown send outcomes never cause automatic resends.
Explicit send confirmation remains required where the pinned shortcut requires
it; discovery and preview are side-effect free. No tests send real email.

Acceptance requires the complete flag inventory, upstream request and output
fixtures, recipient/quote/signature composition, binary attachment handling,
partial results and uncertain-write behavior, and native Worker MCP tests.

Signature previews use English locale values with the API default value as a
fallback. Mail timestamps are formatted in UTC. Mail sharing saves the returned
card ID before sending, and never repeats a send after an uncertain response.
Draft batches keep a per-draft ledger and stop immediately on account-level or
uncertain failures. Definite draft-specific errors can continue unless
`stop-on-error` is set.

Rule commands decode known numeric conditions and actions into semantic aliases,
preserve unknown raw nested fields during updates, and return unknown-field
warnings. Updates read, compare, merge, write, and read back; a failed final read
returns the confirmed write with a fallback projection. Reordering validates the
complete current ID set or computes a single relative move. Rule descriptions
are English. Conditions and actions accept grammar strings or structured JSON;
collections are bounded at 100 entries and 1 MiB of input each.

Mail watch uses verified HTTP callbacks and bounded polling instead of a local
WebSocket process. The first call subscribes the selected mailbox; subsequent
calls pass the returned `cursor`. `stop: true` explicitly unsubscribes. Each
poll filters the profile callback inbox and performs at most one upstream request
per workflow step. `output-dir` is a logical artifact directory; full JSON
payloads are saved privately under the MCP grant. The application must already
be configured to deliver the mail event to its callback endpoint.

The mail transformation port runs pinned upstream pure Go routines in the shared
Wasm engine. The initial operation is `lint`, returning the upstream cleaned
HTML and structured warning/error findings without network access. The module
is initialized inside the Durable Object request and reuses the existing
serialized engine adapter. Mail code only depends on the port, never the
platform engine. Generated Wasm provenance records the pinned source revision.

Compose commands resolve sender identity from the mailbox profile, optionally
apply a template and default signature, then create an RFC 2822 draft through the
pinned MIME builder. Sending occurs only when `confirm-send` is true; draft-create
always saves. Reply and forward preserve upstream threading and native quote
markup. Receipt sends require the original read-receipt-request label. Binary
inputs are private artifact IDs, optionally accompanied by filename metadata;
no local filesystem paths or public file URLs are accepted as artifact inputs.

Mail attachment uploads reject the pinned executable-extension denylist before reading private artifacts or calling Lark. Unknown upload phases are rejected before any upstream mutation. Template create and update use the shared streaming attachment uploader.

Large attachment cards and read receipts use the pinned Go presentation functions, including brand-specific download URLs, subject-prefix deduplication, escaped filenames, localized receipt labels, and the encoded large-file token header. The transformation receives already uploaded tokens and never handles credentials or performs network requests.

Compose stages source and template attachments through private artifacts. Download URLs are resolved in batches of 20; remote content is fetched through the shared credential-free, HTTPS-only transport. Signature images retain their CID and 10 MiB limit. Forwarding skips already-large source attachments, which remain links in the quoted message. Template LARGE entries remain token references; template inline anomalies are reported and skipped.

Hosted watch extensions are `cursor` (resume the durable inbox sequence), `limit` (bound events per poll), and `stop` (unsubscribe explicitly).

Template application preserves the CLI's recipient append semantics, subject precedence, and HTML/plain-text body merge. Signatures are inserted before the system quote or large-attachment tail using the pinned draft helpers.

Draft edits stream oversized added attachments through Drive before applying the remaining MIME patch. The original draft is stored as a private temporary artifact between steps. Signature image bytes are supplied directly to the pinned patch engine. Confirmed draft updates remain successful even if temporary-artifact cleanup fails; normal artifact expiry reclaims that storage.

Local `<img src>` references in authored HTML are interpreted as private artifact IDs. They are rewritten to CID references before MIME parsing, so neither the Go engine nor the Worker reads a filesystem path. Repeated references share one inline part; HTTPS, data, and existing CID references remain unchanged.

MIME assembly streams attachment payloads. The pinned Go builder emits a bounded MIME skeleton using unique placeholder bytes; the Worker replaces only those encoded payload slots with artifact streams, preserving exact part headers, boundaries, and 76-column MIME base64 wrapping. The complete EML is then base64url-encoded directly into the authenticated draft JSON request stream. This preserves the 25 MiB embedded-message threshold without materializing attachment bytes in the Wasm heap.

Large existing drafts are read as streamed JSON and partitioned at MIME boundaries. Attachment bodies are decoded directly into temporary private artifacts; only MIME headers, text content, and small image-signature prefixes enter the Go parser. Removed MIME parts are not restored. Retained payloads are streamed back into the edited skeleton, keeping final MIME size enforcement before the authenticated PUT.

Calendar edits reject already-created calendar events and derive attendees from all pending recipient operations before generating the replacement ICS. Event timestamps and summary remain required as in the CLI; an event already created upstream must first be removed in a separate edit.

Current resource boundary: body-file reads and retained draft text/header skeletons are capped at 8 MiB. Large embedded attachments are streamed and retain the 25 MiB final EML limit; the text/HTML bound is a declared hosted resource ceiling. All shortcut flags and workflow branches are implemented within those ceilings.

Mail callback polling verifies the selected mailbox profile through the current user token on each poll, including cursor continuation. Only events whose `mail_address` matches that verified mailbox are exposed, even in event-only mode. Profile-wide callback storage must not broaden an account-scoped MCP grant.

The pure bridge initializes missing MIME multipart parameter maps before serialization. This repairs a pinned upstream edge case when a calendar edit turns a single-part draft into multipart content. Bridge panic recovery converts unexpected pure-transform failures into errors so one malformed operation cannot terminate the shared transformation runtime.

Draft patch `add_attachment` accepts an optional `filename` alongside the opaque artifact `path`; it becomes the MIME attachment filename. Inline patch operations retain their pinned `filename` behavior.

Measured HTML complexity ceiling: each pure mail call permits a combined budget of 8 MiB, calculated as UTF-8 text bytes plus 256 bytes per markup opener (`<`). Thus text-heavy HTML can approach 8 MiB while markup-dense HTML has a lower limit, up to 32,768 openers before text overhead. The same check applies to decoded draft HTML before projection. Measurements found dense `<p>x</p>` at 256 KiB already used 147.5 MiB of Wasm memory alone; rejecting it before DOM construction prevents a predictable free-Worker memory failure. This limit does not reduce streamed attachment capacity.
