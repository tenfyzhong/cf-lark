import { expect, it, vi } from 'vitest';
import catalog from '../src/capabilities/api/generated/catalog.json';
import { SchemaValidator } from '../src/infrastructure/validation/schema-validator';

it('validates every catalog schema without dynamic code generation', () => {
    const original = globalThis.Function;
    vi.stubGlobal('Function', new Proxy(original, { construct() { throw new Error('Dynamic code generation is forbidden'); } }));
    try {
        const validator = new SchemaValidator();
        for (const { definition } of catalog) {
            try { validator.validate(definition.inputSchema, {}); }
            catch (error) { expect(error).toMatchObject({ code: 'INVALID_ARGUMENTS' }); }
        }
        const schema = catalog.find((item) => item.definition.id === 'task.tasks.list')!.definition.inputSchema;
        expect(() => validator.validate(schema, { params: { page_size: 20, completed: false } })).not.toThrow();
        expect(() => validator.validate(schema, { params: { page_size: '20' } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENTS' }));
        expect(() => validator.validate(schema, { page_size: 20 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENTS' }));
    } finally {
        vi.unstubAllGlobals();
    }
});
