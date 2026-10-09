# Native Markdown shortcut compatibility

Native Markdown uses Drive preview download type 16, not document export or the
Docx block API. All five pinned commands retain their input alternatives,
UTF-8 byte counts, name preservation, and source version semantics. Local file
flags refer to private artifact IDs; output names label newly allocated private
artifacts and never expose an arbitrary filesystem path. Inline content must be
nonempty. Large writes use the shared bounded multipart upload program.

Patch uses RE2 matching and Go-style replacement expansion. Literal replacement
is global; no matches return updated=false without an upload. Diff uses line
comparison, unified hunks with configurable context, and explicit no-newline
markers. Version strings remain strings to preserve 64-bit values. Diff inputs
retain the upstream 10 MiB per-side limit. Temporary source files live in the
same grant-owned private artifact storage and count toward the 2 GB limit.

Tests cover source-preview parameters, literal/regex replacement, no-match
writes, name preservation, version selection, and unified diff output. These
are fixture acceptance checks; live authorization is tested separately.

Fetch keeps at most 512 KiB of prefix data while deciding whether to return inline text. Larger source responses are streamed into private artifacts without a 32 MiB fetch ceiling. Patch processing remains bounded to 32 MiB and diff inputs to the upstream 10 MiB limit; these processing limits are distinct from the account-wide 2 GB artifact quota.
