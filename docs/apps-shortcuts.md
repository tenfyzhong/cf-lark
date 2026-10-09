# Apps shortcut parity

The Apps adapter targets lark-cli 1.0.97 commit `72579c80027c863ca51d5f9affda72a70ab0d8a6` and the same-origin Spark API under `/open-apis/spark/v1`. Apps shortcuts use the selected user identity and require `spark:app:read` or `spark:app:write`.

Implementation proceeds by behavior, including flag normalization, validation, request composition, response projection, and secret redaction. A command is only marked implemented after its executable tests pass. Unimplemented commands remain pending in the Apps status manifest.

## App, cache, and environment contracts

App listing defaults to 20 results, preserves cursors, trims optional filters, and removes `icon_url` and `created_at` from items. App creation trims names and optional fields. Updating requires a nonblank name or description. App IDs are encoded as single path segments.

Cache calls omit the environment when absent so the upstream service selects the correct branch. Cache values remain strings; byte sizes use UTF-8, and numeric metadata is normalized to numbers or null. Clearing a cache is a destructive mutation and requires explicit `yes: true`.

Environment listing defaults to `dev`, uses scene 2, and hides values unless explicitly requested. Setting values never returns or previews the secret value; changing the online environment requires `yes: true`. Environment deletion deduplicates keys and requires explicit confirmation. Environment keys must match `[A-Za-z_][A-Za-z0-9_]*`.

## Cloud boundaries

Local terminal formatting and process management are not cloud business functionality. Local project initialization, dependency installation, Git credential helper registration, and edits to local node_modules cannot execute inside a free Cloudflare Worker. Remote app creation, publishing, sessions, files, database operations, and access management remain business functionality and are not excluded merely because their CLI implementations also use local files. File inputs must become grant-owned artifacts, and polling must become bounded resumable workflows.

## Open API keys

Key list/get/update/enable/disable responses remove raw secrets and return a four-character suffix preview. Only create/reset return the newly issued secret, once, without storage. Reset and delete require explicit confirmation. Scope inputs allow either raw JSON or friendly route flags, never both; only documented HTTP methods, paths, and object fields are accepted. Explicit `allow-preview: false` is preserved.

## Cloud generation sessions and releases

Session creation, single-page listing, status, reply-message paging, interruption, and chat retain their upstream asynchronous contracts. Chat queues one message exactly once and returns immediately; clients poll session status using the upstream `next_poll_after_ms`. Session/turn IDs are explicit and encoded. No synthetic completion is returned.

Release creation returns only `release_id`, `status`, and `sync`. The release detail adapter merges outer error logs and approval context over nested release data and normalizes documented camel-case aliases without deleting unknown fields. Release reasons preserve whitespace after nonblank validation and reject control/dangerous Unicode characters and more than 1000 characters.

## Database metadata and sync controls

Database table listings project column counts and metadata instead of returning full column arrays. Table details retain upstream structure. Database quota output omits unknown/unconfigured quotas. Audit status falls back to a disabled status for an explicitly requested unconfigured table. Sync lookup/list and enable/disable/delete retain upstream semantics, and delete requires explicit confirmation. Legacy `env` is rejected in favor of `environment`. Database environment creation only accepts `dev`, sends `sync_data`, and requires explicit confirmation.

## Collaborators

Collaborator management requires a real `app_` identifier and typed external IDs (`ou_`, `oc_`, `od-`). Requests send exactly one typed identity field, with explicit permissions for additions and updates. Responses are projected through strict typed validation and never expose internal IDs or metadata tokens. Settings writes include only explicitly supplied writable fields. Settings responses reject unknown enum values while allowing absent optional fields.

## App storage metadata

Storage operations require an `app_` ID. List/get translate `created_at` and the encoded `created_by` object to uploaded metadata, retaining only documented fields. Signed URL creation enforces the 30-day ceiling. Batch deletion preserves each input path and its individual outcome. Relative time filters use the current UTC clock; date-only and timezone-free timestamps use UTC in this cloud service, while explicit offsets are preserved during conversion to UTC.

## Access scopes and identity conversion

Access scope inputs map `public`, `tenant`, and `specific` to upstream `All`, `Tenant`, and `Range`. Public access requires an explicit `require-login` boolean. Specific access splits typed targets into separate user, department, and chat arrays, and validates dependent approval options. Identity conversion supports both user and bot identities, preserves duplicate input positions, and reports unresolved positions in `missed` rather than silently dropping them.

## Automation

Trigger conditions are validated by family. Cron schedules enforce the upstream 30-minute minimum including wraparound gaps. Record events and approval statuses use explicit allowlists. Ordinary responses redact webhook bearer tokens; only explicit token issuance actions may return them. Update actions are mutually exclusive with condition updates and require confirmation. All-page listing uses a resumable workflow with one request per step, preserves cursors, and rejects repeated tokens or more than 100 pages.

## Artifact transfers

File upload takes a grant-owned artifact ID in `file`; cloud-only `name` and `content-type` preserve the local filename and MIME metadata. The 100 MiB upstream limit remains enforced. The durable workflow checkpoints preparation, credential-free presigned PUT, and upload callback separately; the callback receives the PUT ETag. Downloads and source exports return a private artifact ID in `output` and `artifactId`, plus the original byte size. An optional output filename is metadata only. Artifact read/write authorization is checked independently of Apps authorization. Known-length downloads stream into R2 up to the configured 2 GB aggregate limit; unknown-length responses are buffered with a 32 MiB limit and return an explicit error above that limit.

## Roles

Role writes validate real app IDs, safe role IDs, typed membership IDs, and the 100-member atomic limit. Empty descriptions remain explicit updates. Role reads reject malformed collections, missing pagination metadata, and inconsistent role IDs. Exact-name listing scans bounded pages in a durable workflow and verifies stable totals, unique IDs, and page progress before applying the caller's offset/limit to the matches. Chat member filtering retries without the filter only for recognized upstream rejection codes and returns only the requested group. Destructive role or member deletion requires confirmation.

## Database migration and recovery

Database migration and point-in-time recovery run as durable workflows. Each resume performs at most one upstream request. Submission and polling are separate checkpoints, so a resumed poll cannot repeat a mutation. Polls respect the upstream one-second migration/preview interval and two-second recovery interval, with a two-minute deadline. Recovery previews collapse redundant row changes when a schema action already covers the same table. Read-only previews still require the upstream Spark write scope. Recovery timestamps are normalized before submission and remain fixed throughout the workflow.

## SQL execution

SQL execution requires confirmation and exactly one inline SQL string or grant-owned file artifact. File SQL is read with a 1 MiB cloud bound and is never copied into public preview output. Requests retain explicit SQL whitespace and force `transactional=false`; explicit SQL transactions remain the caller's choice. Structured and legacy statement results are normalized, and an HTTP-success ERROR sentinel becomes a failed operation with statement position and transaction rollback evidence. Online DDL policy rejection reports that the entire batch was rejected, without inventing a statement position.

## Database audit history

Multi-table audit queries first page through table metadata, then read enabled audit settings and report skipped tables before querying valid tables. Each page is checkpointed with cursor-loop and page-count guards. Audit and DDL history responses project documented fields, decode operator metadata and JSON before/after values, and normalize time filters. Enabling or disabling audit retries only the explicitly classified upstream lock-contention rollback condition, at most three times with persisted backoff.

## Database data files

Database import/export retain the upstream 1 MiB file ceiling. Imports take an artifact ID plus a filename, infer the default table from that filename, and use multipart upload after confirmation. Exports retain the 5000-row ceiling, query total rows first, and then download bytes to a private artifact. A failed count query falls back to the CLI's content-based row estimate. Output filenames select CSV, JSON, or SQL format; they never become filesystem paths.

## Base database synchronization

Sync create/update parse a single JSON object, validate source and target types, table actions, schema-only restrictions, mapping aliases, and enabled mappings. Create permits server auto-matching when mappings are omitted; update requires an enabled mapping. Preview exempts creation confirmation and may save its resolved configuration to an artifact. Environment belongs in the body, with omission retaining the upstream online default. Config input uses inline JSON; clients can read their artifact contents before invoking the command.

## Environment file pull

Environment pull requires an explicit app ID in the cloud. Optional `file` identifies an existing grant-owned dotenv artifact to merge; local project-path discovery is replaced by this explicit input. Dev environment values are merged without dropping comments or unrelated assignments, using quoted values and sorted new keys. The result contains only a private artifact ID and database expiry metadata, never plaintext secrets. Existing input and generated output are independently authorized as artifact reads and writes and bounded to 1 MiB.

## HTML publishing

HTML publishing accepts `path` as an owned artifact ID. Set `name` to `index.html` for a single page or provide a `.tar.gz` bundle for a directory. Bundles are validated as regular-file/directory USTAR archives before upload; symbolic links and extended-header formats are rejected explicitly. This cloud input boundary replaces local directory traversal. The adapter enforces root `index.html`, credential filename scanning unless explicitly waived, 10 MiB per HTML file, 200 MiB uncompressed total, and 20 MiB compressed size. Single HTML files are packaged into gzip USTAR in the Worker and staged privately. App type validation, upload URL preparation, presigned PUT, and release submission are separate workflow checkpoints. Only HTML and modern HTML app types may use this publishing chain.

## Observability

Logs and traces map the public online environment to backend runtime, normalize repeated filters, preserve nanosecond timestamp strings, and validate time/duration ranges. Log detail resolves frontend source-map stacks when enough metadata is present, reporting an unresolved status without discarding the log when enrichment fails. Trace lists aggregate repeated span records into trace summaries with exact integer timestamp ordering. Metric and analytics families map to upstream series names, merge nested series by timestamp and dimensions, and preserve their distinct missing-value rules. Metrics choose down-sampling from the requested time range unless explicitly overridden; analytics reject conflicting device/series filters.

## Explicit local-process exclusions

The following seven registered shortcuts have no Worker handler and are not counted as cloud business parity:

| Shortcut | Pinned source | Local-only contract |
| --- | --- | --- |
| `apps.+init` | `shortcuts/apps/apps_init.go` | Clones a repository, runs Git and npx scaffold commands, and may commit/push from a local working directory. |
| `apps.+git-credential-init` | `shortcuts/apps/git_credential.go` | Issues a repository credential specifically to install it in the local system credential store and global URL-scoped Git helper. A cloud account token is not a substitute for this helper contract. |
| `apps.+git-credential-list` | `shortcuts/apps/git_credential.go` | Scans the local CLI credential metadata and derives local helper status; performs no remote API request. |
| `apps.+git-credential-remove` | `shortcuts/apps/git_credential.go` | Removes the local system credential and URL-scoped Git helper; performs no remote API request. |
| `apps.+plugin-install` | `shortcuts/apps/apps_plugin_install.go` | Downloads/extracts a plugin into local node_modules and updates package.json actionPlugins, with local dependency checks. |
| `apps.+plugin-list` | `shortcuts/apps/apps_plugin_list.go` | Reads local package.json actionPlugins and cross-checks local node_modules. |
| `apps.+plugin-uninstall` | `shortcuts/apps/apps_plugin_uninstall.go` | Removes local node_modules entries and updates package.json. |

Use lark-cli locally for these operations. Remote app creation, generation, release, export, database, file, environment, access, and observability commands remain implemented cloud capabilities. Terminal rendering is replaced by structured MCP JSON. The manifest lists only executable cloud capabilities, with command-specific test evidence and explicit adaptations.

## Hosted flag inventory

The upstream command framework injects confirmation globally rather than listing it in each shortcut's flag array. The MCP schemas expose `yes` explicitly for cache-clear, env-delete, db-data-import, db-sync-create/update, db-execute, db-env-migrate, db-recovery-apply, db-env-create, db-sync-delete, member-remove, file-delete, automation-update, role-delete, role-member-remove, and openapi-key-reset/delete. These flags implement the documented confirmation guards.

The hosted `name` flag on file-upload, db-data-import, and html-publish supplies filename metadata lost when a local path becomes an artifact ID. File-upload also accepts `content-type` as explicit MIME metadata. Env-pull accepts hosted `file` to merge an existing dotenv artifact. Its pinned `project-path` flag is exposed but rejects nonempty local paths with an explicit instruction to use `file`; a Worker cannot discover a caller's local project. The hidden legacy `env` flag remains exposed on the pinned database commands and is explicitly rejected in favor of `environment`, matching upstream validation.
