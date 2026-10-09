import { expect, it } from 'vitest';
import { formatEventMessage } from '../src/capabilities/im/index';
it('formats message mentions and rich text with style and attachment references', () => {
    expect(formatEventMessage({ message_type: 'text', content: JSON.stringify({ text: 'Hello @_user_1' }), mentions: [{ key: '@_user_1', name: 'Sam' }] })).toBe('Hello @Sam');
    expect(formatEventMessage({ message_type: 'post', content: JSON.stringify({ en_us: { title: 'Title', content: [[{ tag: 'text', text: 'Hello', style: ['bold', 'italic'] }, { tag: 'emotion', emoji_type: 'SMILE' }]] }, files: [{ file_key: 'file_a', file_name: 'a.pdf' }] }) })).toBe('Title\n***Hello***:SMILE:\n<file key="file_a" name="a.pdf"/>');
});
it('formats media and handles malformed JSON consistently', () => {
    expect(formatEventMessage({ message_type: 'media', content: JSON.stringify({ file_key: 'file_a', file_name: 'a.mp4', image_key: 'img_a', duration: 2000 }) })).toBe('<video key="file_a" name="a.mp4" duration="2s" cover_image_key="img_a"/>');
    expect(formatEventMessage({ message_type: 'post', content: '{' })).toBe('[Invalid rich text JSON]');
});
it('renders calendar, task, poll, and system payloads without losing identifiers', () => {
    expect(formatEventMessage({ message_type: 'share_calendar_event', content: JSON.stringify({ summary: 'Review <plan>', open_calendar_id: 'cal_a', open_event_id: 'event_a', start_time: '1000' }) })).toBe('<calendar_share open_calendar_id="cal_a" open_event_id="event_a">\nReview &lt;plan&gt;\n1970-01-01 00:16:40\n</calendar_share>');
    expect(formatEventMessage({ message_type: 'todo', content: JSON.stringify({ task_id: 't_a', summary: { title: 'Do work' } }) })).toBe('<todo task_id="t_a">\nDo work\n</todo>');
    expect(formatEventMessage({ message_type: 'vote', content: JSON.stringify({ topic: 'Pick', options: ['A', 'B'], status: 1 }) })).toBe('<vote>\nPick\n• A\n• B\n(Closed)\n</vote>');
    expect(formatEventMessage({ message_type: 'system', content: JSON.stringify({ template: '{from_user} added {to_chatters} to {name} {unknown}', from_user: ['Sam'], to_chatters: ['Pat'], name: 'Team' }) })).toBe('Sam added Pat to Team {unknown}');
});
it('uses the pinned no-runtime fallback for merged-forward events', () => {
    expect(formatEventMessage({ message_type: 'merge_forward', content: JSON.stringify({ create_message_ids: ['om_a', 'om_b'] }) })).toBe('[Merged forward: 2 messages]');
});
it('projects API sender names, UTC times, edited fields, and brand-aware message links', async () => {
    const { formatApiMessage } = await import('../src/capabilities/im/format');
    expect(formatApiMessage({ message_id: 'om_a', msg_type: 'text', body: { content: '{"text":"Hi"}' }, sender: { id: 'ou_a', sender_name: 'Sam', open_bot_id: 'bot_a' }, create_time: '1000', update_time: '1000', chat_id: 'oc_a', message_position: 12 }, 'lark')).toEqual({ message_id: 'om_a', msg_type: 'text', content: 'Hi', sender: { id: 'ou_a', name: 'Sam', open_bot_id: 'bot_a' }, create_time: '1970-01-01 00:16', deleted: false, updated: false, chat_id: 'oc_a', message_position: 12, message_app_link: 'https://applink.larksuite.com/client/chat/open?openChatId=oc_a&position=12' });
});
