# Slides shortcuts

Slides locators accept bare tokens, Slides URLs and Wiki URLs. URL parsing uses the actual path, never a query parameter. Wiki references resolve through node_by_token and must identify a Slides object. All locator aliases from the pinned CLI are accepted, with conflicting values rejected.

History operations preserve page tokens, positive int64 version strings and explicit asynchronous status polling. XML reads distinguish whole presentations from one page, enforce mutually exclusive selectors and return the same structured projection as the CLI. Raw output returns XML text through MCP; an output name saves a new private artifact and requires artifact write permission.

Page mutations retain optimistic revision locking. Content writes request server-side lint unless no-lint is explicitly enabled. XML is validated before writes. A whole-page update rejects an ID from a different page, stamps a missing root ID, and removes stale direct-child speaker-note IDs without rewriting the remaining bytes. Local file inputs and image placeholders use grant-owned artifact IDs.

Multi-step creation and page replacement must checkpoint progress with the workflow runner before each effect. Unknown write outcomes must not be retried. Implemented commands and remaining branches are tracked separately from the complete pinned inventory.

## Checkpointed authoring

The Slides authoring workflow performs at most one Lark API request per resume. It validates all page XML and image artifact sizes before creating a deck. It creates the empty deck, resolves each unique image placeholder, adds pages in order, and attempts an unambiguous authorized-user permission grant for bot-created decks. Embedded `@artifact-id` images are limited to the CLI's 20 MiB Slides media limit. Artifact IDs replacing local XML files use the same grant namespace.

Batch page replacement checkpoints creation of each replacement before deleting the original and chains returned revision IDs. Explicit continue-on-error applies only to definite API rejections; uncertain transport outcomes stop without replay. Validation-only returns the plan without writes.

## Screenshot and media output

Screenshot render and list modes preserve selector aliases, deduplication, the ten-page limit and output conflicts. Base64 images are decoded into immutable artifacts with PNG/JPEG metadata. Media download tries the normal media route, falling back to source-preview type 16 only after a definite permission denial. Upstream transport failures do not trigger fallback. Both output operations require artifact write permission before any upstream call.

## Hosted schema aliases

The hosted schema deliberately exposes the presentation locator aliases used by
upstream argument normalization, including `presentation`, `presentation-id`,
`presentation-token`, `xml-presentation-id`, `slides`, and `url` where applicable.
These aliases resolve to one canonical presentation; conflicting values are
rejected. They are additive input conveniences rather than additional upstream
operations. Full-slide content aliases likewise normalize to one XML payload.
