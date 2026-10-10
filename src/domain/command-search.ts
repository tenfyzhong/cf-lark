import type { CommandDefinition } from './models';

// Aliases affect discovery only. They never change a command, identity, or grant.
const domains: Readonly<Record<string, readonly string[]>> = {
    docs: ['document', 'documents', 'doc', '\u6587\u6863', '\u4e91\u6587\u6863'],
    im: ['message', 'messages', 'messaging', 'chat', 'chats', '\u6d88\u606f', '\u804a\u5929'],
    sheets: ['spreadsheet', 'spreadsheets', 'worksheet', '\u7535\u5b50\u8868\u683c', '\u8868\u683c'],
    base: ['bitable', 'database', '\u591a\u7ef4\u8868\u683c'],
    calendar: ['agenda', 'schedule', '\u65e5\u5386', '\u65e5\u7a0b'],
    task: ['tasks', 'todo', 'todos', '\u4efb\u52a1', '\u5f85\u529e'],
    mail: ['email', 'emails', 'mailbox', '\u90ae\u4ef6', '\u90ae\u7bb1'],
    drive: ['storage', '\u4e91\u7a7a\u95f4', '\u4e91\u76d8'],
    wiki: ['knowledge', '\u77e5\u8bc6\u5e93'],
    contact: ['contacts', 'people', '\u8054\u7cfb\u4eba', '\u901a\u8baf\u5f55'],
    slides: ['presentation', 'presentations', '\u6f14\u793a\u6587\u7a3f', '\u5e7b\u706f\u7247'],
    minutes: ['transcript', 'transcripts', '\u5999\u8bb0'],
    vc: ['meeting', 'meetings', 'conference', '\u89c6\u9891\u4f1a\u8bae', '\u4f1a\u8bae'],
    whiteboard: ['board', '\u767d\u677f'],
    artifact: ['artifacts', '\u4e34\u65f6\u6587\u4ef6'],
    files: ['file', 'files', '\u6587\u4ef6'],
    workflow: ['workflows', '\u5de5\u4f5c\u6d41'],
    event: ['events', '\u4e8b\u4ef6'],
    apps: ['app', 'application', '\u5e94\u7528'],
    note: ['notes', '\u7b14\u8bb0'],
};
const actions: Readonly<Record<string, readonly string[]>> = {
    search: ['find', 'lookup', '\u641c\u7d22', '\u67e5\u627e', '\u641c\u7d22\u4e00\u4e0b'],
    create: ['make', 'new', '\u521b\u5efa', '\u65b0\u5efa'],
    read: ['get', 'fetch', 'inspect', '\u8bfb\u53d6', '\u67e5\u770b'],
    list: ['enumerate', '\u5217\u51fa', '\u5217\u8868'],
    update: ['edit', 'modify', '\u66f4\u65b0', '\u4fee\u6539', '\u7f16\u8f91'],
    delete: ['remove', '\u5220\u9664'],
    send: ['deliver', '\u53d1\u9001'],
    upload: ['\u4e0a\u4f20'],
    download: ['\u4e0b\u8f7d'],
    resume: ['continue', 'advance', '\u7ee7\u7eed', '\u6062\u590d'],
    watch: ['listen', 'subscribe', 'monitor', '\u76d1\u542c', '\u8ba2\u9605'],
    stop: ['unsubscribe', '\u505c\u6b62', '\u53d6\u6d88\u8ba2\u9605'],
};
const groups = [...Object.entries(domains), ...Object.entries(actions)].map(([canonical, aliases]) => [canonical, ...aliases]);
const phrases = groups.flatMap(group => group.filter(alias => /[^\x00-\x7f]/u.test(alias)).map(alias => ({ alias, canonical: group[0]! })))
    .sort((a, b) => b.alias.length - a.alias.length);

function normalize(value: string): string { return value.normalize('NFKC').trim().toLowerCase(); }
function terms(query: string): string[] {
    let expanded = normalize(query);
    for (const { alias, canonical } of phrases) expanded = expanded.replaceAll(alias, ` ${canonical} `);
    return expanded.split(/[\s,;:!?\u3001\u3002]+/u).filter(Boolean);
}
function domainId(input: string): string {
    const value = normalize(input);
    return Object.entries(domains).find(([domain, aliases]) => domain === value || aliases.includes(value))?.[0] ?? value;
}

export function matchesCommand(definition: CommandDefinition, input: { query: string; domain?: string }): boolean {
    if (input.domain && definition.domain !== domainId(input.domain)) return false;
    const text = normalize(`${definition.id} ${definition.domain} ${definition.description}`);
    return terms(input.query).every(term => {
        if (text.includes(term)) return true;
        const aliases = groups.find(group => group.includes(term));
        return aliases?.some(alias => /^[\x00-\x7f]+$/u.test(alias) && text.includes(alias)) ?? false;
    });
}
