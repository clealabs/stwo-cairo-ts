import { createWasmWorkerHandle, type WasmWorkerHandle } from "./wasm-handle";

let handle: WasmWorkerHandle | null = null;

const SAB_MAX_LENGTH = 1073741824; // 1 GiB

/**
 * Initializes the WASM worker.
 * This function is automatically called when a function requiring the worker is called,
 * use it only if you want to manually initialize the worker earlier in your app logic.
 */
export function init() {
  handle = createWasmWorkerHandle({
    onLog: (s) => console.log(`[Wasm] ${s}`),
    onError: (s) => console.error(`[Wasm] ${s}`),
  });
  return handle.init();
}

/**
 * Terminates the WASM worker.
 */
export function terminate() {
  handle?.terminate();
  handle = null;
}

async function callWrapper(
  fn: string,
  arg1: string,
  ...args: any[]
): Promise<string> {
  if (!handle) await init();
  const resBuf = new SharedArrayBuffer(0, { maxByteLength: SAB_MAX_LENGTH });
  const resView = new Uint8Array(resBuf);
  const arg1Bytes = new TextEncoder().encode(arg1);
  const arg1Buf = new SharedArrayBuffer(arg1Bytes.byteLength);
  const arg1View = new Uint8Array(arg1Buf);
  arg1View.set(arg1Bytes);
  await handle!.call(fn, resBuf, arg1Buf, ...args);
  const copied = resView.slice();
  const out = new TextDecoder().decode(copied);
  return out;
}

/**
 * Executes a Cairo program and produces a proof of execution.
 * @param executable_json A JSON Cairo executable
 * @param args The arguments to pass to the executable
 * @returns A JSON-serialized CairoProof<Blake2sMerkleHasher>
 */
export async function execute(
  executable: string,
  ...args: bigint[]
): Promise<string> {
  return await callWrapper("execute", executable, args);
}

/**
 * Checks if the given prover input contains the Pedersen hash built-in. Used for deciding
 * which preprocessed trace to use when verifying the proof.
 * @param proverInput The prover input JSON string
 * @returns whether the Pedersen hash built-in is present
 */
export function containsPedersenBuiltin(proverInput: string): boolean {
  const proverInputJson = JSON.parse(proverInput);
  return proverInputJson.public_segment_context.present[1];
}

/**
 * Executes a Cairo program and produces a proof of execution.
 * @param proverInput The prover input JSON string
 * @returns A JSON-serialized CairoProof<Blake2sMerkleHasher>
 */
export async function prove(proverInput: string): Promise<string> {
  return await callWrapper("prove", proverInput);
}

/**
 * Verifies a Cairo proof.
 * @param proof The proof JSON string (must use Blake2sMerkleHasher)
 * @param withPedersen Whether to use the Pedersen hash built-in
 * @returns Whether the proof is valid
 */
export async function verify(
  proof: string,
  withPedersen: boolean = false
): Promise<boolean> {
  return JSON.parse(await callWrapper("verify", proof, withPedersen)).ok;
}
