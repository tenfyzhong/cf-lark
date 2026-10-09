import {describe,it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

describe.skipIf(process.env.CF_LARK_MAIL_MEMORY_PROBE!=='1')('Mail pure engine memory envelope',()=>{
 it('measures Wasm high-water memory for progressively larger in-memory MIME attachments',async()=>{
  const measurements=[];
  for(const size of [1,4,8,16,18,25]){
   const script=`import {readFile} from 'node:fs/promises';import {Go} from './src/infrastructure/documents/generated/runtime.js';const go=new Go();const module=await WebAssembly.compile(await readFile('./src/infrastructure/documents/generated/mail/parser.wasm'));const instance=await WebAssembly.instantiate(module,go.importObject);void go.run(instance);const input={operation:'build-eml',from:{address:'a@example.test'},to:[{address:'b@example.test'}],subject:'Memory probe',text:'Probe',attachments:[{name:'data.txt',content_type:'text/plain',data:Buffer.alloc(${size}*1024*1024,65).toString('base64')}]};const start=performance.now();const result=JSON.parse(globalThis.cfLarkMail(JSON.stringify(input)));console.log(JSON.stringify({sizeMiB:${size},memoryBytes:instance.exports.mem.buffer.byteLength,elapsedMs:performance.now()-start,outputBytes:result.result?.raw?.length,error:result.error}));process.exit(0);`;
   const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:60000,maxBuffer:100000});const value=JSON.parse(result.stdout);measurements.push(value);if(size<=18){expect(value.error).toBeUndefined();expect(value.outputBytes).toBeGreaterThan(size*1024*1024);}else expect(value.error).toContain('25 MB limit');
  }
  await(await import('node:fs/promises')).writeFile('/tmp/cf-lark-mail-memory.json',JSON.stringify(measurements,null,2));
 },300000);
});
