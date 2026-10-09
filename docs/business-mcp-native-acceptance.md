# Business command MCP acceptance

Native workerd tests exercise the reported document creation and monthly task lookup scenarios through the MCP HTTP handler, compiled argument schemas, automatic profile/account selection, and encrypted Durable Object workflow checkpoints. Lark responses are local fixtures; these tests never create a real document or contact a recipient.

Document creation previews must perform no upstream requests. Execution sends one asynchronous create request, resumes its task through a separate MCP call, and returns the resulting document URL. Task lookup uses a read-only grant, follows pagination, applies inclusive monthly due-date filters, and exposes completion state. Neither scenario supplies a profile identifier: the single authorized profile and account must be selected automatically.

Asynchronous polling uses a fixture-owned virtual workflow clock. Acceptance attempts a premature resume, verifies that the durable retry deadline is unchanged, and advances only by the returned delay before polling again. This avoids real sleeps while proving that a pending document create is neither busy-polled nor repeated.
