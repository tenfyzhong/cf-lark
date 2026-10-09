# Dynamic write scope challenges

Mixed-risk commands, including raw API requests, determine their OAuth write
challenge from normalized, schema-validated arguments. A POST mutation under a
read-only token receives the same `insufficient_scope` challenge as a static write
command. Invalid inputs remain the dispatcher's validation responsibility and do
not trigger a speculative consent upgrade. Schema and search discovery do not
classify mixed-risk commands as unconditional writes.

The HTTP adapter receives the shared input-validator port; it never obtains
credentials or invokes a command while computing the challenge. The dispatcher
continues to enforce grant domain, identity, account and operation permissions.

Preflight body parsing uses the same 4 MiB limit as the MCP transport, including
streamed bodies without a Content-Length header. Oversized input receives 413
before JSON parsing or command lookup.
