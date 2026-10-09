import { expect, it } from 'vitest';
import { eventKeys, eventSetup, eventParameters } from '../src/capabilities/event/keys';
it('exposes the pinned 25 EventKeys with resolved output schemas and validates resource parameters', () => {
    expect(eventKeys).toHaveLength(25); expect(eventKeys.every(key => key.resolved_output_schema.type === 'object')).toBe(true);
    expect(() => eventParameters('board.whiteboard.updated_v1',{})).toThrow('whiteboard_id');
    expect(eventParameters('approval.task.status_changed_v4',{subscription_type:'MANAGED_APPROVAL,INVOLVED_APPROVAL'})).toEqual({subscription_type:'INVOLVED_APPROVAL,MANAGED_APPROVAL'});
    expect(eventSetup('board.whiteboard.updated_v1',{whiteboard_id:'a/b'})).toMatchObject({start:[{path:'/open-apis/board/v1/whiteboards/a%2Fb/subscribe'}],stop:{path:'/open-apis/board/v1/whiteboards/a%2Fb/unsubscribe'}});
    expect(eventSetup('task.task.update_user_access_v2',{}).stop).toBeUndefined();
});
it('exposes list/schema/consume/status/stop as explicit service commands', async () => {
    const { eventConsumerDefinitions } = await import('../src/capabilities/event/lifecycle-definitions');
    expect(eventConsumerDefinitions.map(definition=>definition.id)).toEqual(['event.list','event.schema','event.consume','event.status','event.stop']);
    expect(eventConsumerDefinitions.find(d=>d.id==='event.consume')?.inputSchema.properties).toHaveProperty('consumerId');
});
it('keeps static discovery available without storage and fails lifecycle execution explicitly',async()=>{
    const {eventConsumerCapabilities}=await import('../src/capabilities/event/lifecycle-capabilities');const capabilities=eventConsumerCapabilities();
    expect(await capabilities.find(c=>c.definition.id==='event.list')!.execute({},{} as never)).toHaveLength(25);
    await expect(capabilities.find(c=>c.definition.id==='event.consume')!.execute({'event-key':'im.chat.updated_v1'},{} as never)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
