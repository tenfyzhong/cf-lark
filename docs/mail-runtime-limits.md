# Mail runtime limits

The hosted service implements all 31 pinned Mail shortcuts. Resource ceilings
are explicit adaptations to free Cloudflare Workers rather than missing flags.

- Final raw MIME: 25 MiB, matching the pinned builder.
- Regular attachment promotion: the pinned 25 MiB MIME estimate; oversized
  artifacts upload to Drive in bounded parts. Each large file is at most 3 GiB,
  subject to the configured private R2 quota (2 GB by default).
- Authored body files and retained MIME text/header skeletons: 8 MiB.
- Pure mail HTML complexity: UTF-8 text bytes plus 256 bytes per `<` must not
  exceed 8 MiB across the relevant authored fragments. Decoded existing draft
  HTML receives the same check before projection or editing.
- MIME leaf headers: 64 KiB; individual input MIME lines: 1 MiB.
- The private pure-engine JSON envelope remains bounded separately.

Attachment payloads bypass the Go heap. The Worker produces a small MIME
skeleton using the pinned builder, then streams artifact bytes through MIME
base64 and the outer base64url JSON request. Draft edits similarly partition
existing attachment payloads before invoking Go, and restore surviving parts
after the native edit. Missing markers mean a part was removed; duplicate
markers are rejected. Exact final MIME size is checked before upstream writes.

## Measured evidence

The opt-in reusable `test/mail-body-memory.test.ts` records Wasm linear-memory
high-water marks. These are not total Worker heap measurements.

| Transformation | Input | Wasm memory |
| --- | ---: | ---: |
| Plain-text MIME build | 1 MiB | 15 MiB |
| Plain-text MIME build | 4 MiB | 38 MiB |
| Plain-text MIME build | 8 MiB | 56 MiB |
| Text-heavy HTML lint | 1 MiB | 18.5 MiB |
| Text-heavy HTML lint | 4 MiB | 41.5 MiB |
| Text-heavy HTML lint | 8 MiB | 73.5 MiB |
| Repeated `<p>x</p>` lint | 128 KiB | 64.5 MiB |
| Repeated `<p>x</p>` lint | 256 KiB | 147.5 MiB |
| Repeated `<p>x</p>` lint | 512 KiB | 293 MiB |

The dense cases demonstrate why a byte-only limit is insufficient. The combined
budget rejects the measured 256 KiB failure shape before Go DOM construction.
The baseline probe deliberately bypasses the production adapter guard to make
memory growth observable; normal requests always use the guard.

`test/runtime/mail-stream.test.ts` verifies an 18 MiB binary fixture through
native R2, the actual MIME engine, and authenticated streamed HTTP JSON using an
incremental SHA-256 comparison. Its 19 MiB fixture is rejected by the 25 MiB final
MIME limit before a remote write. Native runtime fixtures use local transports
and do not send real email.
