import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Copy pinned pure mail code into the isolated module; never modify upstream. */
export async function prepareMailSources(
    source: string,
    directory: string,
): Promise<void> {
    const packages: Record<string, string> = {
        'shortcuts/mail/lint': 'maillint',
        'shortcuts/mail/emlbuilder': 'maileml',
        'shortcuts/mail/filecheck': 'mailfilecheck',
        'shortcuts/mail/ics': 'mailics',
        'shortcuts/mail/draft': 'maildraft',
        'extension/fileio': 'mailfileio',
        'internal/validate': 'mailvalidate',
    };
    const rewrite = (value: string) => {
        for (const [original, target] of Object.entries(packages))
            value = value.replaceAll(
                `github.com/larksuite/cli/${original}`,
                `github.com/larksuite/cli/shortcuts/doc/internal/${target}`,
            );
        return value;
    };
    for (const [original, target] of Object.entries(packages)) {
        const dest = join(directory, 'internal', target);
        await mkdir(dest, { recursive: true });
        if (original === 'internal/validate') {
            await writeFile(
                join(dest, 'cloud.go'),
                'package validate\nimport("fmt";"strings")\nfunc SafeInputPath(string)(string,error){return "",fmt.Errorf("filesystem paths are unavailable; provide private artifact bytes")}\nfunc RejectCRLF(value,fieldName string)error{if strings.ContainsAny(value,"\\r\\n"){return fmt.Errorf("%s contains invalid line break characters",fieldName)};return nil}\n',
            );
            continue;
        }
        for (const file of await readdir(join(source, original))) {
            if (
                !file.endsWith('.go') ||
                file.endsWith('_test.go') ||
                file === 'service.go' ||
                (original === 'extension/fileio' && file !== 'types.go')
            )
                continue;
            await writeFile(
                join(dest, file),
                rewrite(await readFile(join(source, original, file), 'utf8')),
            );
        }
    }
    const helpers = await readFile(
        join(source, 'shortcuts/mail/helpers.go'),
        'utf8',
    );
    const extractType = (name: string) => {
        const start = helpers.indexOf(`type ${name} struct {`);
        const end = helpers.indexOf('\n}', start) + 2;
        if (start < 0 || end < 2) throw Error('Pinned mail model missing.');
        return helpers.slice(start, end);
    };
    const quote = rewrite(
        (
            await readFile(join(source, 'shortcuts/mail/mail_quote.go'), 'utf8')
        ).replace('package mail', 'package main'),
    );
    await writeFile(
        join(directory, 'mail_quote.go'),
        quote +
            '\n' +
            extractType('originalMessage') +
            '\n' +
            extractType('mailAddressPair') +
            '\n',
    );
    const editSource = await readFile(
        join(source, 'shortcuts/mail/mail_draft_edit.go'),
        'utf8',
    );
    const templateStart = editSource.indexOf(
        'func buildDraftEditPatchTemplate()',
    );
    const templateEnd = editSource.indexOf('\n}', templateStart) + 2;
    if (templateStart < 0 || templateEnd < 2)
        throw Error('Pinned draft patch template missing.');
    await writeFile(
        join(directory, 'mail_patch_template.go'),
        'package main\n' + editSource.slice(templateStart, templateEnd) + '\n',
    );
    const extractFunction = (text: string, name: string) => {
        const start = text.indexOf(`func ${name}(`);
        const end = text.indexOf('\n}', start) + 2;
        if (start < 0 || end < 2)
            throw Error(`Pinned mail function missing: ${name}`);
        return text.slice(start, end);
    };
    const largeSource = await readFile(
        join(source, 'shortcuts/mail/large_attachment.go'),
        'utf8',
    );
    const constantsStart = largeSource.indexOf(
        'const (',
        largeSource.indexOf('func buildLargeAttachmentPreviewURL'),
    );
    const constantsEnd = largeSource.indexOf('\n)', constantsStart) + 2;
    const largeFunctions = [
        'brandDisplayName',
        'buildLargeAttachmentItems',
        'buildLargeAttachmentHTML',
        'buildLargeAttachmentPlainText',
        'fileTypeIcon',
    ]
        .map((name) => extractFunction(largeSource, name))
        .join('\n');
    const commonSource = await readFile(
        join(source, 'shortcuts/common/common.go'),
        'utf8',
    );
    const largeGo =
        'package main\nimport("fmt";"strings";"time";"path/filepath";"net/url")\ntype largeAttachmentResult struct { FileName string; FileSize int64; FileToken string }\nfunc buildLargeAttachmentPreviewURL(brand string,token string) string {domain:="feishu.cn";if brand=="lark"{domain="larksuite.com"};return "https://www."+domain+"/mail/page/attachment?token="+url.QueryEscape(token)}\n' +
        largeSource.slice(constantsStart, constantsEnd) +
        '\n' +
        largeFunctions +
        '\n' +
        extractFunction(commonSource, 'FormatSize').replace(
            'func FormatSize(',
            'func mailFormatSize(',
        );
    await writeFile(
        join(directory, 'mail_large.go'),
        largeGo
            .replaceAll('core.LarkBrand', 'string')
            .replaceAll('core.BrandLark', '"lark"')
            .replaceAll('common.FormatSize', 'mailFormatSize'),
    );
    const receiptSource = await readFile(
        join(source, 'shortcuts/mail/mail_send_receipt.go'),
        'utf8',
    );
    const labelsStart = receiptSource.indexOf(
            'type receiptMetaLabelSet struct {',
        ),
        labelsEnd = receiptSource.indexOf('\n}', labelsStart) + 2;
    await writeFile(
        join(directory, 'mail_receipt.go'),
        'package main\nimport("fmt";"strings";"time")\n' +
            receiptSource.slice(labelsStart, labelsEnd) +
            '\n' +
            [
                'receiptMetaLabels',
                'buildReceiptSubject',
                'renderReceiptTime',
                'buildReceiptTextBody',
                'buildReceiptHTMLBody',
            ]
                .map((name) => extractFunction(receiptSource, name))
                .join('\n'),
    );
    let ensureCards = extractFunction(
        largeSource,
        'ensureLargeAttachmentCards',
    ).replace(
        'runtime *common.RuntimeContext, snapshot *draftpkg.DraftSnapshot',
        'brand string, snapshot *draftpkg.DraftSnapshot',
    );
    const setupStart = ensureCards.indexOf('\n\tbrand := '),
        setupEnd = ensureCards.indexOf('\n\thtmlPart := ', setupStart);
    ensureCards =
        ensureCards.slice(0, setupStart) +
        '\n\tlang := "en"\n' +
        ensureCards.slice(setupEnd);
    const draftLarge =
        'package main\nimport("encoding/base64";"encoding/json";"strings";draftpkg "github.com/larksuite/cli/shortcuts/mail/draft")\nconst base64MIMEOverhead = 200\ntype largeAttID struct {ID string `json:"id"`}\n' +
        [
            'snapshotEMLBaseSize',
            'flattenSnapshotParts',
            'injectLargeAttachmentHTMLIntoSnapshot',
            'injectLargeAttachmentTextIntoSnapshot',
            'normalizeLargeAttachmentHeader',
            'estimateBase64EMLSize',
        ]
            .map((name) => extractFunction(largeSource, name))
            .join('\n') +
        '\n' +
        ensureCards;
    await writeFile(
        join(directory, 'mail_draft_large.go'),
        rewrite(draftLarge.replaceAll('core.LarkBrand', 'string')),
    );
    const templateSource = await readFile(
        join(source, 'shortcuts/mail/template_compose.go'),
        'utf8',
    );
    const templateGo =
        'package main\nimport("strings";draftpkg "github.com/larksuite/cli/shortcuts/mail/draft")\ntype templateShortcutKind string\nconst(templateShortcutSend templateShortcutKind="send";templateShortcutDraftCreate templateShortcutKind="draft-create";templateShortcutReply templateShortcutKind="reply";templateShortcutReplyAll templateShortcutKind="reply-all";templateShortcutForward templateShortcutKind="forward")\ntype templatePayload struct {TemplateContent string `json:"template_content"`;IsPlainTextMode bool `json:"is_plain_text_mode"`}\n' +
        extractFunction(templateSource, 'mergeTemplateBody');
    await writeFile(
        join(directory, 'mail_template_body.go'),
        rewrite(templateGo),
    );
    await writeFile(
        join(directory, 'mail_recipients.go'),
        rewrite(
            'package main\nimport("strings";draftpkg "github.com/larksuite/cli/shortcuts/mail/draft")\n' +
                extractFunction(editSource, 'effectiveRecipients'),
        ),
    );
    await writeFile(
        join(directory, 'mail_bridge.go'),
        rewrite(
            await readFile(
                new URL('./mail-bridge.go', import.meta.url),
                'utf8',
            ),
        ),
    );
}
