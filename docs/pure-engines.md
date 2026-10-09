# Private pure transformation services

The public `cf-lark` Worker delegates pinned, CPU-heavy pure transformations to two private service-binding Workers: `cf-lark-docs-engine` and `cf-lark-mail-engine`. Neither has routes, preview URLs, or a workers.dev endpoint. Neither receives Lark credentials, OAuth grants, encryption keys, or R2 access.

Each private Worker forwards binding requests to its own SQLite Durable Object. The object initializes the Go WebAssembly engine only inside a request and reuses it for subsequent transformations. Its CPU budget uses the Durable Object free-tier limits rather than the generic Worker CPU limit. The entrypoint performs no transformation outside the object.

The split preserves the free 3 MiB compressed script limit while retaining upstream document parsing, card formatting, Base formatting and jq, and Mail MIME and HTML behavior. Both engine scripts and the public script must pass independent minified dry-run size checks. Deploy engines before the public Worker. Service binding names are `DOCS_ENGINE` and `MAIL_ENGINE`.

The internal JSON protocol accepts only an allowlisted operation and its arguments. Errors contain stable codes and safe messages. Requests and responses are bounded; the caller never chooses a network destination. Services cannot execute CLI commands or access a filesystem. Transformation outputs inherit the caller's authorization checks in the public service.

## Local browser acceptance

The Playwright management server starts the public Worker and both private engine
configurations in one local Wrangler multi-Worker session. This resolves the
production service-binding names without reaching deployed services. The catalog
fixture remains a separate local server. Browser persistence uses a per-process
isolated directory; test-only administration and encryption values never modify
production secrets. Native engine suites separately exercise transformation
behavior; management browser success alone does not prove those operations.

Shortcut browser fixtures exercise document creation through repeated
`workflow.resume` calls and assert final document output, request bodies, and
completed-result replay without additional writes. Message fixtures return real
message metadata and assert its normalized result alongside the outbound body.
The fixture is entirely local and never sends Lark business requests.

The catalog browser sweep uses structured `params` and `body` examples for each
API descriptor. It excludes aliases and optional transfer/output flags from the
baseline request; those modes have dedicated runtime tests. Example generation
selects the structured branch of union schemas so JSON input is valid. The PR
verification sweep reproduced failures when the old generator supplied invalid
JSON strings and both `body` and `data` aliases simultaneously.
