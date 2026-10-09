import { htmlProgram } from './html';
import { envPullProgram } from './env-pull';
import { syncPreviewProgram } from './sync';
import { databaseFilePrograms } from './db-files';
import { auditPrograms } from './audit';
import { sqlProgram } from './sql';
import { databasePrograms } from './db-workflows';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import { roleListProgram } from './roles';
import { appsTransferPrograms, type AppsTransferDependencies } from './transfers';
import { automationRequest, automationResult } from './automation';
export function appsPrograms(dependencies?: AppsTransferDependencies): WorkflowProgram[] {
    return [...auditPrograms(), ...databasePrograms(), roleListProgram(), ...(dependencies ? [htmlProgram(dependencies), envPullProgram(dependencies.artifacts), syncPreviewProgram(dependencies.artifacts), ...databaseFilePrograms(dependencies.artifacts), ...appsTransferPrograms(dependencies), sqlProgram(dependencies.artifacts)] : []), { id: 'apps-automation-list', version: 1, domain: 'apps', risk: 'read', identities: ['user'],
        async step(state, context) {
            const args = state.args as JsonObject, pages = Number(state.pages ?? 0), seen = state.seen as string[] ?? [];
            if (pages >= 100) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Automation pagination exceeded 100 pages.', 502);
            const request = automationRequest('list', args, `/open-apis/spark/v1/apps/${encodeURIComponent(String(args['app-id']).trim())}`, false);
            const response = await context.lark.request(request);
            const result = automationResult('list', args, response), items = [...(state.items as unknown[] ?? []), ...(result.items as unknown[])];
            const next = typeof response.page_token === 'string' ? response.page_token : typeof response.next_page_token === 'string' ? response.next_page_token : '';
            if (response.has_more !== true || !next) return { done: true, output: { items, has_more: false, page_token: null } };
            if (seen.includes(next)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Automation pagination repeated a cursor.', 502);
            return { done: false, state: { args: { ...args, 'page-token': next }, items, pages: pages + 1, seen: [...seen, next] } };
        },
    }];
}
