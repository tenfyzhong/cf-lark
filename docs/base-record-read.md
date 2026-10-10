# Base record reads and exports

## Behavior and interfaces

The record-get, record-list, and record-search adapters target lark-cli commit
`9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d`. All three default to NDJSON and
accept only `ndjson` or `json`. Explicit Markdown is rejected before an upstream
request or artifact write. Inline JSON preserves the upstream matrix.

List and search NDJSON default to a limit of 2000, accept limits from 1 to 2000,
and issue exactly one data request with the requested offset and limit. A short
page with `has_more: true` is still one complete command result. Continue with a
new command using the manifest's `next_offset`; there is no hidden pagination or
500-row subdivision. JSON retains its inline limits: list defaults to 100 and
search to 10, both with a range of 1 to 200. Get reads the explicitly selected
record IDs once and preserves selected-record query context in its manifest.

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

- Clients that previously omitted format must permit artifact writes and resume
  the export workflow. Set `format: "json"` to retain an inline raw matrix.
- Replace `format: "markdown"` with `ndjson` or `json`.
- List/search no longer fetch further pages automatically. Inspect `has_more`
  and issue the next command with `offset: next_offset` when more data is needed.
- Workflow version 2 establishes the one-page contract. Stored version 1
  workflows cannot resume after this upgrade and return
  `WORKFLOW_VERSION_CHANGED`; start a fresh read instead.

## Acceptance criteria

Reusable mocked tests must establish the following before release:

1. Get, list, and search default to NDJSON; definitions advertise only NDJSON and
   JSON, and direct preview/execute reject Markdown without upstream I/O.
2. List/search defaults and both explicit limit boundaries match the pinned
   source, including JSON search bodies and the page-size alias.
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
