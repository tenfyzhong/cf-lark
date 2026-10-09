# Upstream WebAssembly Feasibility

This is an experiment, not an executable compatibility claim. The production
service currently uses TypeScript capability handlers.

Cloudflare's current [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
allow a 64 MiB uncompressed bundle. An optional build probe checks whether the
pinned upstream CLI can fit this limit using a headless JavaScript/Wasm target.
The upstream checkout and Go module cache must remain unchanged; temporary Go
overlays adapt unavailable clipboard, terminal and filesystem-lock primitives.
These adaptations cover local platform facilities, not business API behavior.

Before such an adapter could ship, it would need isolated virtual filesystems,
strict outbound request mediation, credential injection, cancellation, startup
and memory measurements, and full workflow fixtures. A successful compilation
alone is insufficient. The existing coverage manifest remains authoritative.

Run the reusable probe with `LARK_CLI_SOURCE=/path/to/pinned/source pnpm exec
vitest run test/wasm-feasibility.test.ts`. Normal tests skip this optional probe.

## Experiment result (2026-10-09)

The adapted Go build compiled, but the unoptimized artifact was 85,853,727 bytes,
exceeding the 67,108,864-byte Worker limit. The Binaryen JavaScript optimizer
exceeded a 300-second deadline without producing an accepted artifact. Therefore
this route is not a deployable implementation and the opt-in probe currently
fails. No Wasm code is included in the preview Worker.
