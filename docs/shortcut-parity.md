# Shortcut Parity

The upstream baseline is lark-cli v1.0.97 at commit
72579c80027c863ca51d5f9affda72a70ab0d8a6. Counting source files is not a
command inventory. Enumerate AllShortcuts(), including hidden commands and
identity-specific scopes, and preserve stable service/command IDs.
Descriptions containing non-English source text are not copied.

## Contracts

Shortcut IDs retain the CLI service and plus-prefixed command, for example
`docs.+create` and `im.+messages-send`. Arguments use CLI flag names without the
leading dashes. Existing API commands remain available independently.
Each implemented input variant needs behavioral fixtures; an omitted variant
keeps the upstream command pending in the full compatibility manifest.

Document creation accepts inline XML or Markdown, an optional title, and one
parent location. It invokes the same docs_ai endpoint as the CLI. Async results
must be polled without repeating the create request. A processing result must
never be reported as a completed document. Polling is bounded by the per-command
request budget. Failure responses, malformed results, and task ID changes fail
explicitly. Local-resource resolution and automatic bot permission grants need
separate coverage before the upstream shortcut can be marked fully implemented.

Message sending accepts exactly one recipient and content source. Plain text
and Markdown are converted to the API's JSON-encoded content field. Structured
content is validated before requests. Recipient identifiers, explicit message
types, and idempotency keys are validated in preview and execution. Media
uploads and attachment resolution require a separate artifact transport.
Unsupported flags must be rejected rather than silently ignored.

## Authorization

Search responses expose granted domains and permissions, so clients can
distinguish missing write consent from missing functionality. Existing grants
are never broadened automatically. Adding a domain requires renewed consent.
Search, schema, and execution continue enforcing the same grant. Clients that
request only read must be told that writes require reconnection with mcp:write.

## Acceptance

1. Generate the exact registered shortcut inventory reproducibly from the pin.
2. Add failing unit tests before each handler or authorization behavior change.
3. Verify create and send through MCP discovery, schema, preview, and execution
   using injected upstream responses, including async failure and invalid input.
4. Run native Workers checks with precompiled schemas and no runtime eval.
5. Separate mocked transport evidence from real Dots and Lark acceptance.
6. Keep fullCompatibility false until all business workflows and cloud file,
   event, authentication, and configuration adaptations have passed acceptance.

A direct schema or execution request for a write command with a read-only OAuth
token returns HTTP 403 with the standard insufficient_scope challenge for both
mcp:read and mcp:write. This allows capable MCP clients to request renewed
consent. Reading and discovery remain usable with read-only tokens. Even after
scope elevation, the selected profile, account, domain, and operation grant must
still authorize execution; a scope challenge never grants access itself.

Protected-resource metadata must advertise both supported MCP scopes even though
only mcp:read is mandatory for basic access. The authorization-server metadata
alone is insufficient: clients may choose requested scopes from resource
metadata. Publishing mcp:write there does not modify or expand existing grants.

For a read-only token, a nonempty discovery query matching only write commands
also returns the scope challenge. Otherwise those commands would be hidden before
the client could discover the ID needed to request elevated access. Mixed
read/write queries and empty catalog browsing continue with grant-filtered read
results. Search matching is shared with the dispatcher to avoid divergent rules.

## Message media keys and attachments

Message sending accepts existing image, file, audio, and video keys. Video
requires a cover image. These inputs infer the message type and reject
conflicting explicit types or multiple content sources before a request.
Attachment keys create or extend a post attachment zone, deduplicate in order,
and cannot be combined with plain text or an existing content `files` array.
Artifact-backed uploads and remote media URLs remain separate pending branches;
existing keys never trigger uploads. Text mentions normalize `id` and `open_id`
to `user_id` before JSON encoding.
