import { DurableObject } from 'cloudflare:workers';
import { mailEngine } from '../infrastructure/documents/mail-adapter';
import { pureEngineResponse } from './pure-engine-handler';
interface Env { ENGINE: DurableObjectNamespace<PureEngineObject> }
export class PureEngineObject extends DurableObject<Env> {
    fetch(request: Request) { return pureEngineResponse(request, { processMail: mailEngine.processMail.bind(mailEngine) }); }
}
export default { fetch(request: Request, env: Env) { return env.ENGINE.getByName('engine').fetch(request); } } satisfies ExportedHandler<Env>;
