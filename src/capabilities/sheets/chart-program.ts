import { splitRange } from './matrices';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import { invokeSheetTool } from './commands';
import { chartConfig, chartData, chartInvalid, list } from './chart-input';
import { anchor, letter } from './table-write-input';
function object(value: any): any { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
export function chartSnapshot(output: any, id: string): JsonObject {
    for (const sheet of (output?.data ?? output)?.sheets ?? []) for (const chart of sheet.charts ?? []) if (chart.chart_id === id) {
        if (!chart.details?.snapshot) chartInvalid('Chart has no editable snapshot.'); return chart.details.snapshot;
    }
    return chartInvalid('Chart was not found on the selected sheet.');
}
export function chartPatch(name: string, args: JsonObject, snapshot: JsonObject): { patch: JsonObject; result: JsonObject } {
    const next = structuredClone(snapshot) as any;
    if (name === 'chart-data-update') {
        const old = object(next.data); if (old.isStaticData) chartInvalid('Static-data charts cannot change range references.');
        const kind = String(next.plotArea?.plot?.type ?? ''), plan = chartData(args, kind, old);
        let detached = old.headerMode === 'detached'; const headers: Record<number, string> = {};
        for (const serie of [old.dim1?.serie, ...(old.dim2?.series ?? [])]) if (serie?.nameRef) headers[serie.index] = serie.nameRef;
        if (args['header-range'] !== undefined) {
            detached = true; let index = 1;
            for (const range of list(args['header-range'])) {
                const ref = splitRange(range), prefix = range.slice(0, range.length - ref.range.length);
                const parts = ref.range.replaceAll('$', '').split(':'), start = anchor(parts[0]), end = anchor(parts[1] ?? parts[0]);
                const rowMode = (args['data-direction'] ?? old.direction ?? 'column') === 'row';
                if (rowMode ? start.col !== end.col : start.row !== end.row) chartInvalid('Header ranges must align with the data direction.');
                for (let row = start.row; row <= end.row; row++) for (let col = start.col; col <= end.col; col++) headers[index++] = `${prefix}${letter(col)}${row}`;
            }
            if (index - 1 !== plan.dimensionCount) chartInvalid('Header range must name every data dimension.');
        }
        if (detached && [plan.dim1, ...plan.indexes].some(index => !headers[index])) chartInvalid('header-range is required for missing detached headers.');
        const role = (index: number) => ({ index, ...(detached ? { nameRef: headers[index] } : {}) });
        const data = { isStaticData: false, direction: args['data-direction'] ?? old.direction ?? 'column', refs: plan.refs.map(value => ({ value })), dim1: { serie: role(plan.dim1) }, dim2: { series: plan.indexes.map((index, n) => ({ ...role(index), ...(kind === 'bubble' ? { role: plan.roles[n] } : {}) })) }, ...(detached ? { headerMode: 'detached' } : {}) };
        const patch: JsonObject = { data };
        if (kind === 'combo') {
            const plotArea = structuredClone(next.plotArea);
            const existing = Array.isArray(plotArea.plot?.series) ? plotArea.plot.series : [];
            plotArea.plot.series = plan.indexes.map((index, n) => ({ ...(existing.find((p: any) => p.index === index) ?? { comboType: n === 0 ? 'column' : 'line', yAxisPosition: n === 0 ? 'left' : 'right' }), index }));
            patch.plotArea = plotArea;
        }
        return { patch, result: { data, normalized_data_ranges: plan.refs } };
    }
    if (args['aggregate-categories'] !== undefined && next.data?.isStaticData) chartInvalid('aggregate-categories does not apply to static-data charts.');
    if (args['data-label-position'] !== undefined && args['data-labels'] === undefined && !next.plotArea?.plot?.labels) chartInvalid('data-label-position requires existing labels or data-labels.');
    if (args['x-axis-min'] !== undefined || args['x-axis-max'] !== undefined) {
        const axis = next.plotArea?.axes?.find((axis: any) => axis.type === 'x' && (!axis.position || axis.position === 'bottom'));
        if (axis?.valueType !== 'linear') chartInvalid('X-axis bounds require a continuous numeric axis.');
    }
    const updates = chartConfig(args), patch: any = {};
    for (const [flag, field] of [['title', 'title'], ['subtitle', 'subTitle']]) if (updates[flag!] !== undefined) { next[field!] = { ...object(next[field!]), text: updates[flag!] }; patch[field!] = next[field!]; }
    if (updates.legend_position !== undefined) { next.legend = updates.legend_position === 'hidden' ? false : { ...object(next.legend), position: updates.legend_position }; patch.legend = next.legend; }
    if (updates.aggregate_categories !== undefined) patch.data = { dim1: { serie: { aggregate: updates.aggregate_categories } } };
    const area = object(next.plotArea), plot = object(area.plot); area.plot = plot; next.plotArea = area; let changed = false;
    const axis = (type: string, position: string) => {
        area.axes ??= [];
        let found = area.axes.find((a: any) => a.type === type && (a.position === position || (type === 'x' && a.position === undefined)));
        if (!found) { found = { type, position }; area.axes.push(found); } return found;
    };
    for (const side of ['x', 'y', 'secondary_y']) {
        const type = side === 'x' ? 'x' : 'y', position = side === 'x' ? 'bottom' : side === 'y' ? 'left' : 'right';
        for (const suffix of ['title', 'label_angle', 'min', 'max']) {
            const key = `${side}_axis_${suffix}`; if (updates[key] === undefined) continue;
            const target = axis(type, position); changed = true;
            if (suffix === 'title') target.title = { text: updates[key] };
            else if (suffix === 'label_angle') target.label = { ...object(target.label), angle: updates[key] };
            else target[suffix] = updates[key];
        }
    }
    if (updates.data_labels !== undefined) {
        const label = String(updates.data_labels);
        plot.labels = label === 'none' ? null : { series: label === 'series', category: label.includes('category'), value: label.includes('value'), percentage: label.includes('percentage'), ...(updates.data_label_position !== undefined ? { position: updates.data_label_position } : {}) }; changed = true;
    } else if (updates.data_label_position !== undefined && plot.labels) { plot.labels.position = updates.data_label_position; changed = true; }
    if (updates.stack !== undefined) {
        plot.extra = object(plot.extra);
        if (updates.stack === 'none') { if (!plot.type || plot.type === 'waterfall') plot.extra.stack = { enabled: false }; else delete plot.extra.stack; }
        else plot.extra.stack = { percentage: updates.stack === 'percent' }; changed = true;
    }
    if (updates.smooth !== undefined) { plot.extra = { ...object(plot.extra), smooth: updates.smooth }; changed = true; }
    if (updates.colors !== undefined || updates.color_palette !== undefined) { const colors = updates.colors ?? [updates.color_palette]; patch.style = { colorTheme: colors }; next.style = { ...object(next.style), colorTheme: colors }; }
    if (changed) patch.plotArea = area;
    const view = structuredClone(next); delete view.data;
    if (updates.data_labels === 'none') delete view.plotArea.plot.labels;
    return { patch, result: { viewModel: view } };
}
export function chartProgram(): WorkflowProgram {
    return { id: 'sheets-chart-update', version: 1, domain: 'sheets', risk: 'write', identities: ['user', 'bot'],
        step: async (state, context) => {
            const token = String(state.token), value = state.value as JsonObject, args = state.args as JsonObject;
            const call = (tool: string, input: JsonObject, write = false) => invokeSheetTool(context.lark, { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/invoke_${write ? 'write' : 'read'}`, body: { tool_name: tool, input: JSON.stringify(input) } });
            if (!state.snapshot) {
                const { operation: _, ...read } = value;
                const output = await call('get_chart_objects', read);
                return { done: false, state: { ...state, snapshot: chartSnapshot(output, String(args['chart-id'])) } };
            }
            const prepared = chartPatch(String(state.name), args, state.snapshot as JsonObject);
            const output = await call('manage_chart_object', { ...value, operation: 'update', properties: { snapshot: prepared.patch, ...(args['last-point-label'] !== undefined ? { last_point_label: args['last-point-label'] } : {}) } }, true);
            return { done: true, output: { ...output, ...prepared.result } };
        },
    };
}
