# Typed table writes

Typed table input follows the pinned CLI's pandas-shaped columns/data contract. Column objects accept the upstream heading aliases, explicit dtype/format maps override inline labels, and positional label arrays must match declared columns exactly. Repeated headings may share one label but cannot receive conflicting positional labels. Missing columns infer an untyped, headerless rectangle; trailing empty cells beyond declared headings do not enlarge a table. Generated sheet names avoid names already present in a new workbook.

Table styles are validated before any workbook or missing-sheet creation. Typed style items align one-to-one, in order, with sheet items. Untyped values and style-only workbook creation accept exactly one style item. Cell style ranges may extend the matrix down and right; they cannot begin above or left of its write anchor. Existing-sheet append defers the row check until the physical append row is known. All projected rectangles are budgeted before allocation.

Cell styles merge directly into the table matrix and preserve per-column number formats unless explicitly overridden. Borders merge by side. Merges, row/column resizing and freeze operations remain separate visual operations, performed after data writes. Style-only creation derives a sheet extent from cell ranges, merges and dimension sizes so visual operations are not skipped.

Each sheet completes its visual operations before the next sheet begins. Missing sheets are sized from data, headers, anchor offsets and visual extents, retaining the upstream creation bounds. JSON input uses the shared strict-first repair parser. Whole-axis cell style stamps are rejected before creation because they do not specify a bounded matrix.

Confirmed upstream failures after workbook creation or completed sheet writes return an `ok: false` partial result containing the spreadsheet token, completed sheet summaries and the structured cause. Ambiguous transport outcomes remain uncertain workflow failures and never become a retryable success result. Previously completed sheet summaries exclude a sheet whose visual phase failed.

JSON-string table and values inputs retain numeric source lexemes through the engine's JSON reviver source context. Numeric dtype strings use their validated JSON-number spelling directly. Tool input serialization writes these lexemes as JSON numbers, preserving large identifiers, decimals and exponents without a JavaScript-number round trip. Already-decoded MCP numeric values retain only the precision provided by the client; callers requiring exact numbers should send JSON-string payloads. The Worker runtime must provide JSON parse source context, and unsupported runtimes reject exact numeric decoding instead of silently rounding.

Default-sheet adoption preserves an already existing first target. Item-level borders are lifted only when one cell style entry exists and has no border spelling of its own; conflicting aliases are rejected instead of choosing a winner.

## Native numeric acceptance

`test/runtime/sheets-json-numbers.test.ts` checks workerd's JSON reviver
`context.source` with integers above the JavaScript safe integer range. It
executes the typed-table write program and inspects the outgoing serialized
input, requiring an exact unquoted numeric literal rather than a rounded Number
or a text cell. Strict and lexically repaired JSON inputs use the same check.
The Lark port is a deterministic fixture and performs no external write.

ISO datetime inputs retain the supplied wall-clock time as an Excel fractional
day, including timezone-qualified inputs. Values-mode workbooks with visual
styles but no rectangular cell extent apply those styles to the existing default
sheet without renaming it or sending an empty cell write. Their result contains
only the created spreadsheet metadata, as in the pinned CLI.
