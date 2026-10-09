# Task shortcuts

The Task adapter targets the 17 registered shortcuts in lark-cli 1.0.97.
It preserves explicit false flags, task GUID and applink handling, caller identity,
upstream field names, pagination, detail enrichment, and task output fields.

Task queries use durable workflows: each resume performs at most one upstream
request. Pagination retains the last upstream cursor even when local date or
relationship filters discard all results. Search enrichment failures retain the
original stable identifier rather than discard a search hit. No write is retried
when its outcome is uncertain. Clients resume pending results with workflow.resume.

The hosted service has no machine-local timezone. Date-only and relative dates
use UTC; explicit ISO timestamps preserve their instant. Query date bounds are
inclusive and support signed minute, hour, day, and week offsets. The account
selected by the authorized connection supplies the current user, never a caller
provided profile identifier used as an upstream user ID.

Local attachment paths are replaced with grant-owned artifact IDs. Terminal
formatting is replaced by structured JSON. Tests use recorded-shape synthetic
responses and do not demonstrate live account permissions or Dots acceptance.

Acceptance requires all registered flags, request construction and validation,
no-I/O previews, bounded workflows, output projections, attachment ownership,
and mocked failure/pagination tests before claiming complete domain parity.

Write workflows validate every supplied JSON value before the first remote write.
Create flags override JSON data. Update expands comma-separated GUIDs, and complete
first reads state to avoid changing an already completed task. Reminder replacement
reads existing IDs, removes them, then adds the replacement. Tasklist member set
computes an exact difference. Tasklist creation and add-task fanout preserve partial
success in structured output; ambiguous network outcomes are never retried.

The optional `name` upload flag preserves the original file extension and multipart filename when the private artifact ID is opaque.
