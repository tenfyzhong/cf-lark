import { expect, it, vi } from 'vitest';
import { calendarAgendaProgram } from '../src/capabilities/calendar/agenda';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
it('splits oversized windows and deduplicates normalized visible events', async () => {
    const request = vi.fn(async () => ({ items: [{ event_id: 'a', start_time: { timestamp: '1767225600' }, end_time: { timestamp: '1767229200' }, attendees: [], status: 'confirmed' }, { event_id: 'gone', status: 'cancelled' }] }));
    const ctx = { lark: { request } } as unknown as CommandContext;
    let state: JsonObject = { args: {}, windows: [{ start: 1767225600, end: 1772410000, depth: 0 }], events: [] };
    let output: unknown;
    for (let i = 0; i < 20; i++) { const result = await calendarAgendaProgram().step(state, ctx); if (result.done) { output = result.output; break; } state = result.state; }
    expect(request).toHaveBeenCalledTimes(2);
    expect(output).toEqual([{ event_id: 'a', start_time: { datetime: '2026-01-01T00:00:00Z' }, end_time: { datetime: '2026-01-01T01:00:00Z' } }]);
});
