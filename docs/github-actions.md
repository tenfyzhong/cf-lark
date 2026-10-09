# GitHub Actions validation and deployment

The workflow validates pull requests and pushes to `main` without deployment
credentials. Production deployment requires successful validation, the `main`
ref and `DEPLOY_ENABLED=true`. It runs after pushes to main and supports manual
`workflow_dispatch` on main. Pull requests and feature branches never deploy.
Deployment runs are serialized without cancelling an in-progress rollout.

## Repository Variables

Configure Settings > Secrets and variables > Actions > Variables in each fork.
No deployment domain/account/audience belongs in tracked workflow files.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DEPLOY_ENABLED` | Yes to deploy | `true` enables production deployment |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Account owning all three Workers and the bucket |
| `PUBLIC_URL` | Yes | Your canonical HTTPS origin, without a path/query |
| `ACCESS_TEAM_DOMAIN` | Yes | Your Access team's HTTPS cloudflareaccess.com issuer |
| `ACCESS_AUD` | Yes | Your dedicated application's 64-character audience tag |
| `ACCESS_EMAIL_DOMAIN` | Yes | Exact permitted email domain, without `@` |
| `WORKER_NAME` | No | Defaults to `cf-lark`; engine names derive from it |
| `R2_BUCKET_NAME` | No | Defaults to `${WORKER_NAME}-private` |

The 2,000,000,000-byte cap, artifact retention and operation budgets retain their
tracked defaults. The renderer preserves migration tags/classes and changes
only deployment-specific names, account, bindings, origin and Access settings.

## Repository Secrets

| Secret | Meaning |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Account-restricted API token for deployment |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte data encryption key |

Use the Cloudflare Edit Workers token template, restricted to the selected
account and hostname's zone. It must allow Worker/script and route deployment,
account/zone lookup and binding to the private R2 bucket. See the official
[Cloudflare GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
Do not upload Wrangler OAuth access/refresh tokens to GitHub.

For a new installation, generate and back up an encryption key once. When
upgrading, reuse the existing key; changing it makes existing application/account
records unreadable. Secrets are not available to fork PRs and are not referenced
by the validation job. GitHub's [Variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)
and [Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
settings apply independently to every fork.

## Provisioning and execution

Create/activate a private R2 bucket and configure Cloudflare Access for your
`/api/admin` prefix and `/consent` path before deployment. The workflow does not
create identities, billing subscriptions or Access policies. Set Variables and
Secrets, then enable deployment. No repository-owner check prevents fork use.

The deployment job validates all inputs before network mutations, generates the
three ignored production configurations plus an encryption-secret JSON file
with mode 0600, and deploys Docs/Mail engines before the public Worker. The public
upload includes `--secrets-file`, so the key and code arrive in one version.
No application tokens or keys are given to private engines. Generated files are
removed in an unconditional cleanup step and are never uploaded as artifacts.
The compiler is also available locally as `pnpm configure:deployment` using the
same environment variable names; it refuses to overwrite existing private files.

Pinned action commits, locked dependencies, read-only GitHub permissions and a
main-ref condition constrain the release path. GitHub environment approvals can
be added by an operator if desired. The workflow does not merge pull requests.
Automatic deployment becomes available once the workflow reaches main; a new
workflow on an unmerged PR is validated but cannot be dispatched from GitHub's
default-branch workflow registry yet.
