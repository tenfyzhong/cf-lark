# Note shortcuts

`note.+detail` returns normalized note metadata using the pinned CLI contract:
creator, creation time (UTC in the cloud runtime), normal/unified/unknown display type, main document token,
verbatim transcript token, and shared document tokens. Resource names reject
path traversal and control characters before either preview or execution.
Upstream permission code 121005 becomes an explicit note read-permission error.

`note.+transcript` requires a separate durable pagination and artifact workflow.
Its detail preflight must confirm a unified note. A repeated or missing cursor,
empty transcript, failed page, or more than 500 pages must fail without exposing
a partial transcript as complete. Local output paths map to grant-owned
private artifacts. All five pinned flags are covered: `note-id`,
`transcript-format`, `locale`, `output`, and `overwrite`. Markdown and plain-text
page contents are concatenated byte-for-byte, without inserting separators.
Permission code 121005 is mapped consistently for detail and transcript pages.
Successive page requests are scheduled at least 100 ms apart through the durable
workflow scheduler; no Worker sleep or long-running request is required.

## Durable transcript execution

The transcript program fetches at most one page per resume, checkpoints private
page artifacts, then streams groups of at most ten artifacts into a new artifact.
Each merge is checkpointed before deleting its inputs. The final result contains
one artifact ID, byte length, and authenticated download path. Intermediate
artifacts are never returned as a completed transcript and expire through the
normal cleanup path after a failure. Artifact read/write consent and the
workflow domain are required alongside note read consent.

The default locale follows the selected profile brand; explicit locale overrides
it. This service has no separate CLI profile-language setting, so an explicit
`locale` is the cloud equivalent of that preference. `output` supplies the returned relative filename. `overwrite` is accepted for
CLI compatibility; every result gets a fresh private artifact ID, so it cannot
overwrite another result. The aggregate 2 GB cap includes temporary merge inputs
and outputs and may reject a merge that lacks sufficient free capacity.
