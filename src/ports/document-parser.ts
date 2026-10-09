export interface DocumentProfile {
    word_count: number;
    char_count: number;
    breakdown: Record<string, number>;
    block_count: number;
    blocks: { type: string; count: number; ratio: number }[];
}
export interface DocumentParser {
    toIMMarkdown?(content: string, docInput: string): Promise<string>;
    parse(xml: string): Promise<DocumentProfile>;
}
