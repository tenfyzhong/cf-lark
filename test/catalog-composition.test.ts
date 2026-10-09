import { expect, it } from 'vitest';
import { createCapabilities } from '../src/capabilities/catalog';
import { commandDefinitions } from '../src/capabilities/definitions';
import { SchemaValidator } from '../src/infrastructure/validation/schema-validator';

it('keeps the runtime registry and build-time schema catalog identical', () => {
    const unavailable = async (): Promise<never> => { throw new Error('Catalog construction must not execute a port.'); };
    const capabilities = createCapabilities({ documentParser: { parse: unavailable }, events: { read: unavailable }, artifacts: { upload: unavailable, read: unavailable, remove: unavailable, stat: unavailable },
        workflows: { start: unavailable, resume: unavailable } });
    const byId = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(capabilities.map((item) => item.definition))).toEqual(byId(commandDefinitions));
    expect(new Set(commandDefinitions.map((item) => item.id)).size).toBe(commandDefinitions.length);
    const validator = new SchemaValidator();
    for (const definition of commandDefinitions) {
        try { validator.validate(definition.inputSchema, {}); }
        catch (error) { expect(error).toMatchObject({ code: 'INVALID_ARGUMENTS' }); }
    }
});

it('registers unique durable programs including transcript and task pagination', async () => {
    const { createWorkflowPrograms } = await import('../src/capabilities/programs');
    const unavailable = async (): Promise<never> => { throw new Error('Program construction must not execute a port.'); };
    const programs = createWorkflowPrograms({ artifacts: { upload: unavailable, read: unavailable, remove: unavailable, stat: unavailable }, remoteFiles: { read: unavailable, stream: unavailable, put: unavailable } });
    expect(new Set(programs.map((program) => program.id)).size).toBe(programs.length);
    expect(programs.map((program) => program.id)).toEqual(expect.arrayContaining(['drive-upload', 'docs-media-upload', 'note-transcript', 'raw-api-read', 'raw-api-write', 'typed-api-calendar-read']));
    for (const domain of ['task', 'base', 'apps', 'sheets', 'okr', 'wiki', 'markdown', 'im', 'docs', 'slides', 'vc', 'minutes']) expect(programs.some((program) => program.domain === domain), domain).toBe(true);
});

it('exposes implemented business families through the MCP registry', () => {
    const ids = commandDefinitions.map((definition) => definition.id);
    for (const domain of ['okr', 'wiki', 'markdown', 'vc', 'minutes', 'slides']) expect(ids.some((id) => id.startsWith(`${domain}.+`)), domain).toBe(true);
    expect(ids).toContain('event.+subscribe');
    expect(ids).toContain('api.request');
});
