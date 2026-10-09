# Durable workflow scheduling

A pending program step may return `nextRunAt`, an absolute Unix timestamp in milliseconds, or `retryAfter`, a nonnegative delay in milliseconds. The runner converts the delay into an absolute timestamp and persists it with the workflow checkpoint. Programs must not supply both fields. Missing timing fields make the next step immediately eligible.

Resuming before the timestamp returns the same pending workflow with `nextRunAt` and the remaining `retryAfter`. The runner rechecks grant ownership, permissions, execution selection, expiration and program version first, but does not acquire a new execution lease, construct an upstream client or call the program early. Once due, ordinary compare-and-swap execution and uncertain-outcome protections apply.

Scheduling uses no blocking sleep. It does not enqueue background execution: the caller resumes the workflow after the returned delay. The timestamp cannot extend the workflow or grant lifetime. Completed results remain replayable under the existing authorization checks, and old workflow records without a schedule remain immediately eligible.
