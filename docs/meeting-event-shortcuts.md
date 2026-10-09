# Meeting, Minutes, and event shortcut parity

The implementation follows lark-cli 1.0.97 at commit
`72579c80027c863ca51d5f9affda72a70ab0d8a6`. Meeting controls preserve
identity restrictions, conditional inputs, request bodies, and result transforms.
Minutes editing preserves explicit false values, batch operation order, partial
replacement outcomes, and permission errors. No write is retried automatically.

Long reads use resumable workflows with one bounded upstream step per resume.
Local output paths become names on private, grant-owned artifacts. Screenshots
must be JPEG responses within the upstream eight MiB limit. Streaming event
consumption becomes cursor-based reads from the configured callback inbox;
a caller must retain the returned cursor and poll. No permanent socket or local
background process is started in the free Worker runtime.

Every command validates before both preview and execution. Preview does not
request credentials, call Lark, create artifacts, or mutate subscriptions.
Implementation status is recorded per command with reusable test evidence;
unimplemented branches are not counted as complete parity.

## Public composition

`vc/index.ts` exports `allVCDefinitions`,
`allVCCapabilities(workflows, artifacts)`, and `vcPrograms(artifacts)`.
`minutes/index.ts` exports `allMinutesDefinitions`,
`allMinutesCapabilities(workflows)`, and `minutesPrograms(artifacts, remoteFiles)`.
The event adapter exports `eventSubscribeCapability(inbox, artifacts)` and
`eventSubscribeDefinition`. Static definitions and runtime handlers must both
be added to the central catalog; programs must be registered with the runner.

## Cloud contracts

- Calendar and Minutes date-only inputs use UTC. Include an explicit offset for
  a different timezone. Results use ISO timestamps rather than local terminal
  formatting.
- `output`, `output-dir`, and `overwrite` preserve naming intent, while immutable
  artifact IDs replace local filesystem paths. Existing local files do not exist
  in a Worker. A fresh download or screenshot produces a fresh artifact.
- Screenshot responses are limited to eight MiB. Strict JPEG decoding is bounded
  to 16 megapixels and 48 MiB decoder memory to fit the free Worker memory budget.
- Media downloads use a separate unauthenticated HTTP port, never the Lark API
  transport. Unknown-length downloads reserve storage through streaming ingest.
  Presigned URLs are retained only in encrypted workflow state until consumed.
- `wait-ready` never sleeps in a Worker. The checkpoint contains `nextPoll` and
  the workflow can be resumed later; early resumes perform no upstream request.
- The event adapter reads authenticated callbacks already configured by the
  administrator. It does not edit application event permissions or start an
  upstream socket. Returned cursors advance across filtered-out events, so a
  caller must keep separate cursors for distinct filters. Route matches create
  private JSON artifacts for every matching directory name. Stop polling to
  stop consumption; `force` does not create competing subscriptions.
- Event matching uses RE2JS rather than the backtracking JavaScript regex engine.
  Callback verification tokens are removed from raw and compact results.

## Remaining fidelity checks

The event adapter's received-message compact conversion uses the canonical IM
formatter. Interactive cards retain their raw envelopes, while merged forwards
use the pinned no-network event fallback. Current
`event consume <EventKey>` catalog pre-subscription workflows are separate from
the pinned legacy `event.+subscribe` shortcut and are not claimed by this adapter.
The runtime tests in this module use deterministic upstream fixtures; live Dots
and real Lark acceptance are separate integration checks.

The hosted legacy subscriber adds `cursor` and `limit` to bound durable inbox polls.
Minutes search accepts `keyword` as an alias of the pinned `query` flag. These
additions do not replace or remove upstream flags.
