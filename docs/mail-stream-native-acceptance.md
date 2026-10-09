# Native mail streaming acceptance

The native workerd acceptance test stages an 18 MiB private attachment in real R2, asks the pinned Go mail engine for a small MIME skeleton, and streams the resulting JSON through the real Lark HTTP client to a local transport fixture. The fixture incrementally decodes the outer base64url and MIME attachment, verifies SHA-256 and byte counts, and checks the 25 MiB raw EML limit. No complete attachment, EML, or JSON request is buffered by the test.

A second case stages a file whose MIME expansion exceeds 25 MiB. Exact size preflight must reject it before any upstream write. Artifact ownership and grant consent remain enforced. Passing in native workerd demonstrates execution under its configured runtime limits; this is not a heap measurement.
