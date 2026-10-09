# Workflow composition

`createWorkflowPrograms` accepts one named dependency object. Required private artifact storage and optional remote files, card formatting, record formatting, event inbox access, content hashing and mail transformation are wired explicitly at the composition root. Adding a dependency does not shift unrelated constructor positions.

Typed API programs are registered once per catalog domain and risk. Raw API programs use their separately authorized API domain and runtime method risk. Both reuse the same request, pagination, transfer and formatting engine. Runtime capabilities and build-time definitions include the same raw and typed API entries, and standalone schema generation follows catalog regeneration.

Production bootstrap and the native Worker fixture use the same composition factory. Composition tests assert unique program IDs, domain presence and equality between runtime capability definitions and generated validation schemas without executing external ports.
