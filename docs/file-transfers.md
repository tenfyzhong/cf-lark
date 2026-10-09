# Cloud File Transfers

Cloud CLI paths refer to private artifacts rather than the Worker filesystem.
All transfer requests use the selected profile/account token and official Lark
or Feishu origin. JSON API calls, multipart uploads, and binary downloads share
one invocation request budget and the same redirect prohibition. External URLs
must never receive Lark tokens. Download bodies remain streams for R2 storage.

Multipart upload primitives accept named text fields and one Blob. Each part is
limited to 20 MiB, including a nonempty safe filename and media type. Larger
business files must use the upstream multipart preparation/part/finalization
workflow; they must not be buffered as a single Blob. Aggregate R2 storage
remains capped at 2,000,000,000 bytes. The multipart encoder chooses its own
boundary; callers cannot override Authorization or Content-Type headers.

Transfer failures distinguish rejected HTTP requests, API errors, and writes
whose outcome is unknown. No write is automatically retried. Preview must not
read an artifact, obtain a token, or contact upstream. Download errors are not
persisted as successful files. Ownership checks precede artifact access.

Acceptance includes binary round trips, UTF-8 multipart fields, exact upload
bytes, size bounds, rejection of redirects and invalid paths before credentials,
shared request-budget exhaustion, and network-failure classification. Domain
workflows require additional tests for endpoint fields, multipart state,
pagination, metadata, permissions, and final output. The transfer layer alone
never establishes shortcut compatibility.

## Artifact access

The OAuth-protected /mcp/artifacts endpoint accepts an exact Content-Length and
streams bytes to private R2. GET and DELETE /mcp/artifacts/{id} read or remove an
artifact belonging to the same OAuth grant. The artifact domain requires explicit
consent. Upload/delete require write access; reads require read access. Expiry,
revocation, storage quotas, and monthly operation budgets remain enforced.
Management artifacts and artifacts from other grants are inaccessible. Requests
never accept an owner identifier from the caller. No public bucket URL is issued.

MCP discovery will describe artifact transfer endpoints alongside business
commands. Small content may use an inline artifact command; larger content uses
the authenticated streaming endpoint. A file argument in cloud workflows is an
artifact ID, with a separate display filename where the upstream API needs it.

## Range reads and multipart workflows

Artifact metadata reads use the local ledger. File parts use bounded offset and
length reads from R2 after owner, expiry, ready-state, and range checks. Each
range read consumes one Class B operation. Ranges must be exact and wholly
inside the artifact; malformed ranges fail before R2 access. This permits large
files to be uploaded in bounded parts without repeatedly reading the full object.

## Drive and document media uploads

Drive upload preserves root/folder/wiki targeting, overwrite tokens, names,
remote metadata URL lookup, and best-effort bot permission grants. Document media
upload preserves parent type/node and optional drive routing metadata, including
Office Word token adaptation. Cloud file arguments are artifact IDs; an optional
name supplies the remote filename when the artifact ID is not suitable.

Files over 20 MiB use prepare, exact range-based part uploads, and finish. Each
resumption makes at most one upstream step, then persists progress. Reject
invalid server block sizes/counts before reading bytes. An upload never restarts
its prepare or finalize request after an uncertain outcome. Completed file
creation survives a later metadata or permission warning. Bot auto-grants use
only an unambiguous account authorized for the selected profile; missing or
ambiguous accounts produce an explicit skipped result, never an invented user.

Binary download requests may use GET or POST. POST downloads serialize the
explicit JSON body and retain the same selected-token, redirect, timeout, and
request-budget protections. An interrupted POST is an uncertain outcome and is
never retried automatically. Query encoding is explicit per parameter: JSON
(default), repeated keys, or comma-separated scalar values. This preserves APIs
such as message batch lookup without changing existing JSON-array parameters.

Upload limits follow the pinned endpoint: Drive parts are at most 20 MiB,
message images at most 5 MiB, message files at most 100 MiB, and task attachments
at most 50 MiB. Large multipart uploads stream an exact declared-length file
between encoded field/header and closing-boundary bytes. No 100 MiB Blob is
required. The transport validates filenames, field names, sizes and declared
length before and during transfer, and never retries an uncertain write.

## Unknown-length ingestion

Server-side downloads without Content-Length reserve their declared maximum
against the same aggregate quota before reading bytes. R2 multipart ingestion
buffers at most one 64 MiB part, streams that part, and records the actual total
only after multipart completion. At the 2 GB cap this uses no more than 32 parts,
plus creation and completion. Each billable R2 operation consumes the shared
monthly budget. Failed transfers attempt multipart abort and retain their quota
reservation until cleanup; success shrinks the reservation to actual bytes.

## Hosted upload filenames

`docs.+media-upload` accepts the optional hosted `name` flag as an explicit
filename override. Grant-owned artifact IDs are opaque and do not preserve a
client source basename; the override carries that filename to the upstream
multipart upload while retaining artifact ownership and size validation.

## Pinned upload branch acceptance

Drive upload preserves root, folder, Wiki, and overwrite destinations. New bot
uploads grant full access only to one unambiguous authorized user; overwrites
leave existing permissions unchanged. Metadata or permission follow-up failures
preserve the successful upload result. Ambiguous account selection never chooses
an arbitrary recipient.

Document media retains routing extras and the pinned local Office token rules:
only local Word tokens select `office_docx_file`; other document media retains its
requested parent type. Single-part and multipart paths share these fields.
Artifact ingress supports resumable private R2 uploads, including empty files,
under the aggregate 2 GB limit. Endpoint parts remain at most 20 MiB. The CLI's
local filename is represented by the artifact ID or an explicit `name` override.
