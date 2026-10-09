import { describe, expect, it, vi } from 'vitest';
import { okrCapabilities } from '../src/capabilities/okr/commands';
import type { CommandContext } from '../src/ports/capabilities';
type Data = Record<string, any>;
async function execute(action: string, args: Data, data: Data = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = okrCapabilities().find(item => item.definition.id === `okr.+${action}`)!;
    const context = { lark: { request } } as unknown as CommandContext;
    const preview = await capability.preview(args); expect(request).not.toHaveBeenCalled();
    return { output: await capability.execute(args, context) as Data, request, preview };
}
describe('OKR direct shortcuts', () => {
    it('creates objective rich content with numeric IDs kept as strings and query fields preserved', async () => {
        const { request, output } = await execute('create', { level: 'objective', 'cycle-id': '9223372036854775807', content: { text: ' Ship @{ou_a} now ', mention: ['ou_a'] }, notes: { text: 'Notes' }, 'category-id': '77' }, { objective_id: '9' });
        expect(request.mock.calls[0]![0]).toMatchObject({ method: 'POST', path: '/open-apis/okr/v2/cycles/9223372036854775807/objectives', query: { cycle_id: '9223372036854775807', user_id_type: 'open_id' }, body: { category_id: '77', content: { blocks: [{ block_element_type: 'paragraph', paragraph: { elements: [{ paragraph_element_type: 'textRun', text_run: { text: 'Ship now' } }, { paragraph_element_type: 'mention', mention: { user_id: 'ou_a' } }] } }] } } });
        expect(output).toEqual({ level: 'objective', objective_id: '9' });
    });
    it('converts v2 content into v1 progress records and preserves zero progress', async () => {
        const { request } = await execute('progress-create', { 'target-id': '1', 'target-type': 'objective', content: { text: 'Started', mention: ['ou_a'] }, 'progress-percent': '0', 'progress-status': 'normal', 'source-url': 'https://example.test/source' }, { progress_id: '2' });
        expect(request.mock.calls[0]![0].body).toMatchObject({ target_id: '1', target_type: 2, progress_rate: { percent: 0, status: 0 }, source_url: 'https://example.test/source', content: { blocks: [{ type: 'paragraph', paragraph: { elements: [{ type: 'textRun', textRun: { text: 'Started' } }, { type: 'person', person: { openId: 'ou_a' } }] } }] } });
    });
    it('groups comments by selection and sorts threads while formatting timestamps', async () => {
        const { output } = await execute('comment-list', { 'target-id': '1', 'target-type': 'objective' }, { items: [{ id: '2', create_time: '2000', selection: { id: 's' }, content: { blocks: [] } }, { id: '1', create_time: '1000', selection: { id: 's' } }, { id: '3', create_time: '3000' }], has_more: true, page_token: 'next' });
        expect(output.comments.map((items: Data[]) => items.map(item => item.id))).toEqual([['1', '2'], ['3']]);
        expect(output.comments[0][0].create_time).toBe('1970-01-01 00:00:01');
        expect(output.has_more).toBe(true);
    });
    it('creates wildcard selection based on Unicode characters instead of UTF-16 code units', async () => {
        const { request } = await execute('comment-create', { 'target-id': '1', 'target-type': 'objective', content: { text: 'A😀' }, 'select-all': true }, { comment: { id: '2' } });
        expect(request.mock.calls[0]![0].body.selected_text).toBe('**');
    });
    it('filters only the returned cycle page and retains its cursor', async () => {
        const { output, request } = await execute('cycle-list', { 'user-id': 'ou_me', 'time-range': '2026-10--2026-10', 'page-size': 10 }, { items: [{ id: '1', start_time: String(Date.parse('2026-10-01')), end_time: String(Date.parse('2026-10-31')), cycle_status: 1 }, { id: '2', start_time: '0', end_time: '1000' }], has_more: true, page_token: 'next' });
        expect(request).toHaveBeenCalledTimes(1); expect(output.cycles).toHaveLength(1); expect(output.page_token).toBe('next');
    });
    it.each([
        ['create', { level: 'key-result', 'objective-id': '1', notes: { text: 'Invalid' }, content: { text: 'Title' } }],
        ['create', { level: 'objective', 'cycle-id': '9223372036854775808', content: { text: 'Title' } }],
        ['patch', { level: 'objective', 'target-id': '1', score: '0.51' }],
        ['progress-create', { 'target-id': '1', 'target-type': 'objective', content: { text: 'Title' }, 'progress-status': 'done' }],
        ['comment-create', { 'target-id': '1', 'target-type': 'objective', content: { text: 'Title' } }],
        ['comment-create', { 'target-id': '1', 'target-type': 'cycle', content: { text: 'Title' }, 'select-all': true }],
    ])('rejects invalid %s before I/O', async (action, args) => {
        const capability = okrCapabilities().find(item => item.definition.id === `okr.+${action}`)!;
        await expect(capability.preview(args as Data)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

it.each([
    { content: { text: 'Title', unexpected: true } },
    { style: 'richtext', content: { blocks: [] } },
    { style: 'richtext', content: { blocks: [{ block_element_type: 'paragraph', paragraph: { elements: [] } }] } },
])('rejects invalid create content shape: $content', async args => {
    const capability = okrCapabilities().find(item => item.definition.id === 'okr.+create')!;
    await expect(capability.preview({ level: 'objective', 'cycle-id': '1', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it.each([
    { action: 'progress-get', args: { 'progress-id': '1', style: 'richtext' }, method: 'GET', path: '/open-apis/okr/v1/progress_records/1', data: { progress_id: '1', modify_time: '1000', content: { blocks: [{ type: 'paragraph', paragraph: { elements: [{ type: 'textRun', textRun: { text: 'Text' } }] } }] } } },
    { action: 'progress-list', args: { 'target-id': '1', 'target-type': 'key_result', 'department-id-type': 'department_id', 'page-token': 'next' }, method: 'GET', path: '/open-apis/okr/v2/key_results/1/progresses', data: { items: [{ id: '2', progress_rate: { progress_percent: 20, progress_status: 1 } }] } },
    { action: 'progress-update', args: { 'progress-id': '1', content: { text: 'Updated' }, 'progress-percent': '50', 'progress-status': 'done' }, method: 'PUT', path: '/open-apis/okr/v1/progress_records/1', data: { progress_id: '1' } },
    { action: 'progress-delete', args: { 'progress-id': '1' }, method: 'DELETE', path: '/open-apis/okr/v1/progress_records/1', data: {} },
    { action: 'patch', args: { level: 'key-result', 'target-id': '1', score: '0', deadline: '1790812800000' }, method: 'PATCH', path: '/open-apis/okr/v2/key_results/1', data: {} },
    ...['get', 'patch', 'delete', 'solve', 'reopen'].map(action => ({ action: `comment-${action}`, args: { 'comment-id': '1', ...(action === 'patch' ? { content: { text: 'Updated' } } : {}) }, method: action === 'get' ? 'GET' : action === 'patch' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST', path: `/open-apis/okr/v2/comments/1${['solve', 'reopen'].includes(action) ? `/${action}` : ''}`, data: { comment: { id: '1' } } })),
])('executes $action with its exact endpoint and verb', async ({ action, args, method, path, data }) => {
    const { request } = await execute(action, args, data);
    expect(request.mock.calls[0]![0]).toMatchObject({ method, path });
});
