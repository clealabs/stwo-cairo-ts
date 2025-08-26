import initWasm from "../../backend/target/wasm64-unknown-unknown/release/cairo_prove_wasm.wasm?init";
// A small message protocol between main <-> worker:
// main -> worker:
//   { type: 'init' }
//   { type: 'run' }
//   { type: 'call', id, fn, args[] }
// worker -> main:
//   { type: 'ready' }
//   { type: 'log', message }
//   { type: 'result', id, result }
//   { type: 'error', message, id? }
//   { type: 'ran' }

function toNumber(x: number | bigint): number {
  if (typeof x === "bigint") {
    const n = Number(x);
    if (!Number.isSafeInteger(n))
      throw new RangeError(`${x} too large to convert to JS Number safely`);
    return n;
  }
  return x;
}

function toBigInt(x: number | bigint): bigint {
  if (typeof x === "number") return BigInt(x);
  return x;
}

let instance: any = null;
let sharedMemory: WebAssembly.Memory | null = null;

const imports: WebAssembly.Imports = {
  host: {
    host_print: (ptr: any, len: any) => {
      try {
        if (!sharedMemory) throw new Error("wasm memory not initialized");
        const p = toNumber(ptr);
        const l = toNumber(len);
        const bytes = new Uint8Array(sharedMemory.buffer, p, l);
        const s = new TextDecoder().decode(bytes);

        postMessage({ type: "log", message: s });
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },

    crypto_get_random: (ptr: any, len: any) => {
      try {
        if (!sharedMemory) throw new Error("wasm memory not initialized");
        const p = toNumber(ptr);
        const l = toNumber(len);
        const bytes = new Uint8Array(sharedMemory.buffer, p, l);

        crypto.getRandomValues(bytes);
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },
  },
};

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data;
  try {
    switch (data?.type) {
      case "init":
        instance = await initWasm(imports);
        sharedMemory = (instance.exports && instance.exports.memory) ?? null;

        postMessage({ type: "ready" });
        break;
      // case "run":
      //   if (!instance || !instance.exports) throw new Error("not initialized");
      //   if (typeof instance.exports.run === "function") {
      //     instance.exports.run();
      //     postMessage({ type: "ran" });
      //   } else {
      //     postMessage({ type: "error", message: "no run() export found" });
      //   }
      //   break;
      case "call":
        if (!instance || !instance.exports) throw new Error("not initialized");

        const { id, fn, args } = data;
        if (typeof instance.exports[fn] !== "function")
          throw new Error(`export ${fn} not found`);

        const args64 = args.map((arg: any) => toBigInt(arg));
        const result = instance.exports[fn](...(args64 ?? []));

        postMessage({ type: "result", id, result });
        break;
      default:
        throw new Error(`unknown message type: ${data?.type}`);
    }
  } catch (err: any) {
    postMessage({ type: "error", message: String(err), id: data?.id });
  }
});
