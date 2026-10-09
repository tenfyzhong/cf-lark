import { calendarAgendaDefinition } from './agenda-definition';
export { calendarAgendaDefinition } from './agenda-definition';
import { ServiceError } from '../../domain/errors';
import type { CommandDefinition, JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { arr, base, bounds, calendar, eventOutput, obj } from './helpers';

export function calendarAgendaCapability(workflows: WorkflowRunner): Capability { return { definition: calendarAgendaDefinition, preview: async args => { const [start, end] = bounds(args); return { requests: [{ method: 'GET', path: `${base}/${encodeURIComponent(calendar(args))}/events/instance_view`, query: { start_time: String(start), end_time: String(end) } }] }; }, execute: async (args, context) => { const [start, end] = bounds(args); return workflows.start('calendar-agenda', { args, windows: [{ start, end, depth: 0 }], events: [] }, context.selection, context.grant); } }; }
export function calendarAgendaProgram(): WorkflowProgram { return { id: 'calendar-agenda', version: 1, domain: 'calendar', risk: 'read', identities: ['user', 'bot'], step: async (state, context) => {
    const windows = arr(state.windows).map(obj), events = arr(state.events).map(obj), args = obj(state.args);
    if (!windows.length) { const unique = new Map<string, JsonObject>(); for (const event of events) { if (event.status === 'cancelled') continue; const key = `${event.event_id}|${obj(event.start_time).timestamp ?? ''}|${obj(event.end_time).timestamp ?? ''}`; unique.set(key, event); } return { done: true, output: [...unique.values()].sort((a, b) => Number(obj(a.start_time).timestamp ?? 0) - Number(obj(b.start_time).timestamp ?? 0)).map(event => { const output = eventOutput(event); delete output.attendees; delete output.status; return output; }) }; }
    const window = windows.shift()!, start = Number(window.start), end = Number(window.end), depth = Number(window.depth); if (depth > 10) throw new ServiceError('UPSTREAM_LIMIT', 'Calendar window splitting exceeded ten levels.', 502);
    const split = () => { const mid = Math.floor((start + end) / 2); if (mid <= start) throw new ServiceError('UPSTREAM_LIMIT', 'Calendar time window cannot be split further.', 502); windows.unshift({ start, end: mid, depth: depth + 1 }, { start: mid + 1, end, depth: depth + 1 }); };
    if (end - start > 40 * 86400) split(); else if (start <= end) { try { const data = await context.lark.request({ method: 'GET', path: `${base}/${encodeURIComponent(calendar(args))}/events/instance_view`, query: { start_time: String(start), end_time: String(end) } }); events.push(...arr(data.items).map(obj)); } catch (error) { const code = error instanceof ServiceError ? Number(error.details?.upstreamCode ?? error.details?.code) : 0; if (code === 193103 || (code === 193104 && end - start > 7200)) split(); else throw error; } }
    return { done: false, state: { ...state, windows, events } };
} }; }
