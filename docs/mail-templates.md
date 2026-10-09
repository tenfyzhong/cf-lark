# Mail templates

The template create and update shortcuts follow lark-cli v1.0.97. Definitions
remain in the Mail registry; a separate template program owns validation,
read-modify-write semantics, HTML and address preparation, attachment upload
checkpoints, and final API payloads.

Update first reads the current template and preserves unchanged fields. Empty
recipient flags clear a list. Patch-file fields apply after flat flags and can
clear content or subject. Inspect returns the fetched template without mutation;
print-patch-template returns a local skeleton without requiring a template ID.
Updates replace the complete template and have last-write-wins concurrency.

Plain content is escaped and wrapped with HTML line breaks for preview, even
when plain-text mode is selected. Content is bounded to 3 MiB. Inline CID
references must be unique and resolvable; content changes prune obsolete inline
attachments while retaining normal attachments. Stored attachment keys populate
both id and body when updating a fetched template.

Filesystem flags use owner-scoped private artifacts. Local HTML image references
are artifact IDs; upload order is discovered images, explicit inline entries,
then normal attachments. Each upload and final template mutation is checkpointed.
Inline entries remain SMALL; non-inline entries switch permanently to LARGE when
the projected MIME size reaches 25 MiB or raw body plus SMALL files exceeds 25
MiB. The shared Mail upload program enforces attachment size and identity rules.
