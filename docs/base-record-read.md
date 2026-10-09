# Base record reads and exports

The adapter implements record-get, record-list, and record-search from the pinned
lark-cli 1.0.97 source. Requests preserve projection aliases, JSON-body precedence,
view/filter/sort precedence, pagination limits, and selected-record validation.
Preview validates without contacting Lark. JSON inputs can reference private
artifacts; filesystem paths are display names only.

Inline JSON preserves the upstream matrix. Markdown uses the exact pure upstream
renderer, including single-record display and fallback to the raw matrix when
rendering fails. NDJSON exports retrieve at most 500 rows per durable step and at
most the requested 2000-row limit. Cross-page schema and timezone checks prevent
silently combining incompatible datasets.

The exact pure recordexport package generates typed records, column statistics,
examples and manifest metadata in the shared isolated WebAssembly runtime.
Exports create grant-owned record and manifest artifacts. The output filename is
a suggestion; fresh artifact IDs prevent overwriting unrelated data. The
compatibility overwrite flag is accepted without reusing a local filesystem path.
The built-in jq engine operates once on the complete exported records array and
never changes either artifact. It has no network or filesystem access and runs
with a bounded evaluation context. Minimal output and jq-records are exclusive.
