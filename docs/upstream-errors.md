# Upstream error classification

The transport returns stable closed reason codes without exposing upstream messages. Known member-type incompatibility requires upstream code 2. Read tool timeout and data-not-ready errors are classified for bounded read retries. Database lock contention requires both the documented lock code and the lock-held message; callers still decide whether retry is safe. Network write failures remain uncertain and are never automatically retried.

The internal transport accepts validated raw JSON bodies for numeric lexeme preservation. Structured and raw bodies are mutually exclusive. Validation parses the text only to reject invalid JSON; it sends the original text unchanged.

Callers can explicitly request full response envelopes when pagination lives beside data or an endpoint returns arrays. The default remains data unwrapping. Upstream error classification applies in either mode.
