import { DurableObject } from 'cloudflare:workers';
import { docsEngine } from '../infrastructure/documents/docs-adapter';
import { pureEngineResponse } from './pure-engine-handler';
interface Env { ENGINE: DurableObjectNamespace<PureEngineObject> }
export class PureEngineObject extends DurableObject<Env> {
    fetch(request: Request) { return pureEngineResponse(request, { formatEvent: docsEngine.formatEvent.bind(docsEngine), toIMMarkdown: docsEngine.toIMMarkdown.bind(docsEngine), parse: docsEngine.parse.bind(docsEngine), format: docsEngine.format.bind(docsEngine), process: docsEngine.process.bind(docsEngine) }); }
}
export default { fetch(request: Request, env: Env) { return env.ENGINE.getByName('engine').fetch(request); } } satisfies ExportedHandler<Env>;
