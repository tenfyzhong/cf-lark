import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
function record(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pick(value: JsonObject, keys: string[]): JsonObject { return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])); }
function truncated(value: unknown): boolean {
    if (!record(value)) return false;
    return ['truncated', 'has_more', 'is_truncated'].some(key => value[key] === true) || ['sheets', 'ranges'].some(key => Array.isArray(value[key]) && value[key].some(truncated));
}
export async function readOutput(name: string, args: JsonObject, output: unknown, store?: ArtifactStore, owner?: string): Promise<unknown> {
    if (name === 'csv-get' && args['include-row-prefix'] === false && record(output) && typeof output.annotated_csv === 'string') {
        output = { ...output, annotated_csv: output.annotated_csv.split('\n').map(line => line.startsWith('[row=') && line.includes(']') ? line.slice(line.indexOf(']') + 1).replace(/^,/, '') : line).join('\n') };
    }
    if (name === 'cond-format-result-get') {
        if (!record(output)) return {};
        const result = pick(output, ['warning_message', 'has_more', 'returned_cell_count']);
        if (Array.isArray(output.ranges)) result.ranges = output.ranges.filter(record).map(range => {
            const item = pick(range, ['range', 'actual_range', 'row_indices', 'col_indices', 'truncated']);
            if (Array.isArray(range.cells)) item.cells = range.cells.filter(Array.isArray).map(row => row.map(cell => record(cell) ? pick(cell, ['cell_styles']) : {}));
            return item;
        });
        return result;
    }
    if (args['output-path'] && store && owner) {
        const body = new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/json' });
        const artifact = await store.upload(owner, body.size, body.stream());
        const incomplete = truncated(output);
        return { artifactId: artifact.id, output_path: `/mcp/artifacts/${artifact.id}`, bytes_written: body.size, complete: !incomplete, ...(incomplete ? { truncated: true, truncation_warning: 'The read reached its cap. Read the missing ranges or increase max-chars.' } : {}) };
    }
    return output;
}
