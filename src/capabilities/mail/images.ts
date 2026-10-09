import type { Data } from './common';
/** Browser-free adaptation of local image paths to grant-owned artifacts. */
export function localMailImages(html: string): {
    html: string;
    files: Data[];
} {
    const files: Data[] = [],
        paths = new Map<string, Data>();
    const rewritten = html.replace(
        /(<img\s(?:[^>]*?\s)?src\s*=\s*)(["'])([^"']+)\2/gi,
        (whole, prefix: string, quote: string, source: string) => {
            if (
                /^[a-z][a-z0-9+.-]*:/i.test(source) ||
                source.startsWith('//') ||
                source.startsWith('#')
            )
                return whole;
            const id = source.replace(/^@/, ''),
                existing = paths.get(id),
                file = existing ?? {
                    id,
                    name: id.split(/[\\/]/).pop(),
                    cid: `mail-artifact-${crypto.randomUUID()}`,
                };
            if (!existing) {
                paths.set(id, file);
                files.push(file);
            }
            return `${prefix}${quote}cid:${file.cid}${quote}`;
        },
    );
    return { html: rewritten, files };
}
