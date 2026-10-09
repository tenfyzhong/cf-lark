# Contact shortcuts

The contact adapter follows the pinned CLI's identity-specific request routing.
`contact.+get-user` resolves the current user when no ID is supplied. Bot callers
must supply a user ID. An explicit user ID uses the basic batch endpoint for user
identity and the full profile endpoint for bot identity. Both return a `user`
object, including an empty object when the upstream batch contains no users.

Previews receive the authorized selection and grant without an upstream client.
They perform the same identity-dependent validation and describe the exact
request without fetching credentials or making network calls.

Contact search uses separate handlers for user and bot result contracts, with
regression coverage for filtering, fanout, and partial-result behavior.

## User search contract

`contact.+search-user` supports keyword, open ID, current-user alias, true-only
filters, and up to 20 deduplicated keywords. Each keyword returns one page of up
to 30 users. `has_more` and notices remain visible; no implicit pagination hides
truncation. Fanout preserves input order and per-query failures. Concurrency is
bounded to five requests, and an entirely failed batch propagates its first
error. The `me` alias resolves through the selected user token and is represented
symbolically in previews.

Names use the selected application's brand and explicit language override.
Projection preserves activation, cross-tenant status, chat ID, department,
signature, highlights, and recency hints. The service returns JSON rather than
terminal-specific table formatting.

## Bot search contract

`contact.+search-bot` requires a keyword or keywords; filters alone cannot
enumerate bots. Chat IDs accept supported chat URLs and are normalized before
deduplication and the 100-ID cap. False boolean filters are rejected. Results
preserve agent status, tenant, group-join capability, highlighted segments,
notice, and truncation. HTML entities are decoded with the BSD-licensed
[`entities`](https://github.com/fb55/entities) library.

Bot fanout uses the same five-request concurrency limit. Upstream/network errors
may yield partial results; authorization, internal, cancellation, and other
terminal errors invalidate the entire batch.
