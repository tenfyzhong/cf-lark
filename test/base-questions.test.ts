import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const args = { 'base-token': 'b', 'table-id': 't', 'form-id': 'f' };
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it('creates new and existing field questions and preserves request properties', async () => {
    const f = fixture({ questions: [{ id: 'q' }] });
    const questions = [{ type: 'text', title: 'Name', visible_rule: null }, { use_existing_field: true, field_id: 'fld1' }];
    expect(await command('form-questions-create').execute({ ...args, questions }, f.context)).toEqual({ questions: [{ id: 'q' }] });
    expect(f.request.mock.calls[0]![0].body).toEqual({ questions });
    for (const value of [null, [null], [{}], [{ use_existing_field: true, field_id: '' }], Array(11).fill({ title: 'Name', type: 'text' })]) await expect(command('form-questions-create').preview({ ...args, questions: value })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('updates questions by overwrite and uses items before questions', async () => {
    const f = fixture({ items: [{ id: 'i' }], questions: [{ id: 'q' }] });
    const questions = [{ id: 'q', title: '', visible_rule: null }];
    expect(await command('form-questions-update').execute({ ...args, questions }, f.context)).toEqual({ questions: [{ id: 'i' }] });
    expect(f.request.mock.calls[0]![0].body).toEqual({ questions });
});
it('deletes questions with explicit field preservation', async () => {
    const f = fixture();
    expect(await command('form-questions-delete').execute({ ...args, 'question-ids': '["q1"]', 'keep-field': true }, f.context)).toEqual({ deleted: true, question_ids: ['q1'], keep_field: true });
    expect(f.request.mock.calls[0]![0].body).toEqual({ question_ids: ['q1'], keep_field: true });
    for (const value of [[], [' '], [1], Array(11).fill('q')]) await expect(command('form-questions-delete').preview({ ...args, 'question-ids': value })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('lists questions and retrieves share-token form detail', async () => {
    const f = fixture({ questions: [{ id: 'q' }], total: 1 });
    expect(await command('form-questions-list').execute(args, f.context)).toEqual({ questions: [{ id: 'q' }], total: 1 });
    await command('form-detail').execute({ 'share-token': 's' }, f.context);
    expect(f.request.mock.calls[1]![0]).toEqual({ method: 'POST', path: '/open-apis/base/v3/bases/tables/forms/detail', body: { share_token: 's' } });
});
it('lists every form page with one request per durable step', async () => {
    const request = vi.fn().mockResolvedValueOnce({ forms: [{ id: 'f1' }], has_more: true, page_token: 'next' }).mockResolvedValueOnce({ forms: [{ id: 'f2' }] });
    const program = basePrograms().find(p => p.id === 'base-form-list')!;
    let state: JsonObject = { args, phase: 'start' };
    for (let i = 0; i < 5; i++) {
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        if (result.done) { expect(result.output).toEqual({ forms: [{ id: 'f1' }, { id: 'f2' }], total: 2 }); return; }
        state = result.state;
    }
    throw new Error('Pagination did not finish.');
});
