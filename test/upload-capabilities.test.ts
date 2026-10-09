import { expect, it, vi } from 'vitest';
import { uploadCapabilities } from '../src/capabilities/files/commands';
import { workflowCapability } from '../src/capabilities/workflow/resume';
import type { CommandContext } from '../src/ports/capabilities';

it('starts upload programs and resumes with the original selection after validating previews', async () => {
    const context = { grant: { id: 'grant' }, selection: { profileId: 'p', identity: 'bot' } } as CommandContext;
    const pending = { workflowId: 'workflow', status: 'pending' as const, selection: context.selection };
    const runner = { start: vi.fn(async () => pending), resume: vi.fn(async () => pending) };
    const commands = uploadCapabilities(runner);
    const drive = commands.find((item) => item.definition.id === 'drive.+upload')!;
    expect(await drive.preview({ file: 'artifact', name: 'report.txt' })).toMatchObject({ artifact: 'artifact', fields: { parent_type: 'explorer', parent_node: '' } });
    expect(runner.start).not.toHaveBeenCalled();
    await expect(drive.execute({ file: 'artifact', 'folder-token': 'a', 'wiki-token': 'b' }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(runner.start).not.toHaveBeenCalled();
    await drive.execute({ file: 'artifact', name: 'report.txt' }, context);
    expect(runner.start).toHaveBeenCalledWith('drive-upload', { phase: 'start', args: { file: 'artifact', name: 'report.txt' } }, context.selection, context.grant);
    await workflowCapability(runner).execute({ id: 'workflow' }, context);
    expect(runner.resume).toHaveBeenCalledWith('workflow', context.grant, context.selection);
});

it('allows read-only clients to reach workflow authorization without escalating permissions', () => {
    expect(workflowCapability({ start: vi.fn(), resume: vi.fn() }).definition.risk).toBe('read');
});
