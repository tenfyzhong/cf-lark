# OKR shortcuts

The OKR adapter targets all 22 shortcuts in lark-cli 1.0.97. It distinguishes
v1 progress record rich text from v2 objective, key result, and comment content.
Simple content preserves paragraph breaks, ordered mention references, and image
references. Numeric IDs are positive signed 64-bit strings to avoid precision loss.

Single-page list commands retain upstream pagination. Complete cycle details,
reorder, weight normalization, nested comment discovery, and batch creation use
durable workflows with at most one upstream request per resume. Batch creation
tracks created objectives and rolls them back in reverse order after a definite
upstream failure; uncertain writes stop without replay or destructive guesswork.

Local JSON files and stdin become inline JSON values; image paths become private,
grant-owned artifact IDs with explicit filenames. Output is structured JSON and
timestamps use UTC in the hosted runtime. No tests send real account writes.

Acceptance includes every registered flag, exact upstream requests and output
projections, content conversion, pagination and fanout, failure handling,
no-network previews, and production-runtime schema validation.

The optional `name` upload flag preserves the original file extension and multipart filename when the private artifact ID is opaque.

The hosted `okr.+upload-image` transport ceiling is 20 MiB. This is an explicit Cloudflare resource limit; the pinned CLI does not declare an image-size cap. The shortcut workflow and all registered flags are implemented within this ceiling.
