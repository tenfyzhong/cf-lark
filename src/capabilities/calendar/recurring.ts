import type { JsonObject } from '../../domain/models';
import { invalid, iso, obj, seconds } from './helpers';
export const originalTime = (id: string): number => Number(id.slice(id.lastIndexOf('_') + 1)) || 0;
export const masterId = (id: string): string => id.replace(/_\d+$/, '_0');
export function recurringScope(event: JsonObject, id: string, scope: string): string {
    const kind = event.is_exception === true ? 'exception' : event.recurrence ? 'master' : originalTime(id) > 0 ? 'instance' : 'normal';
    const allowed = kind === 'normal' ? ['', 'single'] : kind === 'master' ? ['all'] : kind === 'exception' ? ['single', 'all'] : ['single', 'all', 'this-and-following'];
    if (!allowed.includes(scope)) invalid(`apply-to is required or invalid for ${kind}; allowed: ${allowed.filter(Boolean).join(', ')}.`); return scope || 'single';
}
export function pivotMidnight(pivot: number, timezone: string): number {
    let formatter: Intl.DateTimeFormat; try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); } catch { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
    const parts = (time: number) => Object.fromEntries(formatter.formatToParts(new Date(time * 1000)).map(part => [part.type, part.value]));
    const day = parts(pivot), target = Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day)) / 1000; let guess = target;
    for (let i = 0; i < 4; i++) { const p = parts(guess), represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) / 1000; const delta = target - represented; guess += delta; if (!delta) break; } return guess;
}
export function truncateRule(rule: string, until: number): string { const prefix = rule.trim().startsWith('RRULE:') ? 'RRULE:' : ''; return prefix + [...rule.trim().replace(/^RRULE:/, '').split(';').filter(part => part && !/^(COUNT|UNTIL)=/i.test(part.trim())), `UNTIL=${iso(until).replaceAll('-', '').replaceAll(':', '')}`].join(';'); }
export function recurringEnd(rule: string, start: number): number {
    const values = Object.fromEntries(rule.replace(/^RRULE:/, '').split(';').map(part => part.split('='))), upper = Math.floor(Date.now() / 1000) + 5 * 365 * 86400;
    if (values.UNTIL && /^\d{8}(T\d{6}Z)?$/.test(values.UNTIL)) { const raw = values.UNTIL, formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}${raw.length > 8 ? `T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z` : ''}`; return seconds(formatted) + 86400; }
    const step = ({ DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 } as Record<string, number>)[values.FREQ ?? '']; if (step && Number(values.COUNT) > 0) return Math.min(upper, start + step * 86400 * Math.max(1, Number(values.INTERVAL) || 1) * (Number(values.COUNT) + 1)); return upper;
}
export function eventSeconds(event: JsonObject, key: string): number { const value = obj(event[key]); return value.timestamp ? Number(value.timestamp) : value.date ? seconds(String(value.date)) : 0; }
