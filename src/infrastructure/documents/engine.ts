import { enforceMailBudget } from './mail-budget';
import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type {
    DocumentParser,
    DocumentProfile,
} from '../../ports/document-parser';
import { Go } from './generated/runtime.js';

/** Bounds DOM allocation before invoking the exact upstream parser. */
function validateXMLComplexity(xml: string): void {
    let delimiters = 0;
    let markupBytes = 0;
    let markup = false;
    let quote = 0;
    for (let index = 0; index < xml.length; index++) {
        const code = xml.charCodeAt(index);
        if (code === 60) {
            if (++delimiters > 32_768)
                throw new ServiceError(
                    'RESOURCE_LIMIT',
                    'Document XML exceeds the hosted parser limit of 32,768 markup delimiters. Split the document before profiling.',
                );
            markup = true;
        }
        if (!markup) continue;
        markupBytes +=
            code < 128
                ? 1
                : code < 2048
                  ? 2
                  : code >= 0xd800 &&
                      code <= 0xdbff &&
                      xml.charCodeAt(index + 1) >= 0xdc00 &&
                      xml.charCodeAt(index + 1) <= 0xdfff
                    ? 1
                    : 3;
        if (markupBytes > 2 * 1024 * 1024)
            throw new ServiceError(
                'RESOURCE_LIMIT',
                'Document XML exceeds the hosted parser limit of 2 MiB of markup text. Split the document before profiling.',
            );
        if (quote) {
            if (code === quote) quote = 0;
        } else if (code === 34 || code === 39) quote = code;
        else if (code === 62) markup = false;
    }
}

/** Runs the pinned pure parser without CLI, filesystem, or credential access. */
export class WasmDocumentParser implements DocumentParser {
    private markdown?: (content: string, docInput: string) => string;
    private eventCard?: (raw: string, mentions: string) => string;
    private mail?: (input: string) => string;
    private base?: (input: string) => string;
    private card?: (raw: string, mentions: string) => string;
    private ready?: Promise<(xml: string) => string>;
    constructor(private readonly module: WebAssembly.Module) {}

    private initialize(): Promise<(xml: string) => string> {
        return (this.ready ??= (async () => {
            const go = new Go();
            const instance = await WebAssembly.instantiate(
                this.module,
                go.importObject,
            );
            let startupError: unknown;
            void go.run(instance).catch((error) => {
                startupError = error;
            });
            await Promise.resolve();
            const parser = (
                globalThis as unknown as {
                    cfLarkParseDocXML?: (xml: string) => string;
                }
            ).cfLarkParseDocXML;
            if (
                startupError ||
                (typeof parser !== 'function' &&
                    typeof (globalThis as any).cfLarkMail !== 'function')
            ) {
                throw new ServiceError(
                    'PARSER_UNAVAILABLE',
                    'The document parser could not initialize inside this request.',
                    500,
                );
            }
            this.card = (
                globalThis as unknown as {
                    cfLarkFormatCard: (raw: string, mentions: string) => string;
                }
            ).cfLarkFormatCard;
            this.base = (
                globalThis as unknown as {
                    cfLarkBaseRecords: (input: string) => string;
                }
            ).cfLarkBaseRecords;
            this.mail = (
                globalThis as unknown as {
                    cfLarkMail: (input: string) => string;
                }
            ).cfLarkMail;
            this.eventCard = (
                globalThis as unknown as {
                    cfLarkFormatEventCard: (
                        raw: string,
                        mentions: string,
                    ) => string;
                }
            ).cfLarkFormatEventCard;
            this.markdown = (
                globalThis as unknown as {
                    cfLarkDocIMMarkdown: (
                        content: string,
                        docInput: string,
                    ) => string;
                }
            ).cfLarkDocIMMarkdown;
            return (
                parser ??
                (() =>
                    JSON.stringify({
                        error: 'Document parsing is unavailable in the Mail engine.',
                    }))
            );
        })());
    }

    async toIMMarkdown(content: string, docInput: string): Promise<string> {
        if (new TextEncoder().encode(content).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Document content exceeds20,000,000bytes.',
            );
        await this.initialize();
        if (!this.markdown)
            throw new ServiceError(
                'PARSER_UNAVAILABLE',
                'Document Markdown converter is unavailable.',
                500,
            );
        return this.markdown(content, docInput);
    }

    async processMail(input: JsonObject): Promise<unknown> {
        enforceMailBudget(input);
        const text = JSON.stringify(input);
        if (new TextEncoder().encode(text).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Mail input exceeds 20,000,000 bytes.',
            );
        await this.initialize();
        if (!this.mail)
            throw new ServiceError(
                'PARSER_UNAVAILABLE',
                'Mail transformer is unavailable.',
                500,
            );
        const result = JSON.parse(this.mail(text));
        if (result.error)
            throw new ServiceError('INVALID_ARGUMENTS', String(result.error));
        return result.result;
    }

    async process(input: JsonObject): Promise<unknown> {
        const text = JSON.stringify(input);
        if (new TextEncoder().encode(text).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Pure engine input exceeds 20,000,000 bytes.',
            );
        await this.initialize();
        if (!this.base)
            throw new ServiceError(
                'PARSER_UNAVAILABLE',
                'Base formatter is unavailable.',
                500,
            );
        const result = JSON.parse(this.base(text));
        if (result.error)
            throw new ServiceError('INVALID_ARGUMENTS', String(result.error));
        return result.result;
    }

    async formatEvent(
        rawContent: string,
        mentions: unknown[],
    ): Promise<string> {
        if (new TextEncoder().encode(rawContent).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Card event input exceeds 20,000,000 bytes.',
            );
        await this.initialize();
        if (!this.eventCard)
            throw new ServiceError(
                'PARSER_UNAVAILABLE',
                'Event card formatter is unavailable.',
                500,
            );
        return this.eventCard(rawContent, JSON.stringify(mentions));
    }

    async format(rawContent: string, mentions: unknown[]): Promise<string> {
        if (new TextEncoder().encode(rawContent).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Card content exceeds 20,000,000 bytes.',
            );
        await this.initialize();
        if (!this.card)
            throw new ServiceError(
                'PARSER_UNAVAILABLE',
                'Card formatter is unavailable.',
                500,
            );
        return this.card(rawContent, JSON.stringify(mentions));
    }

    async parse(xml: string): Promise<DocumentProfile> {
        if (new TextEncoder().encode(xml).byteLength > 20_000_000)
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'Document XML exceeds the pinned parser 20,000,000-byte limit.',
            );
        validateXMLComplexity(xml);
        const parse = await this.initialize();
        const result = JSON.parse(parse(xml)) as DocumentProfile & {
            error?: string;
        };
        if (result.error)
            throw new ServiceError('INVALID_ARGUMENTS', result.error);
        if (
            !Number.isSafeInteger(result.word_count) ||
            !Array.isArray(result.blocks)
        )
            throw new ServiceError(
                'INVALID_PARSER_RESULT',
                'The document parser returned an invalid profile.',
                500,
            );
        return result;
    }
}
