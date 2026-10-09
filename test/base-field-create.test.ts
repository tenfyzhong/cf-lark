import { expect, it, vi } from 'vitest';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import { ServiceError } from '../src/domain/errors';
async function run(json: unknown, request = vi.fn().mockResolvedValue({ id: 'f' }), ack = false) {
    const program = basePrograms().find(p => p.id === 'base-field-create')!;
    let state: JsonObject = { phase: 'start', args: { 'base-token': 'b', 'table-id': 't', json, 'i-have-read-guide': ack } };
    for (let count = 0; count < 20; count++) {
        const before = request.mock.calls.length;
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return result.output;
        state = result.state;
    }
    throw new Error('Workflow did not terminate.');
}
it('returns simple single-field result without encouraging redundant reads', async () => {
    expect(await run({ name: 'Title', type: 'text' })).toMatchObject({ field: { id: 'f' }, created: true, field_get_recommended: false, next_step: 'done' });
});
it('recommends readback for computed fields and requires acknowledgement', async () => {
    await expect(run({ name: 'Total', type: 'formula' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await run({ name: 'Total', type: 'formula' }, undefined, true)).toMatchObject({ field_get_recommended: true, next_step: 'field_get' });
});
it('validates all fields before creating any', async () => {
    const request = vi.fn();
    await expect(run([{ name: 'Title', type: 'text' }, null], request)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(request).not.toHaveBeenCalled();
});
it('returns a partial-failure ledger and never attempts remaining writes', async () => {
    const request = vi.fn().mockResolvedValueOnce({ id: 'f1', name: 'One', type: 'text' }).mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Rejected', 502, { upstreamCode: 123 }));
    const output = await run([{ name: 'One', type: 'text' }, { name: 'Two', type: 'number' }, { name: 'Three', type: 'text' }], request);
    expect(output).toMatchObject({ summary: { requested: 3, attempted: 2, created: 1, failed: 1, not_attempted: 1 }, next_step: 'inspect_items', items: [{ index: 0, status: 'created', field: { id: 'f1' } }, { index: 1, status: 'failed' }, { index: 2, status: 'not_attempted' }] });
    expect(request).toHaveBeenCalledTimes(2);
});
it('preserves uncertain write outcomes after partial success', async () => {
    const request = vi.fn().mockResolvedValueOnce({ id: 'f1' }).mockRejectedValueOnce(new ServiceError('OUTCOME_UNCERTAIN', 'Disconnected'));
    await expect(run([{ name: 'One' }, { name: 'Two' }], request)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
});
