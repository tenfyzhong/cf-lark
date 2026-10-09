import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it('resolves titles from Base-only results and removes highlight tags', async () => {
    const f = fixture({ res_units: [{ title_highlighted: '<h>Tasks</h>', result_meta: { token: 'b', doc_types: 'BITABLE', url: 'https://example.com', owner_name: 'Owner', update_time_iso: 'now' } }, { result_meta: { token: 'd', doc_types: 'DOCX' } }] });
    expect(await command('title-resolve').execute({ title: ' Tasks ' }, f.context)).toMatchObject({ input_type: 'title_query', base_token: 'b', title: 'Tasks', owner_name: 'Owner' });
    expect(f.request.mock.calls[0]![0].body).toEqual({ query: 'Tasks', page_size: 5, doc_filter: { doc_types: ['BITABLE'] }, wiki_filter: { doc_types: ['BITABLE'] } });
    await expect(command('title-resolve').preview({ title: 'a'.repeat(31) })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('returns title candidates without silently selecting a duplicate', async () => {
    const f = fixture({ res_units: [1, 2].map(i => ({ title: 'Tasks', result_meta: { token: `b${i}`, doc_types: 'BITABLE' } })) });
    expect(await command('title-resolve').execute({ query: 'Tasks' }, f.context)).toMatchObject({ candidates: [{ base_token: 'b1' }, { base_token: 'b2' }] });
    await expect(command('title-resolve').execute({ title: 'Missing' }, fixture({ res_units: [] }).context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('validates DSL shape while preserving dimension and measure values', async () => {
    const f = fixture({ rows: [] });
    await command('data-query').execute({ 'base-token': 'b', dsl: { measures: [], filters: { value: '1000000000000000001' } } }, f.context);
    expect(f.request.mock.calls[0]![0].path).toBe('/open-apis/base/v3/bases/b/data/query');
    await expect(command('data-query').preview({ 'base-token': 'b', dsl: '{}' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it.each(['bind', 'get', 'unbind'])('resolves canonical field identity before button %s', async action => {
    const request = vi.fn().mockResolvedValueOnce({ field_id: 'fld1' }).mockResolvedValueOnce({ bound: action === 'bind' });
    const program = basePrograms().find(p => p.id === `base-button-rule-${action}`)!;
    let state: JsonObject = { args: { 'base-token': 'b', 'table-id': 't', 'field-id': 'Button', 'workflow-id': 'wkf1' }, phase: 'start' };
    for (let i = 0; i < 5; i++) {
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        if (result.done) { expect(result.output).toEqual({ bound: action === 'bind' }); break; }
        state = result.state;
    }
    expect(request.mock.calls[1]![0]).toEqual({ method: action === 'get' ? 'GET' : 'PUT', path: '/open-apis/base/v3/bases/b/tables/t/fields/fld1/button_rule', ...(action === 'get' ? {} : { body: { workflow_id: action === 'bind' ? 'wkf1' : '' } }) });
});
it('preserves unsafe integer lexemes in inline analysis DSL', async () => {
    const f = fixture(); const dsl = '{"dimensions":[],"filter":{"value":9007199254740993}}';
    await command('data-query').execute({ 'base-token': 'b', dsl }, f.context);
    expect(f.request.mock.calls[0]![0]).toMatchObject({ rawBody: dsl });
    expect(f.request.mock.calls[0]![0]).not.toHaveProperty('body');
});
