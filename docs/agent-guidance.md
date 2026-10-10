# Versioned agent discovery

## Behavior and interfaces

The hosted MCP endpoint keeps command search, schema inspection, and execution
separate. It also exposes read-only JSON resources under `cf-lark://guidance/v1/`:

- `index`: version, grant-visible domain skills, references, and discovery steps.
- `skills/{domain}`: a bounded preview of actually registered, grant-visible
  command affordances, plus the domain search needed to obtain every command.
- `references/workflows`: continuation, exact execution selection, scheduling,
  replay, lifetime, and uncertain-outcome rules.
- `references/artifacts`: private file inputs/outputs, streaming HTTP routes,
  upload sessions, ownership, permissions, and size limits.
- `references/watches`: callback configuration, bounded cursor polling, lifecycle
  commands, and the distinction between a consumer and a pending workflow.
- `references/limits`: documented numeric hosted resource ceilings and defaults;
  configured deployment quota and endpoint-specific limits can be smaller.

The index and limits are general reference material. Domain skills and other
references are listed only when their registered commands are visible to the
current grant. Resource reads recheck that same visibility. Resources never read
credentials, create upstream clients, invoke commands, or change authorization.
English documentation is persisted; multilingual query aliases use Unicode escape
sequences in repository source. Reference version 1 describes the hosted contract,
not an assertion of complete CLI or live-tenant parity.

Search and schema results link the versioned index and their relevant skill and
references. Schemas expose a machine-readable affordance: argument convention,
required schema inspection, preview availability, read/write risk, applicable
references, and bounded-continuation guidance. Registry metadata determines these
hints; descriptions or user query content never grant authority. Exact JSON Schema,
current authorization, and execution validation remain authoritative. A command
may have additional dependencies on another domain; discovery does not confer
those permissions.

Search accepts English keywords, curated synonyms, and common Chinese task/domain
phrases, including adjacent action/domain words and mixed-language input. Domain
filter aliases normalize to canonical domains. All query terms must match; unknown
terms are retained rather than ignored. Search remains a deterministic filter in
registration order with its existing cursor/limit semantics. Alias expansion runs
only inside discovery, never command execution or authorization.

## Acceptance criteria (before implementation)

1. Reusable tests first fail for multilingual/synonym search, including adjacent
   phrases, unknown terms, English compatibility, and domain aliases.
2. Search/schema offer stable versioned guidance links. MCP SDK clients can list
   and read the index, domain skills, and relevant references without new tools.
3. Restricted grants never list or read denied domain skills or denied command
   summaries; revoked/expired grants cannot read resource content. Read-only and
   identity-restricted grants preserve existing catalog filtering.
4. Workflow guidance includes `workflow.resume`, returned selection,
   `nextRunAt`/`retryAfter` milliseconds, completed replay, and no automatic restart
   after `OUTCOME_UNCERTAIN`.
5. File guidance includes the 512 KiB inline ceiling, exact-length streaming,
   ordered 64 MiB upload parts, private grant ownership, and shared default quota.
6. Watch guidance includes callback prerequisites, bounded cursor reads,
   explicit stop operations, and no claim of a persistent MCP socket listener.
7. References expose actual resource limits with units and scope, distinguish
   defaults from hard guards, and never silently imply unlimited local behavior.
8. Tests prove guidance and searches make no upstream calls and cannot authorize
   a write through content, alias expansion, or a resource read. Repository
   additions contain no literal Chinese characters.

## Verification boundary

Unit and SDK transport tests use fixtures and local in-process transports. They
are reusable acceptance evidence for discovery and grant behavior only. They do
not constitute live Lark, deployed Worker, or production agent acceptance.

## Reusable verification evidence

- `test/command-search.test.ts`: the pre-change run failed nine alias/domain cases
  and passed the compatibility case; the implementation passes all ten cases.
- `test/agent-guidance.test.ts`: eight initial failures demonstrated absent
  links, affordances, resource methods, and SDK resource support. Ten final tests
  cover these paths plus bounded previews, pagination, mixed-risk hints, revoked
  grants, and write denial after discovery.
- `test/dispatcher.test.ts` and `test/mcp.test.ts` remain regression coverage for
  execution, preview isolation, authorization, and existing MCP tools.
- `test/runtime/agent-guidance.test.ts` passes two native Worker tests against the
  actual capability registry and MCP transport. Dependencies are fail-on-call
  fixtures, proving these discovery paths do not contact Lark or read files.

The focused unit/SDK run passes 31 tests; the separate native discovery run passes
both tests. Type checking and architecture checks are separate whole-tree gates.
This evidence establishes the version 1 hosted discovery contract only. Chinese
support is a curated alias vocabulary, not arbitrary natural-language translation.
The original full compatibility inventory and outstanding live-acceptance limits
remain authoritative.
