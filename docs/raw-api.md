# Raw and shared API execution

`api.request` is the hosted equivalent of `lark-cli api METHOD PATH`. It requires explicit `api` domain consent and read permission for GET, write permission for mutation methods. A supplied URL contributes only its validated `/open-apis/` path; credentials always go to the selected Lark brand origin. Query strings, fragments, path traversal and redirects cannot select an alternate credential destination.

Arguments accept `params` and `data` as JSON values or JSON strings; `body` aliases `data`. Private JSON files use `@artifact:<id>` with a 2 MiB UTF-8 input ceiling. Multipart `file` accepts `[field=]artifact:<id>/<filename>`. Binary `output` is a display filename for a new private artifact. Artifact read/write consent is independently enforced. Local stdin and filesystem paths are replaced by private artifacts.

The reusable API runner performs one upstream request per durable step. `page-all` follows query page tokens, default limit 10, with 0 meaning no explicit page cap; workflow expiry and the shared 2 GB quota still apply. Default page delay is 200 ms, implemented as a durable next-run timestamp. Aggregate results retain first-page metadata and last-page `has_more`, remove cursor fields, and merge the pinned primary-array priority. Later-page failures return collected data with an explicit partial-result warning instead of silently suggesting completeness. Repeated token cycles fail explicitly.

Full pinned gojq evaluates against a structured success envelope with `data`, preserving `.data` expressions. JSON remains the native MCP representation; `ndjson`, `csv` and `table` return structured records and an explicit requested-format marker instead of terminal layouts. This preserves values without ANSI or terminal-column formatting. `jq` cannot be combined with non-JSON format or binary output. Syntax validation occurs before upstream writes.

Shared runner programs are registered separately by business domain and read/write risk, preserving typed endpoint grants. A raw API request cannot obtain access through a narrower typed-domain grant. Dry-run validates shape and conflicts but never reads artifacts or contacts Lark.

Transfer ceilings are explicit cloud resource limits: the shared streaming multipart client permits 5 MiB for IM images, 100 MiB for IM files, 50 MiB for task attachments, and 20 MiB for other single-request uploads. Larger domain-specific uploads use their existing multipart workflows when available. Download artifacts share the configured temporary-storage quota (2 GB by default); they do not allocate an additional independent allowance.

The raw transport supports GET, POST, PUT, PATCH and DELETE, including mutation-method multipart uploads and binary responses. HEAD and OPTIONS are omitted: they are not part of the pinned CLI's advertised business-method completion surface. No CONNECT or TRACE tunnel is exposed.

Generic jq evaluation has a conservative hosted input budget: 1 MiB of serialized input and 16,384 JSON values, including container nodes. This is checked before the pure formatter is called. Boundary fixtures exercise both text-heavy and node-heavy shapes in native workerd. These limits describe tested supported inputs, not a measurement of peak heap or a claim that larger inputs always fail. Larger results can be fetched without jq or narrowed upstream.

The hosted HTTP client returns business data under the MCP success envelope. Consequently pagination fallback `{pages: [...]}` contains business payloads, not duplicate upstream `code`, `msg` or request-log envelopes. First-page business metadata and notices are retained. This is an explicit response-envelope adaptation, shared with the existing typed API commands.

Native boundary evidence: `test/runtime/raw-api-jq-budget.test.ts` passed both the exactly 1 MiB text case and the exactly 16,384-value case using the actual pinned engine in workerd. The two tests completed in 161 ms in the initial acceptance run; this is test elapsed time, not peak-memory telemetry.
