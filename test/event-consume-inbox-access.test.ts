import { expect,it,vi } from 'vitest';
import { eventCapability } from '../src/capabilities/event/inbox';
import type { CommandContext } from '../src/ports/capabilities';
it('rejects account-scoped direct inbox reads before touching app events',async()=>{
    const read=vi.fn(async()=>({events:[],cursor:0})),capability=eventCapability({read});
    expect(capability.definition.identities).toEqual(['bot']);
    await expect(capability.execute({}, {selection:{profileId:'p',accountId:'a',identity:'user'},grant:{id:'g',expiresAt:Date.now()+60000,profiles:[{profileId:'p',accounts:['a'],identities:['user']}],domains:['event'],permissions:['read']}} as unknown as CommandContext)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(read).not.toHaveBeenCalled();
});
