# Resumable private artifact uploads

Large files enter the service through a multipart upload session so every HTTP body stays below Cloudflare's request-size ceiling. Sessions belong to the exact MCP grant that created them and require the artifact domain. Reads require read permission; creation, parts, completion and abort require write permission. Expired and cross-grant sessions are unavailable before bucket access.

1. `POST /mcp/artifacts/uploads` with JSON `{ "size": 150000000 }` reserves the entire declared size against the shared temporary storage cap and creates a private multipart upload. The response includes `id`, `partSize`, `partCount`, `size`, `expiresAt` and `status`.
2. Upload parts in order with `PUT /mcp/artifacts/uploads/{id}/parts/{partNumber}`. Part numbers start at one. Each request requires an exact `Content-Length`; all non-final parts are exactly 64 MiB and the final part contains the remainder. The service counts streamed bytes and rejects short or oversized parts.
3. `GET /mcp/artifacts/uploads/{id}` reports accepted parts and current state. Accepted parts cannot be replaced. Retrying an already accepted part returns its stored receipt without another bucket mutation.
4. `POST /mcp/artifacts/uploads/{id}/complete` finishes only when every expected part is recorded. The resulting artifact ID equals the session ID and can be supplied to file-capable commands.
5. `DELETE /mcp/artifacts/uploads/{id}` aborts the session and removes any completed object before releasing the reservation. Aborting a completed session also deletes its artifact.

A compare-and-swap transition claims each external write before it begins. Concurrent part writes or completion attempts cannot execute twice. An interrupted part stays uncertain and requires aborting the session; it is never silently replayed. An interrupted completion can be reconciled by checking the private object's exact size, without submitting completion again. Unknown multipart creation outcomes retain their reservation because an untracked upload cannot be confirmed aborted.

Known multipart uploads are tracked by the existing artifact ledger and expire through normal cleanup. Successful completion clears multipart tracking. Session metadata retains only bounded part receipts and shares the artifact TTL; cleanup removes metadata after the artifact reservation has been removed. Failed cleanup never releases reserved bytes. Each create, part and complete operation consumes the shared monthly Class A budget; completion reconciliation consumes Class B. Abort/delete cleanup remains possible after operation budget exhaustion.

The total file size is at most 2,000,000,000 bytes and must fit the configured shared temporary storage budget. Files are private, immutable artifacts after completion. Upload sessions do not accept a client-supplied R2 upload identifier or ETag.

Ordinary artifact upload and download ingestion also support zero-byte files, such as an empty Markdown document. An empty streamed download uses a single empty R2 object, never an empty multipart completion. Resumable sessions remain positive-size only because empty artifacts do not need chunking. Lark upload endpoint size restrictions are independent of artifact storage.
