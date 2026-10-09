import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
function fixture(name: string, data: any) {
    const request = vi.fn().mockResolvedValue(data), c = appsCapabilities().find((c) => c.definition.id === `apps.+${name}`)!;
    return { request, run: (args = {}) => c.execute({ 'app-id': 'a', ...args }, { lark: { request } } as any) };
}
it('normalizes log filters and preserves nanosecond precision', async () => {
    const f = fixture('log-list', { logItems: [{ logId: 'l', severityText: 'ERROR', attributes: [{ key: 'module', value: 'm' }] }], nextPageToken: 'n', hasMore: true });
    expect(await f.run({ since: '2026-10-01T00:00:00.123456789Z', level: [' error ', 'warn'], 'trace-id': [' t ', 't'], module: ' m ', 'min-duration': 0 })).toMatchObject({ items: [{ log_id: 'l', level: 'ERROR', attributes: { module: 'm' } }], page_token: 'n', has_more: true });
    expect(f.request.mock.calls[0]![0].body).toEqual({ app_env: 'runtime', limit: 50, start_timestamp_ns: '1790812800123456789', filter: { levels: ['ERROR', 'WARN'], trace_ids: ['t'], modules: ['m'], min_duration_ms: 0 } });
});
it('validates environment, pagination and duration ordering before IO', async () => {
    for (const args of [{ environment: 'dev' }, { 'page-size': 101 }, { 'min-duration': 3, 'max-duration': 2 }, { since: '2026-10-09', until: '2026-10-01' }]) {
        const f = fixture('log-list', {}); await expect(f.run(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
    }
});
it('resolves source stacks for error log detail with nested release metadata', async () => {
    const f = fixture('log-get', {});
    f.request.mockResolvedValueOnce({ items: [{ level: 'ERROR', attributes: [{ key: 'release_commit_id', value: 'c' }], message: 'Error\n at run (https://site/a.js:2:3)' }] }).mockResolvedValueOnce({ frames: [{ source: 'a.ts' }] });
    expect(await f.run({ 'log-id': 'l' })).toMatchObject({ source_stack_status: 'resolved', source_stack: [{ source: 'a.ts' }] });
    expect(f.request.mock.calls[1]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/a/resolve_stack_trace', body: { commit_id: 'c', source_map_file_prefix: 'client/assets/', frames: [{ file_name: 'a.js', line: 2, column: 3, function: 'run' }] } });
});
it('groups trace spans and compares integer timestamps without precision loss', async () => {
    const f = fixture('trace-list', { spans: [{ traceId: 't', spanId: 'c', parentSpanId: 'r', startTimeNs: '1790812800123456789', durationMs: 2, status: 'ERROR' }, { traceId: 't', spanId: 'r', name: 'root', startTimeNs: '1790812800123456788', durationMs: 5 }] });
    expect(await f.run()).toMatchObject({ items: [{ trace_id: 't', span_count: 2, root_span: 'root', start_time_ns: '1790812800123456788', duration_ms: 5, status: 'ERROR' }], has_more: false });
});
it('normalizes trace detail aliases and span attributes', async () => {
    const f = fixture('trace-get', { traceDetail: { isBreak: false, spans: [{ traceId: 't', spanId: 's', attributes: [{ key: 'duration_ms', value: 9 }] }] } });
    expect(await f.run({ 'trace-id': 't' })).toMatchObject({ trace_id: 't', is_break: false, spans: [{ span_id: 's', duration_ms: 9 }] });
});
it('maps metrics and merges nested points with request-specific zero fill', async () => {
    const f = fixture('metric-list', { series: [{ name: 'client_api_request_count', points: [{ timestamp: '1', value: 5, dimensions: [{ key: 'page', value: '/' }] }] }] });
    expect(await f.run({ metric: 'requests', since: '2026-10-01T00:00:00Z', until: '2026-10-01T01:00:00Z' })).toEqual({ items: [{ timestamp: '1', dimensions: { page: '/' }, values: { total: 5, error: 0 } }], has_more: false });
    expect(f.request.mock.calls[0]![0].body.down_sample).toBe('1m');
    expect(f.request.mock.calls[0]![0].body.metric_names).toEqual(['client_api_request_count', 'client_api_request_error_count']);
});
it('analytics fills only partially present rows and rejects device conflicts', async () => {
    const f = fixture('analytics-list', { points: [{ timestamp_ns: '1', values: { ACTIVE_USER: 3 } }, { timestamp_ns: '2', values: {} }] });
    expect(await f.run({ analytics: 'users' })).toEqual({ items: [{ timestamp_ns: '1', dimensions: {}, values: { 'active-users': 3, 'new-users': 0, 'total-users': 0 } }, { timestamp_ns: '2', dimensions: {}, values: {} }], has_more: false });
    await expect(f.run({ analytics: 'page-view', series: 'desktop', 'device-type': 'mobile' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('accepts flexible raw log arrays and nested data arrays without dropping envelopes', async () => {
    for (const response of [[{ id: 'l' }], { code: 0, data: [{ id: 'l' }], has_more: false }, { code: 0, data: { items: [{ id: 'l' }] } }]) {
        const f = fixture('log-get', response);
        expect(await f.run({ 'log-id': 'l' })).toMatchObject({ log_id: 'l' });
        expect(f.request.mock.calls[0]![0].responseMode).toBe('envelope');
    }
});
it('preserves fractional timezone-free timestamps using UTC cloud semantics', async () => {
    const f = fixture('log-list', {});
    await f.run({ since: '2026-10-01T00:00:00.123' });
    expect(f.request.mock.calls[0]![0].body.start_timestamp_ns).toBe('1790812800123000000');
});
it('uses one-minute fallback for an explicitly blank down-sample', async () => {
    const f = fixture('metric-list', {}); await f.run({ metric: 'cpu', 'down-sample': '' });
    expect(f.request.mock.calls[0]![0].body.down_sample).toBe('1m');
});
