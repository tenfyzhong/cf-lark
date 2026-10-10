# Base record reads and exports

## Behavior and interfaces

The record-get, record-list, and record-search adapters preserve their existing
hosted read contract: when neither format nor output is supplied, all three
return inline Markdown. They accept `markdown`, `json`, and `ndjson`. Markdown
uses the pinned pure renderer, including single-record display for get and a
fallback to the original matrix with a notice when rendering fails. Inline JSON
preserves the upstream matrix. These inline reads require only the existing Base
read grant, with no artifact-write permission or export workflow. Reading an
explicit artifact input still requires artifact-read permission.

Explicit `format: "ndjson"` opts into private record and manifest artifacts.
For compatibility, supplying an output filename while omitting format also
selects NDJSON. The NDJSON one-page behavior follows lark-cli commit
`9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d`; its changed default and removal of
Markdown are not adopted on the existing hosted command IDs.

List and search NDJSON default to a limit of 2000, accept limits from 1 to 2000,
and issue exactly one data request with the requested offset and limit. A short
page with `has_more: true` is still one complete command result. Continue with a
new command using the manifest's `next_offset`; there is no hidden pagination or
500-row subdivision. Markdown and JSON retain their inline limits: list defaults
to 100 and search to 10, both with a range of 1 to 200. Get reads the explicitly
selected record IDs once and preserves selected-record query context in its
NDJSON manifest.

Requests preserve projection aliases, JSON-body precedence, view/filter/sort
precedence, and selected-record validation. Preview validates without contacting
Lark. JSON inputs can reference private artifacts; filesystem paths are display
names only. Export preview reports the actual requested page size.

The pure recordexport package generates typed records, column statistics,
examples and manifest metadata in the shared isolated WebAssembly runtime.
Exports create grant-owned record and manifest artifacts in a durable two-phase
workflow: one data request, then artifact publication. The output filename is a
suggestion; fresh artifact IDs prevent overwriting unrelated data. The
compatibility overwrite flag is accepted without reusing a local filesystem path.
The built-in jq engine operates once on the complete returned records array and
never changes either artifact. It has no network or filesystem access and runs
with a bounded evaluation context. Minimal output and jq-records are exclusive.

## Compatibility changes

- Existing omitted-format and explicit Markdown reads keep their inline response
  and existing read-only grants. No migration or expanded permission is needed.
- Explicit NDJSON exports (or output filenames with format omitted) require
  artifact-write permission and a resumable export workflow.
- NDJSON list/search no longer fetch further pages automatically. Inspect `has_more`
  and issue the next command with `offset: next_offset` when more data is needed.
- Workflow version 2 establishes the one-page contract. Stored version 1
  workflows cannot resume after this upgrade and return
  `WORKFLOW_VERSION_CHANGED`; start a fresh read instead.

## Acceptance criteria

Reusable mocked tests must establish the following before release:

1. Get, list, and search return inline Markdown by default and when explicitly
   requested, using Base-only read grants without artifact access or workflows;
   definitions advertise Markdown, JSON, and NDJSON. Rendering failures preserve
   the original matrix with a notice.
2. Explicit NDJSON and the output-filename compatibility default start exports;
   invalid formats are rejected before upstream or artifact I/O. List/search
   format-specific defaults and limits include JSON search bodies and page-size.
3. Export preview and the actual list/search request preserve offset and limits
   above 500, up to 2000, without automatic follow-up requests.
4. Full, short, and empty pages with `has_more` reach export after one request;
   manifest continuation offsets use the returned row count.
5. Get preserves requested IDs, projection, and selected-record metadata; JSON
   executes once and returns the matrix unchanged without export dependencies.
6. Malformed matrices and oversized server pages fail before artifact writes.
7. Artifact export and jq preserve typed data and continuation metadata without
   altering the saved NDJSON or manifest.

These checks use synthetic upstream responses and the checked-in isolated
formatter. They do not prove live Lark tenant permissions or endpoint behavior.
