import type { JsonObject } from '../domain/models';
/** Pure, pinned mail transformations with no filesystem or network access. */
export interface MailTransformer {
    processMail(input: JsonObject): Promise<unknown>;
}
