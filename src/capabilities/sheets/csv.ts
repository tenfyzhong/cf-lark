import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import { splitRange } from './matrices';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function csvInput(args: JsonObject, value: JsonObject): void {
    if (typeof args.csv !== 'string' || !args.csv.trim()) invalid('csv is required.');
    if (!/[\n,]/.test(args.csv) && (/^(?:[./~]|[a-z]:[\\/])/i.test(args.csv) || /\.(csv|tsv)$/i.test(args.csv.trim()))) invalid('CSV looks like a path. Supply inline CSV content.');
    if (Object.hasOwn(args, 'range') === Object.hasOwn(args, 'start-cell')) invalid('Provide exactly one start-cell or range.');
    const anchor = String(args['start-cell'] ?? splitRange(String(args.range)).range.split(':')[0]).trim();
    if (!/^[a-z]+[1-9][0-9]*$/i.test(anchor)) invalid('start-cell must be a single A1 cell.');
    value.start_cell = anchor; value.csv = args.csv;
    if (args['allow-overwrite'] === false) value.allow_overwrite = false;
    const extent = csvExtent(args.csv);
    if (extent) {
        const match = /^([a-z]+)([0-9]+)$/i.exec(anchor)!;
        let col = [...match[1]!.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) + extent.cols - 1, end = '';
        while (col > 0) { col--; end = String.fromCharCode(65 + col % 26) + end; col = Math.floor(col / 26); }
        value.__writes_range = `${anchor}:${end}${Number(match[2]) + extent.rows - 1}`;
    }
}
function csvExtent(csv: string): { rows: number; cols: number } | undefined {
    let quote = false, fieldStart = true, width = 1, cols = 0, rows = 0, occupied = false;
    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        if (char === '"') {
            if (quote && csv[i + 1] === '"') { i++; occupied = true; }
            else if (quote || fieldStart) { quote = !quote; occupied = true; }
            else return undefined;
        } else if (!quote && char === ',') { width++; fieldStart = true; occupied = true; }
        else if (!quote && char === '\n') { if (occupied) { rows++; cols = Math.max(cols, width); } width = 1; fieldStart = true; occupied = false; }
        else if (char !== '\r') { fieldStart = false; occupied = true; }
    }
    if (quote) return undefined;
    if (occupied) { rows++; cols = Math.max(cols, width); }
    return rows ? { rows, cols } : undefined;
}
