import { describe, expect, it, vi } from 'vitest';
import { okrPrograms } from '../src/capabilities/okr/workflows';
import type { CommandContext } from '../src/ports/capabilities';
import { ServiceError } from '../src/domain/errors';
type Data = Record<string, any>;
async function run(responses: (Data | Error)[]) {
    const request = vi.fn(); responses.forEach(data => data instanceof Error ? request.mockRejectedValueOnce(data) : request.mockResolvedValueOnce(data));
    const program = okrPrograms().find(item => item.id === 'okr-batch')!;
    let state: Data = { phase: 'start', args: { 'cycle-id': '1', 'category-id': '10', input: [{ text: 'First', notes: 'Notes', category_id: '11', krs: [{ text: 'Result' }] }, { text: 'Second' }] } };
    for (let step = 0; step < 30; step++) {
        const count = request.mock.calls.length;
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as Data, request };
        state = result.state;
    }
    throw new Error('Did not finish');
}
describe('OKR batch creation', () => {
    it('creates nested entities and uses per-objective category overrides', async () => {
        const { request, output } = await run([{ objective_id: '2' }, { key_result_id: '3' }, { objective_id: '4' }]);
        expect(request.mock.calls[0]![0].body.category_id).toBe('11');
        expect(request.mock.calls[1]![0].path).toBe('/open-apis/okr/v2/objectives/2/key_results');
        expect(request.mock.calls[2]![0].body.category_id).toBe('10');
        expect(output).toEqual({ ok: true, data: { created: [{ objective_id: '2', krs: ['3'] }, { objective_id: '4', krs: [] }] } });
    });
    it('rolls back known created objectives after a definite failure and reports residual IDs', async () => {
        const { request, output } = await run([{ objective_id: '2' }, { key_result_id: '3' }, new ServiceError('UPSTREAM_ERROR', 'Rejected'), new ServiceError('UPSTREAM_ERROR', 'Rollback rejected')]);
        expect(request.mock.calls[3]![0]).toMatchObject({ method: 'DELETE', path: '/open-apis/okr/v2/objectives/2' });
        expect(output.ok).toBe(false); expect(output.residual_objective_ids).toEqual(['2']);
    });
    it('stops uncertain writes without retry or rollback guesses', async () => {
        await expect(run([{ objective_id: '2' }, new ServiceError('OUTCOME_UNCERTAIN', 'Unknown result')])).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    });
});
