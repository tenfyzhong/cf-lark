import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (args: JsonObject, key: string): string => typeof args[key] === 'string' ? args[key].trim() : '';
export const csv = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean);
export const base = '/open-apis/calendar/v4/calendars';
export function safe(value: string): string { if (/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value)) invalid('Identifiers must not contain control or invisible characters.'); return value; }
export function calendar(args: JsonObject): string { return safe(text(args, 'calendar-id') || 'primary'); }
export function eventId(args: JsonObject, standard = false): string {
    const id = safe(text(args, 'event-id'));
    if (!id || standard && !/^.+_\d+$/.test(id)) invalid('event-id must be a nonempty event identifier with uid_originalTime format.');
    return id;
}
export function eventPath(args: JsonObject, standard = false): string { return `${base}/${encodeURIComponent(calendar(args))}/events/${encodeURIComponent(eventId(args, standard))}`; }
export function seconds(value: string, end = false): number {
    const raw = value.trim(); if (!raw) invalid('A time value is required.');
    if (/^[1-9]\d*$/.test(raw)) { const n = Number(raw); if (!Number.isSafeInteger(n) || !Number.isFinite(new Date(n * 1000).getTime())) invalid('Timestamp is out of range.'); return n; }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const noZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/.test(raw);
    const timestamp = Date.parse(day ? `${raw}T${end ? '23:59:59' : '00:00:00'}Z` : noZone ? raw.replace(' ', 'T') + 'Z' : raw);
    if (!Number.isFinite(timestamp) || day && new Date(timestamp).toISOString().slice(0, 10) !== raw) invalid('Invalid ISO date or timestamp.');
    return Math.floor(timestamp / 1000);
}
export const iso = (value: number): string => new Date(value * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
export function bounds(args: JsonObject, mode: 'day' | 'search' | 'suggestion' = 'day'): [number, number] {
    let start = text(args, 'start'), end = text(args, 'end');
    if (mode === 'search' && !start && !end) return [0, 0];
    if (!start && mode !== 'search') start = mode === 'suggestion' ? iso(Math.floor(Date.now() / 1000)) : new Date().toISOString().slice(0, 10);
    if (mode === 'day' && !end) end = start;
    let from = start ? seconds(start) : 0, to = end ? seconds(end, true) : 0;
    if (!from) from = seconds(iso(to).slice(0, 10));
    if (!to) to = seconds(iso(from).slice(0, 10), true);
    if (from > to) invalid('start must not be after end.');
    return [from, to];
}
export function eventOutput(input: JsonObject, typed = false): JsonObject {
    const result = typed ? typedEvent(input) : structuredClone(input);
    if (typed && result.is_exception === undefined) result.is_exception = false;
    for (const key of ['start_time', 'end_time']) {
        const value = obj(result[key]);
        if (typeof value.timestamp === 'string' && /^-?\d+$/.test(value.timestamp)) { value.datetime = iso(Number(value.timestamp)); delete value.timestamp; }
        if (key === 'end_time' && !value.datetime && typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) value.date = iso(seconds(value.date) - 1).slice(0, 10);
    }
    if (typeof result.create_time === 'string' && /^-?\d+$/.test(result.create_time)) result.create_time = iso(Number(result.create_time));
    if (result.status !== 'cancelled') delete result.status;
    if (result.description_rich) result.description = result.description_rich;
    delete result.description_rich; if (!result.description) delete result.description;
    return result;
}

function typedEvent(input: JsonObject): JsonObject {
    const project = (value: JsonObject, keys: string[], required: string[] = []): JsonObject => Object.fromEntries(keys.filter(key => required.includes(key) || value[key] !== undefined && value[key] !== null && value[key] !== '' && value[key] !== 0 && value[key] !== false && (!Array.isArray(value[key]) || (value[key] as unknown[]).length)).map(key => [key, value[key] ?? (required.includes(key) ? key === 'duration' || key === 'minutes' ? 0 : false : undefined)]));
    const result = project(input, ['event_id', 'organizer_calendar_id', 'summary', 'description', 'description_rich', 'visibility', 'attendee_ability', 'free_busy_status', 'self_rsvp_status', 'color', 'recurrence', 'status', 'is_exception', 'recurring_event_id', 'create_time'], ['is_exception']);
    const nested: Record<string, string[]> = { start_time: ['date', 'timestamp', 'timezone'], end_time: ['date', 'timestamp', 'timezone'], vchat: ['vc_type', 'icon_type', 'description', 'meeting_url'], location: ['name', 'address', 'latitude', 'longitude'], event_organizer: ['user_id', 'display_name'] };
    for (const [key, fields] of Object.entries(nested)) if (input[key] && typeof input[key] === 'object') result[key] = project(obj(input[key]), fields);
    if (Array.isArray(input.reminders) && input.reminders.length) result.reminders = input.reminders.map(value => project(obj(value), ['minutes'], ['minutes']));
    if (Array.isArray(input.attachments) && input.attachments.length) result.attachments = input.attachments.map(value => project(obj(value), ['file_token', 'file_size', 'name']));
    if (input.event_check_in && typeof input.event_check_in === 'object') { const value = obj(input.event_check_in), check = project(value, ['enable_check_in', 'need_notify_attendees'], ['enable_check_in', 'need_notify_attendees']); for (const key of ['check_in_start_time', 'check_in_end_time']) if (value[key]) check[key] = project(obj(value[key]), ['time_type', 'duration'], ['duration']); result.event_check_in = check; }
    return result;
}
