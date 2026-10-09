# Pure transformation resource boundary

The document and mail engines are private service bindings without credential,
artifact-bucket or public-route bindings. They accept an explicit allowlist of
pure transformation operations. Requests have a streaming 40 MiB envelope cap;
individual parsers and transformations apply smaller input and complexity limits.

JQ retains the pinned language. Its execution checks a synchronous deadline and
instruction budget, and caps the number of emitted results. These checks do not
make arbitrary expressions cheap: a single builtin can allocate a large string
or array before the next instruction checkpoint. Cloudflare CPU and memory hard
limits remain the final resource boundary. No automatic transform retry occurs
after engine failure, and a failed network-backed workflow must preserve its
existing uncertainty rules rather than repeating an upstream mutation.

The host caches one initialized Wasm runtime per engine instance. A Cloudflare
isolate termination causes the platform to reconstruct that instance. The adapter
does not silently restart and replay an expression after a fatal runtime error.
This review did not execute deliberate out-of-memory workloads.
