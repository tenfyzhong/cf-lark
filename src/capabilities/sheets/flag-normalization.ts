import { rangeAreas, splitRange } from './matrices';
import { commandAliases, domainAliases, flagTypes } from './generated/flag-vocabulary';
import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { canonicalEnum } from './normalize';
import { flagEnums } from './generated/enums';
function equalJSON(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equalJSON(left[key], right[key]));
}
export function normalizeSheetFlags(name: string, input: JsonObject): JsonObject {
    const types: Record<string, string> = { ...flagTypes[name], token: 'string', ...(name === 'workbook-import' ? { 'file-name': 'string' } : {}) };
    const args: JsonObject = {};
    const squash = (key: string) => key.toLowerCase().replace(/[-_. ]/g, '');
    for (const [key, value] of Object.entries(input)) {
        let target = Object.keys(types).find(candidate => candidate === key) ?? Object.keys(types).find(candidate => squash(candidate) === squash(key));
        if (!target) {
            const aliases = { ...domainAliases, ...commandAliases[name] };
            const alias = Object.keys(aliases).find(candidate => squash(candidate) === squash(key));
            if (alias && !(name === 'cells-unmerge' && alias === 'ranges') && Object.hasOwn(types, aliases[alias]!)) target = aliases[alias];
        }
        if (!target) throw new ServiceError('INVALID_ARGUMENTS', `Unknown ${name} flag ${key}.`);
        if (Object.hasOwn(args, target)) {
            if (equalJSON(args[target], value)) continue;
            throw new ServiceError('INVALID_ARGUMENTS', `${key} conflicts with ${target}.`);
        }
        const type = types[target as keyof typeof types];
        if (['int', 'float64'].includes(type!) && (typeof value !== 'number' || !Number.isFinite(value) || type === 'int' && !Number.isInteger(value))) throw new ServiceError('INVALID_ARGUMENTS', `${target} must be ${type === 'int' ? 'an integer' : 'a finite number'}.`);
        if (type === 'bool' && typeof value !== 'boolean') throw new ServiceError('INVALID_ARGUMENTS', `${target} must be a boolean.`);
        args[target] = name === 'csv-put' && ['file', 'csvfile'].includes(squash(key)) && typeof value === 'string' && !value.startsWith('@') ? `@${value}` : value;
    }
    if (name === 'dim-insert' && String(args['inherit-style']).toLowerCase() === 'none') delete args['inherit-style'];
    for (const [flag, allowed] of Object.entries(flagEnums[name] ?? {})) {
        if (args[flag] === undefined || args[flag] === '') continue;
        const value = typeof args[flag] === 'string' ? canonicalEnum(args[flag], allowed) : undefined;
        if (value === undefined) throw new ServiceError('INVALID_ARGUMENTS', `${flag} must be one of: ${allowed.join(', ')}.`);
        args[flag] = value;
    }
    for (const [flag, split] of Object.entries(['cond-format-create', 'cond-format-update', 'cells-batch-clear'].includes(name) ? { ranges: true } : ['dropdown-set', 'dropdown-update'].includes(name) ? { options: false } : {})) {
        const raw = args[flag];
        if (typeof raw !== 'string' || !raw.trim() || raw.startsWith('@') || /^[\[{"]/.test(raw.trim())) continue;
        try { JSON.parse(raw); continue; } catch { /* Only non-JSON strings are candidates. */ }
        if (!split) { if (!raw.includes(',')) args[flag] = [raw.trim()]; continue; }
        const values: string[] = []; let quoted = false, start = 0;
        for (let index = 0; index <= raw.length; index++) {
            if (raw[index] === "'") { if (quoted && raw[index + 1] === "'") index++; else quoted = !quoted; }
            if (index === raw.length || raw[index] === ',' && !quoted) { values.push(raw.slice(start, index).trim()); start = index + 1; }
        }
        if (!quoted && values.every(Boolean)) args[flag] = values;
    }
    if (types.range === 'string' && types['sheet-id'] && types['sheet-name'] && typeof args.range === 'string' && !String(args['sheet-id'] ?? '').trim() && !String(args['sheet-name'] ?? '').trim()) {
        const areas = rangeAreas(args.range).map(splitRange), names = [...new Set(areas.flatMap(area => area.sheet ? [area.sheet] : []))];
        if (names.length === 1) { args['sheet-name'] = names[0]; args.range = areas.map(area => area.range).join(','); }
    }
    return args;
}
