import { describe, expect, it, vi } from 'vitest';
import { okrPrograms } from '../src/capabilities/okr/workflows';
import type { CommandContext } from '../src/ports/capabilities';
type Data = Record<string, any>;
async function run(action: string, args: Data, responses: Data[]) {
    const request = vi.fn(); responses.forEach(value => request.mockResolvedValueOnce(value));
    let state: Data = { action, args, phase: 'start' };
    const program = okrPrograms().find(item => item.id === 'okr-edit')!;
    for (let index = 0; index < 100; index++) {
        const count = request.mock.calls.length;
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as Data, request };
        state = result.state;
    }
    throw new Error('Workflow did not finish');
}
describe('OKR bounded mutation workflows', () => {
    it('reads all pages before applying a stable sparse reorder', async () => {
        const { output, request } = await run('reorder', { level: 'objective', 'cycle-id': '1', ops: [{ id: '3', position: 1 }] }, [{ items: [{ id: '2', position: 2 }], has_more: true, page_token: 'next' }, { items: [{ id: '1', position: 1 }, { id: '3', position: 3 }] }, {}]);
        expect(request.mock.calls[1]![0].query.page_token).toBe('next');
        expect(request.mock.calls[2]![0]).toMatchObject({ method: 'PUT', path: '/open-apis/okr/v2/cycles/1/objectives_position', body: { objective_ids: ['3', '1', '2'] } });
        expect(output.ordered).toEqual(['3', '1', '2']);
    });
    it('distributes fixed-point weight residuals exactly', async () => {
        const { output, request } = await run('weight', { level: 'key-result', 'cycle-id': '1', 'objective-id': '2', weights: [{ id: '3', weight: 0.333 }] }, [{ items: [{ id: '3', position: 1, weight: 0 }, { id: '4', position: 2, weight: 0 }, { id: '5', position: 3, weight: 0 }] }, {}]);
        expect(output.weights).toEqual([{ id: '3', weight: 0.333 }, { id: '4', weight: 0.333 }, { id: '5', weight: 0.334 }]);
        expect(request.mock.calls[1]![0].body.key_result_weights[2]).toEqual({ key_result_id: '5', weight: 0.334 });
    });
    it('resolves the actual indicator before patching a zero value', async () => {
        const { output, request } = await run('indicator-update', { level: 'objective', id: '1', value: '0' }, [{ indicator: { id: '2' } }, {}]);
        expect(request.mock.calls[1]![0]).toEqual({ method: 'PATCH', path: '/open-apis/okr/v2/indicators/2', body: { current_value: 0 } });
        expect(output.indicator_id).toBe('2');
    });
});

describe('OKR cycle details', () => {
    it('loads objective and key-result pages with bounded fanout and rich/simple projections', async () => {
        const request = vi.fn().mockResolvedValueOnce({ items: [{ id: '1', content: { blocks: [{ paragraph: { elements: [{ text_run: { text: 'Objective' } }] } }] } }] }).mockResolvedValueOnce({ items: [{ id: '3', position: 2 }], has_more: true, page_token: 'next' }).mockResolvedValueOnce({ items: [{ id: '2', position: 1 }] });
        const program = okrPrograms().find(item => item.id === 'okr-details')!;
        let state: Data = { action: 'cycle-detail', args: { 'cycle-id': '10' }, phase: 'start' };
        for (let step = 0; step < 20; step++) {
            const before = request.mock.calls.length;
            const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
            expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
            if (result.done) {
                const output = result.output as Data;
                expect(output.objectives[0].content).toEqual({ text: 'Objective' });
                expect(output.objectives[0].key_results.map((item: Data) => item.id)).toEqual(['2', '3']);
                return;
            }
            state = result.state;
        }
        throw new Error('Did not finish');
    });
});

it('keeps opaque nonblank reorder IDs as accepted by the upstream shortcut', async () => {
    const { output } = await run('reorder', { level: 'objective', 'cycle-id': '1', ops: [{ id: 'objective-a', position: 1 }] }, [{ items: [{ id: 'objective-a' }] }, {}]);
    expect(output.ordered).toEqual(['objective-a']);
});

it('discovers comments on the cycle, objectives, key results and their progress records', async () => {
    const request = vi.fn().mockImplementation(async (request: Data) => {
        if (request.path.endsWith('/objectives')) return { items: [{ id: '2' }] };
        if (request.path.endsWith('/key_results')) return { items: [{ id: '3' }] };
        if (request.path.endsWith('/objectives/2/progresses')) return { items: [{ id: '4' }] };
        if (request.path.endsWith('/key_results/3/progresses')) return { items: [{ id: '5' }] };
        return { items: [{ id: `comment-${request.query.target_id}`, target: { target_id: request.query.target_id }, create_time: '1000' }] };
    });
    const program = okrPrograms().find(item => item.id === 'okr-details')!;
    let state: Data = { action: 'comment-detail', args: { 'cycle-id': '1' }, phase: 'start' };
    for (let step = 0; step < 30; step++) {
        const count = request.mock.calls.length;
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) { expect(Object.keys((result.output as Data).comments)).toEqual(['1', '2', '3', '4', '5']); return; }
        state = result.state;
    }
    throw new Error('Did not finish');
});
