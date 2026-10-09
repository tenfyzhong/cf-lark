# IM shortcut compatibility

The IM adapter follows lark-cli 1.0.97 business behavior. Preview validates the
same arguments without making network calls. Credentials remain in the injected
Lark client. Cloud artifacts replace local paths; durable workflows replace
unbounded pagination and media processing. Workflow results must be resumed until
completed, preserving the selected profile, account, and identity.

## Chat and feed commands

Chat creation validates Unicode name lengths, member limits and identity-specific
bot manager selection. Creation returns the projected chat fields, a brand-aware
app link, and a best-effort share link. Chat updates require a nonempty changed
field. Feed shortcut mutations deduplicate chat IDs and return a per-item success
ledger even when the upstream envelope succeeds with individual failures.

Feed listing preserves its version-locked one-page contract. Optional chat detail
enrichment processes batches of at most 50 IDs. Feed group auto-pagination merges
both active and deleted arrays, retains the continuation token when a page limit
or repeated cursor stops traversal, and enriches both arrays. Each workflow step
performs at most one upstream request. Enrichment failures retain the primary
result and report an English notice.

## Acceptance evidence

Reusable mocked transport tests verify request payloads, validation before side
effects, batch failure accounting, pagination, and enrichment. They do not prove
live Lark permissions or authorize sending real messages.

## Read status and membership

Read-user and member listing accept a starting cursor independently of automatic
pagination. Member pages merge users and bots independently and retain only the
final page's truncation and total signals. A zero page limit means unlimited
continuation through bounded workflow steps. Read-status requests validate one
to fifty message IDs before the first request.

## Bookmarks

Bookmark creation defaults to the message layer. Feed-layer writes infer the
thread item type from the message's chat mode only when no explicit valid pair
is supplied. Default cancellation attempts both layers independently and retains
per-layer success or failure. Failed read-only inference skips only the optional
feed cancellation. Listing merges all three arrays and enriches only active
feed/thread entries, reusing inline messages before requesting missing IDs.

Chat listing and search preserve canonical and legacy sort flags, normalize
search modes, and apply the mute filter after page aggregation. Bot callers
cannot list only private conversations; mixed types retain groups with a notice.
Unknown mute states retain the chat. Search-only public nonmember results and bot
identities skip mute queries. Search notices survive later pages without notices.

## Message writes and media

Send, reply, and edit share one content builder. Exactly one inline content source
is accepted, with post-only attachment zones and explicit clearing for edits.
Markdown heading and table spacing match the pinned CLI optimizer, while fenced
code is protected. Media keys pass through; `artifact:<id>/<filename>` identifies
a grant-owned upload. Public URL downloads use an injected credential-free port.
Remote media is staged privately before upload, so workflow records never contain
binary bodies. Image uploads are limited to 5 MiB and file uploads to 100 MiB.
Audio inputs must be Opus when their filename declares an extension. URL upload
failure falls back to a text link, except a failed video cover is a hard failure.
Failed Markdown images are removed while preserving the rest of the message.

Media workflows perform preparation, upload, and send as distinct durable steps.
A send with unknown outcome is never replayed. The idempotency key is preserved.
Cloud output timestamps use UTC rather than the local timezone of a CLI process.

Opus duration uses the final Ogg granule rounded up to whole seconds, matching the
CLI. MP4 duration uses the movie header time scale. Extended box lengths are
validated before seeking. Missing or malformed duration metadata does not reject
an otherwise valid upload.

Resource download accepts message ID, resource key, and image/file type. Output
is an optional display filename; no server filesystem path is created. Binary
responses are streamed into an OAuth-grant-owned artifact and return artifact ID,
size and suggested filename. No raw Lark token is exposed in its URL.

The public event message formatter converts text, localized rich text, mentions,
media references, calendar shares, task summaries, polls, and system templates to readable content. Raw unsupported message types retain an
explicit type marker. Advanced card, merge-forward, folder expansion,
and message query enrichment remain separate compatibility work until covered by
upstream-derived fixtures; a generic marker is not evidence of full parity.

## Message reads

Message reads resolve P2P and thread targets, paginate before enrichment, request
server sender names, and encode repeated message IDs explicitly. Search fetches
full records in batches and preserves an ID-only fallback if detail lookup fails.
Reaction enrichment batches at most twenty messages and marks per-message errors.
The pure content converter is shared with event processing. Card, merged-forward,
and folder rendering follow the pinned source; native MCP tests exercise the
compiled card engine through encrypted durable checkpoints.

Merged-forward reads expand a flat upstream parent/child tree in timestamp order,
with bounded cycle protection. Folder reads expand one level and render at most
ten children, preserving child counts and a has-more signal. Thread expansion
attaches replies only to the first occurrence of a thread and preserves the CLI's
50-per-thread and 500-total output limits. Every enrichment request occupies its
own durable step; failure retains the primary message with an explicit marker.

Automatic resource downloads deduplicate message/key pairs across parent messages
and expanded replies. Forwarded resources use the outer container message ID.
Each result records an artifact reference or a per-resource error; failure of one
attachment does not discard messages. Concise output is returned as an additional
Markdown string in the structured MCP result, preserving IDs and continuation
metadata alongside readable context.

Explicit page-delay is retained as a durable not-before timestamp between pages.
Resuming early returns another pending checkpoint without calling Lark. The cloud
default relies on the separate MCP resume round trip instead of sleeping inside
a Worker invocation. This preserves bounded execution and caller-selected delay.

Interactive card formatting is injected through a pure converter port. Read,
thread-reply, and merged-forward paths use the same pinned upstream converter.
The compiled converter has no credentials, network, or filesystem access. Its
output preserves raw-card attachments, component trees, and mention references.
A missing converter fails explicitly instead of returning an opaque card marker.

Sender-name resolution uses only names returned by message reads. A durable name
cache is shared across top-level records, replies, and forwarded children; it
never infers identity from mention labels or makes directory lookups.

Resource filename inference preserves every MIME mapping from the pinned CLI,
including Office documents, web images, archives, audio, and video formats.

Message search supports both user and bot identity, matching the pinned shortcut,
and advertises the dedicated search:message scope.

Date-only end bounds include the final second of that UTC day. Positive Unix
second strings pass through unchanged. Timezone-free timestamps use UTC in the
cloud; explicitly zoned timestamps preserve their instant.

Search treats an explicit page-limit as enabling pagination. Explicit page-all
without a limit permits forty pages; the first upstream notice is preserved.

Text, Markdown, and JSON message content accept `@artifact:<id>` (or `@<id>`)
as the cloud equivalent of file input. Input is decoded as UTF-8, limited to
2 MiB, and authorized against the current grant before sending. Preview reports
that content validation is deferred and performs no artifact or Lark reads.
CLI stdin input is represented by passing the content directly in MCP arguments.

Command metadata lists the union of the pinned user and bot scope requirements.
Identity-specific authorization remains enforced by the selected Lark credential;
bookmark inference advertises its chat and message read dependencies.

Native acceptance runs inside workerd with the real MCP protocol handler,
precompiled schemas, encrypted Durable Object SQLite, and private R2. Synthetic
Lark transports verify card reads, send/edit previews, read-only pagination,
media upload and attachment download without contacting real recipients.

Large read checkpoints and completed results spill to encrypted internal R2
artifacts under the shared 2 GB quota. Native acceptance retrieves sixty messages
with more than 1 MiB of content across pages using only read permission and no
artifact-domain consent, proving that the old 512 KiB SQLite state ceiling no
longer truncates or rejects ordinary large message reads.

## MCP compatibility aliases

The following additional argument names preserve existing MCP clients and CLI
aliases omitted from the canonical flag inventory: `message-id` for
messages-mget and messages-read-status; `limit` for chat-messages-list,
threads-messages-list, messages-search, message-read-users and chat-members-list;
`start-time`, `end-time`, `sort`, and `sort-order` for chat-messages-list;
`thread-id` and `sort` for threads-messages-list; and `keyword` for
messages-search. Conflicting canonical and alias values are rejected.
Messages-search additionally accepts `page-delay` as a cloud extension, enforcing
an explicit durable not-before timestamp between pages.
