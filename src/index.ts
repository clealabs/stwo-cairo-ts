import { createWasmWorkerHandle, type WasmWorkerHandle } from "./wasm-handle";

let handle: WasmWorkerHandle | null = null;

const SAB_MAX_LENGTH = 1073741824; // 1 GiB

export function init() {
  handle = createWasmWorkerHandle({
    onLog: (s) => console.log(`[Wasm] ${s}`),
    onError: (s) => console.error(`[Wasm] ${s}`),
  });
  return handle.init();
}

export function terminate() {
  handle?.terminate();
  handle = null;
}

async function callWrapper(
  fn: string,
  input: string,
  ...args: any[]
): Promise<string> {
  if (!handle) await init();
  const resBuf = new SharedArrayBuffer(0, { maxByteLength: SAB_MAX_LENGTH });
  const resView = new Uint8Array(resBuf);
  const inputBytes = new TextEncoder().encode(input);
  const inputBuf = new SharedArrayBuffer(inputBytes.byteLength);
  const inputView = new Uint8Array(inputBuf);
  inputView.set(inputBytes);
  await handle!.call(fn, resBuf, inputBuf, ...args);
  const copied = resView.slice();
  const out = new TextDecoder().decode(copied);
  return out;
}

export async function execute(
  executable: string,
  ...args: bigint[]
): Promise<string> {
  // if (!handle) await init();
  // const resBuf = new SharedArrayBuffer(0, { maxByteLength: SAB_MAX_LENGTH });
  // const resView = new Uint8Array(resBuf);
  // const inputBytes = new TextEncoder().encode(executable);
  // const inputBuf = new SharedArrayBuffer(inputBytes.byteLength);
  // const inputView = new Uint8Array(inputBuf);
  // inputView.set(inputBytes);
  // await handle!.call("execute", resBuf, inputBuf, args);
  // const copied = resView.slice();
  // const proverInput = new TextDecoder().decode(copied);
  // return proverInput;
  return await callWrapper("execute", executable, args);
}

export function containsPedersenBuiltin(proverInput: string): boolean {
  const proverInputJson = JSON.parse(proverInput);
  return proverInputJson.public_segment_context.present[1];
}

export async function prove(proverInput: string): Promise<string> {
  // if (!handle) await init();
  // const resBuf = new SharedArrayBuffer(0, { maxByteLength: SAB_MAX_LENGTH });
  // const resView = new Uint8Array(resBuf);
  // const inputBytes = new TextEncoder().encode(proverInput);
  // const inputBuf = new SharedArrayBuffer(inputBytes.byteLength);
  // const inputView = new Uint8Array(inputBuf);
  // inputView.set(inputBytes);
  // await handle!.call("prove", resBuf, inputBuf);
  // const copied = resView.slice();
  // const proof = new TextDecoder().decode(copied);
  // return proof;
  return await callWrapper("prove", proverInput);
}

export async function verify(
  proof: string,
  withPedersen: boolean = false
): Promise<boolean> {
  // if (!handle) await init();
  // const resBuf = new SharedArrayBuffer(0, { maxByteLength: SAB_MAX_LENGTH });
  // const resView = new Uint8Array(resBuf);
  // const inputBytes = new TextEncoder().encode(proof);
  // const inputBuf = new SharedArrayBuffer(inputBytes.byteLength);
  // const inputView = new Uint8Array(inputBuf);
  // inputView.set(inputBytes);
  // await handle!.call("verify", resBuf, inputBuf, withPedersen);
  // const copied = resView.slice();
  // const verify_output = JSON.parse(new TextDecoder().decode(copied));
  // return verify_output.ok;
  return JSON.parse(await callWrapper("verify", proof, withPedersen)).ok;
}
