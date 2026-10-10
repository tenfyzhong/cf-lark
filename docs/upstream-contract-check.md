# Pinned upstream contract check

## Acceptance contract

Keep the original generated v1.0.97 inventory baseline separate from the audited
upstream revision `9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d`. An offline fixture
pins the compiled typed API schema digest, registered shortcut IDs, and hashes
of upstream catalog, registration, Base, OAuth, and error-classification sources.
Unit tests must fail on schema or business shortcut inventory drift. A read-only
source check must reject a different revision, changed source bytes, or compiled
schemas differing from the checked-in hosted descriptors. It must not execute
upstream code, access credentials, or contact Lark.

Behavior tests remain necessary: schema and source hashes cannot establish
behavior equivalence. Base reads, OAuth/DPoP, diagnostics, and MCP guidance have
separate fixture tests. Real MCP clients, real tenant permissions, callback
configuration, and production deployment remain separate acceptance layers.

## Running the checks

`pnpm test` includes the offline schema digest and business inventory guard.
For source verification, check out the exact revision above, then run
`pnpm check:upstream /path/to/lark-cli`. This reads the checkout and compiles
its JSON catalog in-process; it needs no Go compiler or network access. The
checkout must include the original inventory baseline commit so the source delta
can be checked for shortcut identity changes. This is a conservative static
identity check, not execution of the upstream shortcut exporter.
It rejects an unreviewed revision or any changed pinned source.

When upgrading upstream, review source and schema deltas, update behavioral
fixtures, rerun the full checks, and deliberately regenerate the pin. Do not
replace the digest just to silence a failure. The pinned Go sources contain
independent protocol changes; a matching hash does not mean every feature of
those files has a hosted implementation.
