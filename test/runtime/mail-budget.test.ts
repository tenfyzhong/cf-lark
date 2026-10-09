import {env,runInDurableObject} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {mailEngine} from '../../src/infrastructure/documents/mail-adapter';
import type {Env} from '../../src/bootstrap/worker';
it('accepts text-heavy HTML near the declared combined budget in the native runtime',async()=>{
 await runInDurableObject((env as unknown as Env).AUTHORITY.getByName('mail-html-text-boundary'),async()=>{
  const body='<p>'+'x'.repeat(8*1024*1024-1024)+'</p>',result=await mailEngine.processMail({operation:'lint',body}) as Record<string,unknown>;
  expect(String(result.cleaned_html).length).toBeGreaterThan(8*1024*1024-2048);
 });
},30000);
it('accepts bounded dense markup, rejects the measured OOM shape, and remains usable',async()=>{
 await runInDurableObject((env as unknown as Env).AUTHORITY.getByName('mail-html-node-boundary'),async()=>{
  const accepted=await mailEngine.processMail({operation:'lint',body:'<p>x</p>'.repeat(15000)}) as Record<string,unknown>;expect(String(accepted.cleaned_html).length).toBeGreaterThan(100000);
  await expect(mailEngine.processMail({operation:'lint',body:'<p>x</p>'.repeat(32768)})).rejects.toMatchObject({code:'MAIL_COMPLEXITY_LIMIT'});
  expect(await mailEngine.processMail({operation:'lint',body:'After rejection'})).toMatchObject({cleaned_html:'After rejection'});
 });
},30000);
