import { chartFlags } from './chart-flags.ts';
const styleFlags = ['background-color', 'font-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-line', 'horizontal-alignment', 'vertical-alignment', 'word-wrap', 'number-format'];
import type { CommandDefinition, JsonObject } from '../../domain/models';
export interface SheetSpec { name: string; tool: string; selector?: boolean; filter?: string; field?: string; write?: boolean; operation?: string; object?: boolean; extra?: Record<string, JsonObject> }
export const sheetSpecs: SheetSpec[] = [
    ...['batch-chart-create', 'batch-chart-update'].map(name => ({ name, tool: 'batch_update', write: true, extra: chartFlags[name] })),
    { name: 'workbook-export', tool: 'export', extra: { 'sheet-id': { type: 'string' }, 'file-extension': { type: 'string', enum: ['xlsx', 'csv'] }, 'output-path': { type: 'string' } } },
    { name: 'workbook-import', tool: 'import', write: true, extra: { file: { type: 'string' }, 'file-name': { type: 'string' }, name: { type: 'string' }, 'folder-token': { type: 'string' } } },
    ...['chart-create-basic', 'chart-config-update', 'chart-data-update'].map(name => ({ name, tool: 'manage_chart_object', write: true, selector: true, extra: chartFlags[name] })),
    ...['table-put', 'workbook-create'].map(name => ({ name, tool: 'set_cell_range', write: true, extra: { sheets: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }] }, styles: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }] }, ...(name === 'workbook-create' ? { title: { type: 'string' }, 'folder-token': { type: 'string' }, values: { anyOf: [{ type: 'array' }, { type: 'string' }] } } : {}) } })),
    { name: 'cells-set-image', tool: 'set_cell_range', write: true, selector: true, extra: { range: { type: 'string' }, image: { type: 'string' }, name: { type: 'string' } } },
    { name: 'table-get', tool: 'get_cell_ranges', extra: { 'sheet-id': { type: 'string' }, 'sheet-name': { type: 'string' }, range: { type: 'string' }, 'max-chars': { type: 'integer' }, 'output-path': { type: 'string' }, 'no-header': { type: 'boolean' } } },
    { name: 'styles-put', tool: 'batch_update', write: true, extra: { styles: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }] } } },
    { name: 'formula-verify', tool: 'verify_formula', extra: { 'sheet-id': { type: 'array', items: { type: 'string' } }, 'sheet-name': { type: 'array', items: { type: 'string' } }, range: { type: 'array', items: { type: 'string' } }, 'max-locations': { type: 'integer', minimum: 1 }, 'exit-on-error': { type: 'boolean' }, 'ai-only': { type: 'boolean' } } },
    ...['rows', 'cols'].map(axis => ({ name: `${axis}-resize`, tool: 'resize_range', selector: true, write: true, extra: { range: { type: 'string' }, type: { type: 'string', enum: ['pixel', 'standard', 'auto'] }, [axis === 'rows' ? 'height' : 'width']: { type: 'integer' }, [axis === 'rows' ? 'heights' : 'widths']: { anyOf: [{ type: 'object' }, { type: 'string' }] } } })),
    { name: 'batch-update', tool: 'batch_update', write: true, extra: { operations: { anyOf: [{ type: 'array', minItems: 1, maxItems: 100 }, { type: 'object' }, { type: 'string' }] }, 'continue-on-error': { type: 'boolean' } } },
    { name: 'csv-put', tool: 'set_range_from_csv', selector: true, write: true, extra: { range: { type: 'string' }, 'start-cell': { type: 'string' }, csv: { type: 'string' }, 'allow-overwrite': { type: 'boolean' } } },
    ...['cells-set-style', 'cells-batch-set-style', 'cells-batch-clear'].map(name => ({ name, tool: name === 'cells-set-style' ? 'set_cell_range' : 'batch_update', write: true, selector: name === 'cells-set-style', extra: {
        ...(name === 'cells-set-style' ? { range: { type: 'string' } } : { ranges: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } }),
        ...(name === 'cells-batch-clear' ? { scope: { type: 'string', enum: ['content', 'formats', 'all'] } } : { ...Object.fromEntries(styleFlags.map(flag => [flag, { type: flag === 'font-size' ? 'number' : 'string' }])), 'border-styles': { anyOf: [{ type: 'object' }, { type: 'string' }, { type: 'number' }] } }),
    } })),
    { name: 'cells-set', tool: 'set_cell_range', selector: true, write: true, extra: { range: { type: 'string' }, 'start-cell': { type: 'string' }, cells: { anyOf: ['array', 'object', 'string', 'number', 'boolean', 'null'].map(type => ({ type })) }, writes: { anyOf: [{ type: 'array' }, { type: 'object' }, { type: 'string' }] }, 'max-cells': { type: 'integer' }, 'allow-overwrite': { type: 'boolean' }, 'copy-to-range': { type: 'string' } } },
    { name: 'dim-delete', tool: 'modify_sheet_structure', write: true, selector: true, extra: { range: { type: 'string' }, ranges: { anyOf: [{ type: 'string' }, { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string' } }] } } },
    ...['set', 'update', 'delete'].map(action => ({ name: `dropdown-${action}`, tool: action === 'set' ? 'set_cell_range' : 'batch_update', selector: action === 'set', write: true, extra: {
        ...(action === 'set' ? { range: { type: 'string' } } : { ranges: { anyOf: [{ type: 'array', items: { type: 'string' }, maxItems: 100 }, { type: 'string' }] } }),
        ...(action === 'delete' ? {} : { options: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] }, colors: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] }, multiple: { type: 'boolean' }, highlight: { type: 'boolean' }, 'source-range': { type: 'string' } }),
    } })),
    ...['move', 'copy', 'fill', 'sort'].map(action => ({ name: `range-${action}`, tool: 'transform_range', selector: true, write: true, extra: action === 'sort' ? { range: { type: 'string' }, 'sort-keys': { anyOf: [{ type: 'array', items: { type: 'object', required: ['column', 'ascending'], properties: { column: { type: 'string' }, ascending: { type: 'boolean' } } } }, { type: 'string' }] }, 'has-header': { type: 'boolean' } } : {
        'source-range': { type: 'string' }, 'target-range': { type: 'string' },
        ...(action !== 'fill' ? { 'target-sheet-id': { type: 'string' } } : { 'series-type': { type: 'string', enum: ['copy', 'linear', 'growth', 'date', 'auto'] } }),
        ...(action === 'copy' ? { 'paste-type': { type: 'string', enum: ['values', 'formulas', 'formats', 'all'] } } : {}),
    } })),
    { name: 'float-image-create', tool: 'manage_float_image_object', write: true, selector: true, extra: Object.fromEntries(['image', 'image-name', 'image-token', 'image-uri', 'position-col'].map(key => [key, { type: 'string' }]).concat(['position-row', 'size-width', 'size-height', 'offset-row', 'offset-col', 'z-index'].map(key => [key, { type: 'integer' }]))) },
    { name: 'float-image-update', tool: 'manage_float_image_object', write: true, selector: true, filter: 'float-image-id', field: 'float_image_id', extra: Object.fromEntries(['image-name', 'image-token', 'image-uri', 'position-col'].map(key => [key, { type: 'string' }]).concat(['position-row', 'size-width', 'size-height', 'offset-row', 'offset-col', 'z-index'].map(key => [key, { type: 'integer' }]))) },
    ...['search', 'replace'].map(action => ({ name: `cells-${action}`, tool: action === 'search' ? 'search_data' : 'replace_data', selector: true, write: action === 'replace', extra: {
        find: { type: 'string' }, range: { type: 'string' }, 'match-case': { type: 'boolean' }, 'match-entire-cell': { type: 'boolean' }, regex: { type: 'boolean' }, 'include-formulas': { type: 'boolean' },
        ...(action === 'search' ? { 'max-matches': { type: 'integer' }, offset: { type: 'integer' } } : { replacement: { type: 'string' } }),
    } })),
    { name: 'sheet-move', tool: 'modify_workbook_structure', write: true, selector: true, extra: { index: { type: 'integer', minimum: 0 }, 'source-index': { type: 'integer', minimum: 0 } } },
    { name: 'dim-move', tool: 'native_move_dimension', write: true, selector: true, extra: { 'source-range': { type: 'string' }, target: { type: 'string' } } },
    { name: 'pivot-create', tool: 'manage_pivot_table_object', object: true, write: true, extra: { properties: { anyOf: [{ type: 'object' }, { type: 'string' }] }, source: { type: 'string' }, range: { type: 'string' }, 'target-position': { type: 'string' }, 'target-sheet-id': { type: 'string' }, 'target-sheet-name': { type: 'string' } } },
    ...['create', 'update', 'delete'].map(action => ({ name: `filter-${action}`, tool: 'manage_filter_object', selector: true, object: true, write: true, extra: action === 'delete' ? {} : { range: { type: 'string' }, properties: { anyOf: [{ type: 'object' }, { type: 'string' }] } } })),
    ...['cells-get', 'csv-get', 'cond-format-result-get'].map(name => ({ name, tool: name === 'csv-get' ? 'get_range_as_csv' : 'get_cell_ranges', selector: true, extra: {
        range: { type: 'string' }, 'max-chars': { type: 'integer' },
        ...(name !== 'cond-format-result-get' ? { 'output-path': { type: 'string' }, 'skip-hidden': { type: 'boolean' } } : {}),
        ...(name === 'cells-get' ? { include: { type: 'array', items: { type: 'string', enum: ['value', 'formula', 'style', 'comment', 'data_validation', 'truncation', 'conditional_format'] } } } : {}),
        ...(name === 'csv-get' ? { 'include-row-prefix': { type: 'boolean' } } : {}),
    } })),
    ...[
        ['chart', 'chart', 'chart-id', 'chart_id'], ['pivot', 'pivot_table', 'pivot-table-id', 'pivot_table_id'],
        ['cond-format', 'conditional_format', 'rule-id', 'conditional_format_id'], ['sparkline', 'sparkline', 'group-id', 'group_id'],
        ['filter-view', 'filter_view', 'view-id', 'view_id'], ['float-image', 'float_image', 'float-image-id', 'float_image_id'],
    ].flatMap(([name, tool, filter, field]) => (name === 'float-image' ? ['delete'] : name === 'pivot' ? ['update', 'delete'] : ['create', 'update', 'delete']).map(action => ({
        name: `${name}-${action}`, tool: `manage_${tool}_object`, write: true, selector: true, object: true,
        filter: action === 'create' ? undefined : filter, field, extra: action === 'delete' ? {} : {
            properties: { anyOf: [{ type: 'object' }, { type: 'string', minLength: 1 }] },
            ...(name === 'cond-format' ? { 'rule-type': { type: 'string' }, ranges: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } } : {}),
            ...(name === 'filter-view' ? { range: { type: 'string' }, 'view-name': { type: 'string' } } : {}),
        },
    }))),
    { name: 'sheet-info', tool: 'get_sheet_structure', selector: true, extra: { range: { type: 'string' }, include: { type: 'array', items: { type: 'string', enum: ['merges', 'row_heights', 'col_widths', 'hidden_rows', 'hidden_cols', 'groups', 'frozen'] } } } },
    { name: 'dropdown-get', tool: 'get_cell_ranges', selector: true, extra: { range: { type: 'string', minLength: 1 } } },
    ...['hide', 'unhide', 'group', 'ungroup', 'insert', 'freeze'].map(action => ({ name: `dim-${action}`, tool: 'modify_sheet_structure', write: true, selector: true,
        extra: action === 'freeze' ? { rows: { type: 'integer', minimum: 0 }, cols: { type: 'integer', minimum: 0 }, dimension: { type: 'string', enum: ['row', 'column'] }, count: { type: 'integer', minimum: 0 } }
            : action === 'insert' ? { position: { type: 'string' }, count: { type: 'integer', minimum: 1 }, 'inherit-style': { type: 'string', enum: ['before', 'after'] } }
            : { range: { type: 'string' }, ...(['group', 'ungroup'].includes(action) ? { depth: { type: 'integer' } } : {}), ...(action === 'group' ? { 'group-state': { type: 'string', enum: ['expand', 'fold'] } } : {}) },
    })),
    ...['clear', 'merge', 'unmerge'].map(action => ({ name: `cells-${action}`, tool: action === 'clear' ? 'clear_cell_range' : 'merge_cells', write: true, selector: true, extra: {
        range: { type: 'string', minLength: 1 }, ...(action === 'clear' ? { scope: { type: 'string', enum: ['content', 'formats', 'all'] } } : {}), ...(action === 'merge' ? { 'merge-type': { type: 'string', enum: ['all', 'rows', 'columns'] } } : {}),
    } })),
    ...['create', 'delete', 'rename', 'copy', 'hide', 'unhide', 'set-tab-color', 'show-gridline', 'hide-gridline'].map(action => ({
        name: `sheet-${action}`, tool: 'modify_workbook_structure', selector: action !== 'create', write: true,
        operation: action === 'copy' ? 'duplicate' : action.replaceAll('-', '_'),
        extra: {
            ...(['create', 'rename', 'copy'].includes(action) ? { title: { type: 'string', minLength: 1 } } : {}),
            ...(['create', 'copy'].includes(action) ? { index: { type: 'integer' } } : {}),
            ...(action === 'create' ? { type: { type: 'string', enum: ['sheet'] }, 'row-count': { type: 'integer', minimum: 0, maximum: 50000 }, 'col-count': { type: 'integer', minimum: 0, maximum: 200 } } : {}),
            ...(action === 'set-tab-color' ? { color: { type: 'string' } } : {}),
        },
    })),
    ...['workbook-info', 'sheet-list', 'revision-get'].map(name => ({ name, tool: 'get_workbook_structure' })),
    { name: 'changeset-get', tool: 'get_changeset', extra: { 'start-revision': { type: 'integer', minimum: 1 }, 'end-revision': { type: 'integer' } } },
    { name: 'history-list', tool: 'history_list', extra: { 'end-version': { type: 'integer' } } },
    { name: 'history-revert', tool: 'history_revert', write: true, extra: { 'history-version-id': { type: 'string', minLength: 1 } } },
    { name: 'history-revert-status', tool: 'history_revert_status', extra: { 'transaction-id': { type: 'string', minLength: 1 } } },
    ...[
        ['chart', 'chart', 'chart-id', 'chart_id'], ['pivot', 'pivot_table', 'pivot-table-id', 'pivot_table_id'],
        ['cond-format', 'conditional_format', 'rule-id', 'conditional_format_id'], ['filter', 'filter', '', ''],
        ['filter-view', 'filter_view', 'view-id', 'view_id'], ['sparkline', 'sparkline', 'group-id', 'group_id'],
        ['float-image', 'float_image', 'float-image-id', 'float_image_id'],
    ].map(([name, tool, filter, field]) => ({ name: `${name}-list`, tool: `get_${tool}_objects`, selector: true, filter, field })),
];
const string = { type: 'string', minLength: 1 };
export const sheetsDefinitions: CommandDefinition[] = sheetSpecs.map(spec => ({
    id: `sheets.+${spec.name}`, domain: 'sheets', source: 'shortcut', risk: spec.write ? 'write' : 'read', identities: ['user', 'bot'],
    scopes: spec.name === 'workbook-import' ? ['docs:document.media:upload', 'docs:document:import'] : [
        `sheets:spreadsheet:${spec.write ? 'write_only' : 'read'}`,
        ...(['chart-config-update', 'chart-data-update', 'batch-chart-update', 'table-put', 'sheet-move', 'dim-move'].includes(spec.name) ? ['sheets:spreadsheet:read'] : []),
        ...(spec.name === 'workbook-create' ? ['sheets:spreadsheet:create'] : []),
        ...(spec.name === 'workbook-export' ? ['docs:document:export', 'drive:drive.metadata:readonly'] : []),
        ...(spec.name === 'cells-set-image' ? ['drive:file:upload'] : []),
    ],
    description: `${spec.name.replaceAll('-', ' ')}. Wiki locators require wiki:node:read. Omitted sheet selectors require a workbook with exactly one named sheet.${spec.name === 'history-revert' ? ' Replaces workbook content asynchronously; poll history-revert-status.' : ''}`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        ...(!['workbook-create', 'workbook-import'].includes(spec.name) ? { url: string, 'spreadsheet-token': string, token: string } : {}),
        ...(spec.selector ? { 'sheet-id': string, 'sheet-name': string } : {}),
        ...(spec.filter ? { [spec.filter]: string } : {}), ...structuredClone(spec.extra ?? {}), ...(spec.name === 'chart-create' ? { 'print-example': { type: 'string' } } : {}),
    } },
}));
