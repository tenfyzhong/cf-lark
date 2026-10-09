# Shared media routing

Media upload workflows accept a JSON object in `extra` for upstream routing metadata, including Base form share tokens. A domain-specific factory overrides the workflow ID and domain without duplicating transfer logic. Document route tokens merge into this object. Invalid metadata fails before artifact reads.

Unknown-length downloads reserve the smaller of their declared maximum and the remaining aggregate storage capacity in one SQL statement. The stream is limited to that reservation, which shrinks only after a confirmed upload. Concurrent reservations cannot exceed the configured cap.

Import staging uses `ccm_import_open` with an empty parent node. Single-part requests omit that field; multipart preparation retains the empty field to match the pinned CLI. Other media parents must remain nonempty.

Authenticated streamed JSON writes support MIME draft payloads without materializing base64 JSON. The transport bounds bodies to 64 MiB and optionally verifies an exact declared byte length. It never follows redirects or retries writes. A stream failure after dispatch produces an uncertain outcome, retaining the original workflow for reconciliation.
