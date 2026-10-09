# Whiteboard shortcuts

The pinned CLI's update, export, legacy query and docs update alias are implemented as dedicated operations. Update accepts raw node envelopes or PlantUML, Mermaid and SVG source, validates idempotency tokens, and preserves overwrite semantics. Export validates response shapes, decodes SVG, and extracts exactly one supported syntax block.

Cloud output paths are artifact names, not filesystem paths. Every saved export creates a new grant-owned immutable artifact; overwrite cannot overwrite another grant's data. Saving requires artifact write permission. Preview images require PNG or JPEG media types. Downloads stream through the shared artifact transport, including unknown-length ingestion when available, and retain the aggregate reservation limit.

Previews validate and describe requests without network or artifact access. No writes are retried automatically.

Update `source` accepts inline content or a grant-owned `@artifact-id` input.
Preview reports deferred hydration without reading the artifact. Execution checks
artifact read authorization before loading at most 20,000,000 bytes of source.
