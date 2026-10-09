import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
const args = { 'base-token': 'b', 'table-id': 't', 'field-id': 'f' };
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it('reads, installs and clears a field extension', async () => {
    const f = fixture({ current_extension: null });
    expect(await command('field-extension-get').execute(args, f.context)).toEqual({ current_extension: null });
    const body = { extension_id: 'builtin_llm_completion', inputs: { prompt: [{ type: 'text', text: '' }, { type: 'field_ref', field: 'Description' }] } };
    await command('field-extension-update').execute({ ...args, json: body }, f.context);
    expect(f.request.mock.calls[1]![0].body).toEqual(body);
    await command('field-extension-update').execute({ ...args, json: '{}' }, f.context);
    expect(f.request.mock.calls[2]![0].body).toEqual({});
});
it.each([
    { extension_id: 'other', inputs: { prompt: [] } },
    { extension_id: 'builtin_llm_completion', inputs: { prompt: [{ type: 'text', text: 'x', field: 'f' }] } },
    { extension_id: 'builtin_llm_completion', inputs: { prompt: [{ type: 'field_ref', field: '' }] } },
    { extension_id: 'builtin_llm_completion', inputs: { prompt: [{ type: 'text', text: 'x', unknown: 1 }] } },
])('rejects invalid extension schema before upstream IO: %j', async json => {
    const f = fixture(); await expect(command('field-extension-update').execute({ ...args, json }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it('distinguishes explicit rows from whole column updates', async () => {
    const f = fixture();
    await command('field-extension-update-cells').execute({ ...args, type: 'row', 'record-id': [' r1 ', 'r2'] }, f.context);
    expect(f.request.mock.calls[0]![0].body).toEqual({ type: 'row', record_ids: ['r1', 'r2'] });
    await command('field-extension-update-cells').execute({ ...args, type: 'column', 'view-id': ' v ' }, f.context);
    expect(f.request.mock.calls[1]![0].body).toEqual({ type: 'column', view_id: 'v' });
    for (const input of [{ type: 'row' }, { type: 'row', 'record-id': ['r'], 'view-id': 'v' }, { type: 'column', 'record-id': ['r'] }, { type: 'row', 'record-id': ['r', ' r '] }]) await expect(command('field-extension-update-cells').preview({ ...args, ...input })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('requires guide acknowledgement and recommends field-update readback', async () => {
    const f = fixture({ type: 'number' });
    await expect(command('field-update').execute({ ...args, json: { type: 'formula' } }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    const result = await command('field-update').execute({ ...args, json: { type: 'formula' }, 'i-have-read-guide': true }, f.context);
    expect(result).toMatchObject({ field: { type: 'number' }, updated: true, field_get_recommended: true, next_step: 'field_get' });
    expect(f.request.mock.calls[0]![0].method).toBe('PUT');
});
