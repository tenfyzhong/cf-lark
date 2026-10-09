import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { MailTransformer } from '../../ports/mail';
import { invalid, type Data } from './common';
import { readMailText } from './files';
export function lintPlan(args: Data): Data {
    const body = String(args.body ?? ''),
        file = String(args['body-file'] ?? '').trim();
    if (!!body.trim() === !!file)
        invalid('Provide exactly one body or body-file.');
    return {
        mode: 'local-lint-only',
        ...(file
            ? { artifactId: file.replace(/^@/, '') }
            : { body_source: 'flag' }),
    };
}
export async function lintMail(
    args: Data,
    context: CommandContext,
    artifacts: ArtifactFiles | undefined,
    transformer: MailTransformer | undefined,
): Promise<Data> {
    lintPlan(args);
    if (!transformer) invalid('Mail transformations are unavailable.');
    const body = args['body-file']
        ? await readMailText(
              String(args['body-file']),
              context,
              artifacts,
              8 << 20,
          )
        : String(args.body);
    const result = (await transformer.processMail({
        operation: 'lint',
        body,
    })) as Data;
    return {
        cleaned_html: result.cleaned_html ?? '',
        ...(args['show-lint-details']
            ? {
                  warnings: result.lint_applied ?? [],
                  errors: result.original_blocked ?? [],
              }
            : {}),
    };
}
