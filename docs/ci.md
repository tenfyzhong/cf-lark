# Continuous integration

[Tests](../.github/workflows/tests.yml) is a reusable GitHub Actions workflow with
separate results for unit tests, native integration tests and release checks.
[Cloudflare](../.github/workflows/cloudflare.yml) calls it for pull requests and
pushes to `main`, and for manual deployment runs. You can also select
**Actions → Tests → Run workflow** to test a selected branch without deploying.
The workflows become available in a fork after its default branch contains them.
See [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
for the calling workflow contract.

## Jobs

| Job | Commands | Coverage |
| --- | --- | --- |
| Unit tests | `pnpm test` | Command contracts, application behavior and adapters using fixtures |
| Integration tests | `pnpm test:runtime`, `pnpm test:engines` | Native workerd, SQLite Durable Objects, R2, OAuth/MCP and private Docs/Mail transformations |
| Release checks | `pnpm check:validators`, `pnpm typecheck`, `pnpm test:architecture`, `pnpm build`, `pnpm test:browser` | Generated schemas, TypeScript, module boundaries, all three minified Workers, assets and Chromium flows |

Jobs run independently on Ubuntu with pinned setup actions, Node.js 26,
repository-pinned pnpm and frozen-lockfile installation. Workflow permissions are
limited to repository contents read. Test jobs do not receive production Secrets,
use live Lark accounts, or deploy Cloudflare resources. Opt-in live tests remain
skipped unless explicitly configured outside these jobs. Native integration and
browser tests use local fixtures; a passing suite does not establish real-tenant
command acceptance.

The calling Cloudflare workflow's `verify` job succeeds only after every Tests
job succeeds. Production deployment depends on `verify`, remains restricted to
`main`, and respects the deployment enable Secret. PRs never upload Workers.
A manually dispatched Tests run has no deployment job. See
[fork deployment](fork-deployment.md) for deployment Secrets and setup.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:runtime
pnpm test:engines
```

For the complete release checks, run `CI=true WRANGLER_SEND_METRICS=false pnpm check`,
install Chromium with `pnpm exec playwright install --with-deps chromium`, then
run `pnpm test:browser`. Disabling Wrangler telemetry matches CI and avoids
unrelated telemetry network activity during local dry-runs.

## Diagnose a failed run

Expand the failed job and command in **Actions**. Unit and integration failures
are reported separately; use the test name to reproduce the corresponding local
suite. Release checks include the compressed-size reports for each Worker.
Dependency/setup or browser installation failures are infrastructure failures,
not proof of a Lark API behavior failure. Fix the source or runner setup and rerun
the checks; deployment remains blocked until the calling verification succeeds.
