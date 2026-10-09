import module from './generated/docs/parser.wasm';
import { WasmDocumentParser } from './engine';
export const docsEngine = new WasmDocumentParser(module);
