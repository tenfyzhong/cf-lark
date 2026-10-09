# Durable Workflow Execution

Multi-step business operations use grant-owned execution records. A record binds
the initiating command, profile, account, identity, input, current step, and result.
The initiating grant must still authorize that original operation whenever a
client resumes it. A workflow ID is not an authorization capability by itself.
Each invocation advances a bounded step and returns either completed output or
an explicit pending status and workflow ID. Clients must not repeat the initial
write to continue a pending workflow.

Before invoking a step, persist a running state. Concurrent resumes cannot run
the same step twice. Success checkpoints the next state or final result; a
completed workflow returns its stored result without repeating requests. A
failed or interrupted write is never automatically replayed. Records left
running after interruption are explicitly uncertain and require reconciliation.
Store private workflow payloads encrypted at rest, without OAuth or Lark tokens.
Expire transient records after 24 hours and prune through the existing alarm.

The application runner depends on workflow and storage ports. Domain programs
own their API request sequences. The composition root registers programs and
constructs an upstream client for the record's stored, reauthorized selection.
No capability imports application or Cloudflare storage implementation details.

Acceptance covers cross-grant access, narrowed or revoked grants, original
identity enforcement, concurrent resume exclusion, bounded advancement,
completion replay without side effects, crash/uncertain states, cleanup, and
production-runtime encryption/storage integration. Individual command coverage
still requires its own domain workflow fixtures.
