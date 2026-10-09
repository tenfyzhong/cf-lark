import module from './generated/mail/parser.wasm';
import { WasmDocumentParser } from './engine';
export const mailEngine = new WasmDocumentParser(module);
