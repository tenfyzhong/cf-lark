# Authorization diagnostics and safe upstream errors

## Behavior and interfaces

`lark_auth_diagnose` is a read-only MCP entrypoint. It accepts the execution
identity, optional authorized profile/account IDs, and an optional command ID.
It checks the current grant before reading local credential metadata. Existing
execution errors retain their codes and messages while adding safe distinctions
for expired/revoked grants and identity/domain/read/write denial. It does not
create an upstream client, decrypt a secret, refresh a token, or call Lark.

The result separates grant identity/domain/read-write permissions, locally stored
user-token scopes, token expiry/binding, and application scopes. Unverified
application scopes remain `unknown`. Command scope metadata is advisory: success
in local checks does not establish resource access or an upstream authorization.
No diagnostic includes account names, unselected accounts, credentials, or keys.
A denied command reveals only its public catalog requirements and grant checks.

Upstream failures retain `UPSTREAM_ERROR` / `UPSTREAM_HTTP_ERROR` and their numeric
`upstreamCode` / `upstreamStatus` for existing callers. Allowlisted error codes add
`type`, `subtype`, `retryable`, and a fixed `troubleshooter`. Strictly validated
correlation IDs may appear as `log_id`; bounded seconds from Retry-After may appear
as `retry_after_seconds` (`retry_after` is a compatibility alias). Raw messages, unknown error strings, URLs, arbitrary error
objects, authorization headers, request bodies and credentials are never echoed.
Scope failures expose `scope_details: "unavailable"`; untrusted upstream scope strings
are deliberately omitted. The local diagnostic compares only trusted catalog
scope names, and does not treat alternatives as a definitive authorization failure.
Known legacy workflow reasons are retained without echoing the triggering text.

A retry hint permits a later safe read, not an automatic replay. Writes always
have `retryable: false`; a transport failure remains `OUTCOME_UNCERTAIN`, and the
client never automatically retries any request. Users must check the write's
outcome before deciding whether to repeat it.

## Acceptance criteria (recorded before implementation)

- Grant revocation/expiry and unauthorized profile/account/identity fail before
  any metadata read. Other stored accounts are never returned.
- A permitted identity can diagnose a command's domain or write denial without
  executing it; argument-dependent risk is explicitly unknown without arguments.
- Missing user scopes, expired credentials and absent credentials are distinct.
  Unknown application-scope facts never become verified success or failure.
- The normal MCP tool list includes the diagnostic tool with read-only hints;
  its native runtime invocation needs no upstream traffic.
- Codes 99991672, 99991676, 99991679 and 99991677 respectively distinguish app
  scope, token permission, user scope and expiry failures. Invalid-token codes
  remain distinct from expiry and HTTP 403 alone does not prove a scope problem.
- HTTP/body rate limiting yields bounded retry metadata. Unsafe log IDs, URLs,
  messages, scope text and malformed codes are absent from serialized failures.
- JSON requests, streaming writes, multipart uploads and JSON download errors
  use the same classifier; existing workflow reasons remain compatible.
- Mocked unit and Worker-runtime tests demonstrate these guarantees. This work
  makes no live Lark calls and does not claim live provider verification.

## Source reference

Numeric classifications follow the official Lark CLI's generic error constants:
https://github.com/larksuite/cli/blob/main/internal/output/lark_errors.go
and the provider's generic error documentation:
https://open.feishu.cn/document/server-docs/api-call-guide/generic-error-code

## Verification

Test-first evidence:

- `test/upstream-diagnostics.test.ts`: 15 expected assertions failed before the
  classifier; four malformed-JSON-shape tests failed before the shape guard.
- `test/auth-diagnostics.test.ts`: the new diagnostic module was absent at the
  first run; 12 behavioral tests pass after implementation.
- `test/http-authorization.test.ts`: all three request-level proof tests failed
  before header integration and pass afterward.
- Six negative legacy-reason tests and three classifier-to-workflow tests
  reproduced the HTTP-error retry/fallback regression before the gate fix.
  Only successful HTTP envelopes with a valid nonzero API code retain legacy
  reasons. HTTP 429/503 messages cannot trigger an audit POST replay or a
  force-create PATCH fallback.
- Seven additive grant-denial tests failed before implementation and pass with
  existing codes/messages preserved.
- The final focused unit/SDK run passes 103 tests across nine files. Architecture
  validation passed with no dependency violations; the parent performs final
  aggregate validation after all concurrent changes.
- Focused unit coverage also includes existing upstream-reason, transport,
  multipart, download, streaming-write, dispatcher and MCP SDK tests.
- `test/runtime/auth-diagnostics.test.ts` provides native Worker/MCP fixtures for
  grant-safe local diagnosis and serialized rate-limit errors. The parent task
  runs native-runtime and aggregate checks serially.

All provider calls in these tests are mocked. No credentials were inspected and
no Lark account, deployment, or production behavior was changed.
