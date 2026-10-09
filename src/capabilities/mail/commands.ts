import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { mailDefinitions } from './definitions';
import { managePlan, manageProgram } from './manage';
import { readPlan, readProgram } from './read';
import { deliveryPlan, deliveryProgram, signatureOutput } from './delivery';
import { rulePlan, ruleProgram } from './rules';
import { triagePlan, triageProgram } from './triage';
import { watchPlan, watchProgram } from './watch';
import { lintPlan, lintMail } from './lint';
import { composePlan, composeProgram } from './compose';
import { templatePlan, templateProgram } from './templates';
import { draftPlan, draftProgram } from './edit';
import type { MailTransformer } from '../../ports/mail';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { RemoteFiles } from '../../ports/remote-files';
import type { EventInbox } from '../../ports/events';
import type { ApiRequest } from '../../ports/lark';
export function mailCapabilities(
    workflows: WorkflowRunner,
    artifacts?: ArtifactFiles,
    transformer?: MailTransformer,
): Capability[] {
    return mailDefinitions.map((definition) => {
        const action = definition.id.split('.+')[1]!;
        const reading = ['message', 'messages', 'thread'].includes(action),
            delivery = ['signature', 'share-to-chat', 'draft-send'].includes(
                action,
            ),
            rules = action.startsWith('rule-'),
            compose = [
                'send',
                'draft-create',
                'reply',
                'reply-all',
                'forward',
                'send-receipt',
            ].includes(action),
            plan = action.startsWith('template-')
                ? templatePlan
                : compose
                  ? composePlan
                  : action === 'draft-edit'
                    ? (
                          _action: string,
                          args: Record<string, unknown>,
                          context?: Parameters<typeof draftPlan>[1],
                      ) => draftPlan(args, context)
                    : action === 'lint-html'
                      ? (_action: string, args: Record<string, unknown>) =>
                            lintPlan(args)
                      : action === 'watch'
                        ? (_action: string, args: Record<string, unknown>) =>
                              watchPlan(args)
                        : action === 'triage'
                          ? (
                                _action: string,
                                args: Record<string, unknown>,
                                context?: Parameters<typeof triagePlan>[1],
                            ) => triagePlan(args, context)
                          : rules
                            ? rulePlan
                            : delivery
                              ? deliveryPlan
                              : reading
                                ? readPlan
                                : managePlan;
        return {
            definition,
            preview: async (args, context) => plan(action, args, context),
            execute: async (args, context) => {
                const preview = plan(action, args, context);
                if (action === 'lint-html')
                    return lintMail(args, context, artifacts, transformer);
                if (action === 'signature')
                    return signatureOutput(
                        await context.lark.request(
                            preview.requests[0] as ApiRequest,
                        ),
                        args.detail as string | undefined,
                    );
                return workflows.start(
                    action.startsWith('template-')
                        ? 'mail-template'
                        : compose
                          ? 'mail-compose'
                          : action === 'draft-edit'
                            ? 'mail-draft-edit'
                            : action === 'watch'
                              ? 'mail-watch'
                              : action === 'triage'
                                ? 'mail-triage'
                                : rules
                                  ? definition.risk === 'read'
                                      ? 'mail-rules-read'
                                      : 'mail-rules'
                                  : delivery
                                    ? 'mail-delivery'
                                    : reading
                                      ? 'mail-read'
                                      : 'mail-manage',
                    { action, args, phase: 'start' },
                    context.selection,
                    context.grant,
                );
            },
        };
    });
}
export function mailPrograms(
    artifacts?: ArtifactFiles,
    inbox?: Pick<EventInbox, 'read'>,
    transformer?: MailTransformer,
    remote?: RemoteFiles,
): WorkflowProgram[] {
    return [
        templateProgram(artifacts, transformer),
        manageProgram(),
        readProgram(),
        deliveryProgram(),
        ruleProgram(false, artifacts),
        ruleProgram(true, artifacts),
        triageProgram(),
        composeProgram(artifacts, transformer, remote),
        draftProgram(artifacts, transformer, remote),
        ...(inbox ? [watchProgram(inbox, artifacts)] : []),
    ];
}
