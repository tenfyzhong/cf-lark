# Full shortcut catalog contract

The contract test compares registered hosted shortcuts with the pinned lark-cli
1.0.97 inventory (commit `72579c80027c863ca51d5f9affda72a70ab0d8a6`).
It checks command identity, supported authentication identities, unconditional
scope declarations, and every upstream flag. Each additional hosted flag needs
an explicit, documented adaptation; matching metadata alone never proves
behavioral parity.

The runtime catalog is instantiated with ports that throw if called. Discovery
must remain free of network, artifact, and credential operations. Missing
runtime registrations, duplicate shortcut IDs, omitted flags, divergent identity
sets and scope mismatches fail the same reusable test. Hosted-only service tools
such as artifact management are outside the upstream shortcut inventory.

Cloud adaptations preserve the original business action while replacing local
filesystem input, executable dependencies, interactive prompts, or long-running
processes with grant-owned artifacts and resumable workflows. The allowlist in
`test/full-shortcut-contract.test.ts` identifies any additional parameter and
links its behavioral documentation. Removing an upstream flag is not permitted
through this allowlist.

The audit is a static contract gate. Domain fixture tests, native Worker tests,
permission checks, transfer limits and live integration checks remain separate
acceptance evidence. Reported mismatches are assigned to the domain owner;
changes to the central catalog and validator generation remain the composition
root owner's responsibility.

## Independent authoring branch audit

`test/docs-slides-audit.test.ts` checks source-derived authoring edge cases beyond
catalog metadata: duplicate resource block correlation must stop every affected
upload; asynchronous document task reads must honor bounded server poll delays
and reject envelopes without a task; successful task payloads that report a
business failure must preserve the original diagnostics. Slides replacement
failures must retain created-page identifiers and avoid deleting old pages when
creation cannot be confirmed. These checks use deterministic ports.

## Hosted coverage and terminal exclusions

The pinned inventory contains 538 registered shortcuts. The hosted scope covers
531 business shortcuts; seven Apps shortcuts require a caller's local checkout,
Git credential helper, package manager, or node_modules. The generated report
classifies these as `excluded`, with pinned source paths and an explicit reason,
instead of treating them as implemented or leaving them as accidental omissions.
They remain absent from the runtime registry. Full CLI terminal compatibility
remains false even when every hosted command has complete implementation evidence.

An exclusion requires test evidence, an existing English documentation page,
source references under the pinned shortcut tree, and zero covered flags. The
same status validator continues to require every upstream flag for implemented
commands. Report totals summarize reviewed entries; they do not establish branch
fidelity. The generator verifies source references against the pinned checkout.

`shortcutSourceInventory` is a pure list of pinned source files, with only `domain`
and `file` fields. A file may contain several commands or shared helpers, so it
has no implementation status. Only `shortcutCommands` carries command coverage
and exclusions; source inventory entries must never introduce synthetic pending
work into the generated report.
