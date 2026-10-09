# Unauthenticated remote file transfers

Remote file URLs use a separate injected `RemoteFiles` port. They never receive
Lark Authorization headers, admin credentials, cookies, or MCP tokens. The
adapter accepts public HTTP(S) hostnames on their standard ports, rejects URL
credentials, local hostnames and IP literals, validates each manual GET redirect,
and limits redirects, elapsed time, and streamed bytes. Signed query strings
remain opaque and are not included in errors.

`stream` preserves successful response metadata and enforces a caller-supplied
limit up to the service's 2 GB maximum. `read` buffers at most 32 MiB for small
images or text. Larger resources must use streams and artifact staging. Missing
Content-Length remains explicit for the artifact ingestion layer.

Presigned PUT uploads require an exact length, optional Content-Type and safe
Content-Disposition, and return the response ETag. PUT redirects and automatic
retries are prohibited because their outcomes may be uncertain. No caller can
supply authentication headers through this port. Cloudflare's public outbound
fetch path is used; private network bindings are not configured.
