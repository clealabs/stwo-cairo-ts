declare module "*.wasm?init" {
  const initWasm: (imports?: WebAssembly.Imports) => Promise<any>;
  export default initWasm;
}
