# Application Slash Commands

Port all four pinned application shortcuts: list, create, update, and delete.
Use the selected app token with /open-apis/application/v7/app_slash_commands.
List projects items plus count. Writes preserve upstream command_id and add the
created/updated/deleted action. Client-side command caches may take five minutes
to reflect changes; listing reports server state immediately.

Create requires a nonblank slash-free command name and description. Localized
descriptions are arrays of language=text pairs, split at the first equals sign;
blank or repeated languages are rejected. Icon remains a top-level field.
Update/delete accept exactly one ID or name. Name-based operations resolve a
unique exact match from the live list before writing. Updates require an editable
field, and localized descriptions require a default description because the
upstream PATCH replaces that object. ID path segments are trimmed and encoded.

A create collision is an error unless force is explicitly true. Only the known
name-collision error may trigger list-and-PATCH; other failures are never turned
into updates. Discovery describes force as an explicit upsert choice, never an
automatic repair. Delete is a write with irreversible effects; recreating the
name creates a different ID. Preview validates and describes conditional reads
without performing them.

Acceptance covers each operation, both target modes, i18n parsing and replacement,
encoded IDs, absent/ambiguous resolution, collision handling with and without
force, and rejection of unrelated failures before any fallback write.
