# Wiki shortcut compatibility

The implementation targets lark-cli 1.0.97. It preserves member tuple semantics,
explicit notification flags, personal-library resolution, node URL normalization,
space assertions, pagination, and mutation result flattening. Preview validates
inputs without credentials or upstream calls.

List pagination runs as a durable workflow: each resume reads at most one page.
An explicit page token takes precedence over page-all. Page limits count pages,
not items; zero removes the logical page limit. Server cursors that repeat stop
pagination and return a warning. Mutating workflows checkpoint resource lookup,
write, and async task polling separately so a completed write is not repeated.

Acceptance uses synthetic upstream fixtures and checks complete request bodies,
paths, query parameters, transformation results, validation before I/O, and
workflow continuation. These tests do not claim a live Lark authorization check.

Node-get output projects the stable CLI fields, including creator fallback and UTC `updated_at`, and omits upstream URLs. Creation and copying include the canonical brand-specific Wiki URL. URL decoding failures and unsafe token segments are reported as argument errors before requests. Move-to-Drive polling requires an explicit numeric status; a missing status cannot be treated as a pending result.
