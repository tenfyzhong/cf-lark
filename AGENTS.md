# Engineering Instructions

## Workflow

- Document behavior, interfaces, and acceptance criteria before implementation.
- Follow TDD for features, fixes, refactors, and behavior changes: demonstrate an
  expected failing reusable test before writing the production change.
- Use English for all repository content. Do not add Chinese characters to
  source, comments, documentation, fixtures, or generated metadata.
- Keep runtime support for multilingual user content.
- Preserve the full compatibility target; never mark unimplemented shortcuts as
  supported because a raw API transport exists.
- Keep verification evidence explicit about mocked versus live behavior.

## Boundaries

- Domain, ports, application, and capabilities must not import platform SDKs.
- Application depends on a capability registry contract, not concrete domains.
- Capability domains must not import each other's private implementation.
- Infrastructure owns Cloudflare bindings, encryption, and upstream HTTP.
- Inbound adapters decode and map; application services own use cases.
- The composition root wires dependencies explicitly.
- Do not introduce mutable global registries or service locators.

## Git

- Use a dedicated feature branch and matching worktree under `.git/wtm/`.
- Never commit or push to main. Sign off every commit with `git commit -s`.
- Use English commit, tag, and pull request text.
- Do not push immediately after committing.
