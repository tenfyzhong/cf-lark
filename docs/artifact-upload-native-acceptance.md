# Native multipart artifact acceptance

The native suite exercises the public HTTP routes through the primary Worker and
its Authority Durable Object. It obtains real service OAuth grants using dynamic
registration, PKCE and management consent, then uploads a 65 MiB artifact as the
planned 64 MiB first part and 1 MiB final part to the private R2 binding.

Assertions cover the exact session plan, incomplete completion rejection,
accepted-part status, completion replay, persisted object length and contents,
owner-isolated access, and quota release on deletion or abort. Download bytes
are inspected incrementally; the test never constructs a 65 MiB payload buffer.
No Lark network operations or production Cloudflare resources are involved.

Single-range downloads support `bytes=start-end`, `bytes=start-`, and
`bytes=-suffix`. Successful partial responses include status 206, exact
Content-Length, Content-Range and Accept-Ranges. Invalid, multiple or
unsatisfiable ranges return 416 with `Content-Range: bytes */size`. Ownership and
read authorization are checked before exposing the size. Full downloads retain
their complete body. Conditional If-Range requests conservatively return the
complete representation instead of serving a potentially stale partial body.
