import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
function command(action: string) { return baseCapabilities().find(c => c.definition.id === `base.+workflow-${action}`)!; }
function body() { return { client_token: 'unique', steps: [ { id: 'trigger', type: 'Trigger' }, { id: 'classify', type: 'AIClassificationBranch', data: { classes: [{ name: 'One', desc: '' }, { name: 'Two', desc: '' }], content: [{ value_type: 'ref', value: '$.trigger.value' }] }, children: { links: [{ kind: 'case', label: 'branch_1', desc: 'One', to: 'one' }, { kind: 'case', label: 'branch_2', desc: 'Two', to: 'two' }, { kind: 'case', label: 'default', to: 'other' }] } }, { id: 'one' }, { id: 'two' }, { id: 'other' } ] }; }
it.each(['create', 'update'])('validates classification and preserves workflow %s body', async action => {
    const request = vi.fn().mockResolvedValue({ workflow_id: 'wkf1' }); const json = body();
    expect(await command(action).execute({ 'base-token': 'b', 'workflow-id': 'wkf1', json }, { lark: { request } } as unknown as CommandContext)).toEqual({ workflow_id: 'wkf1' });
    expect(request.mock.calls[0]![0]).toEqual({ method: action === 'create' ? 'POST' : 'PUT', path: `/open-apis/base/v3/bases/b/workflows${action === 'create' ? '' : '/wkf1'}`, body: json });
});
it.each(['classes', 'content', 'mode', 'links', 'target', 'default', 'forward'])('rejects invalid classification %s before requests', async variant => {
    const json = body(); const step = json.steps[1]!;
    if (variant === 'classes') step.data!.classes[1]!.name = 'One';
    if (variant === 'content') step.data!.content = [{ value_type: 'text', value: ' ' }];
    if (variant === 'mode') Object.assign(step.data!, { mode: 'Exclusive' });
    if (variant === 'links') step.children!.links[0]!.label = 'other';
    if (variant === 'target') step.children!.links[1]!.to = 'one';
    if (variant === 'default') step.children!.links.pop();
    if (variant === 'forward') step.data!.content[0]!.value = '$.one.value';
    await expect(command('create').preview({ 'base-token': 'b', json })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('validates optional AI analysis fields and accepts omitted steps', async () => {
    for (const data of [{ analysis_table_names: [1] }, { identity_type: 'bot' }]) await expect(command('update').preview({ 'base-token': 'b', 'workflow-id': 'w', json: { steps: [{ type: 'AIAnalysisAction', data }] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await command('update').preview({ 'base-token': 'b', 'workflow-id': 'w', json: { title: 'Replace' } })).toMatchObject({ requests: [{ body: { title: 'Replace' } }] });
});
