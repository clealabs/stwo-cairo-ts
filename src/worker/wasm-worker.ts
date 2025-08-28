import initWasm from "../../backend/target/wasm64-unknown-unknown/release/cairo_prove_wasm.wasm?init";

let instance: any = null;
let sharedMemory: WebAssembly.Memory | null = null;
let resBufs: Map<number, SharedArrayBuffer> = new Map();

let malloc: (size: bigint) => bigint = () => {
  throw new Error("Memory allocator not initialized");
};
let free: (ptr: bigint, size: bigint) => void = () => {
  throw new Error("Memory deallocator not initialized");
};

function toNumber(x: number | bigint): number {
  if (typeof x === "number") return x;
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(0)) {
    throw new RangeError(
      `bigint ${x} cannot be represented safely as JS Number`
    );
  }
  return Number(x);
}

function writeBytes(ptr: bigint, bytes: Uint8Array) {
  if (!sharedMemory) throw new Error("wasm memory not initialized");
  const end = ptr + BigInt(bytes.length);
  if (end > BigInt(sharedMemory.buffer.byteLength)) {
    throw new RangeError(
      `writeBytes out of bounds: ptr=${ptr} len=${bytes.length} buffer=${sharedMemory.buffer.byteLength}`
    );
  }
  // Now it's safe to convert to Number (we asserted end <= byteLength, which is < 2^53 in practice)
  const offset = toNumber(ptr);
  // create new view at the moment of writing (never reuse old view across grows)
  new Uint8Array(sharedMemory.buffer, offset, bytes.length).set(bytes);
}

// Convert JS argument into one or more wasm64 u64 values (as BigInt) suitable for FFI.
// Supported:
//  - number|bigint -> single scalar
//  - string -> [ptr,len] (UTF-8)
//  - Array<number|bigint> -> [ptr,len] of u64 values
//  - Uint8Array -> [ptr,len] raw bytes
function convertArg(arg: any): bigint[] {
  if (typeof arg === "number") return [BigInt(arg)];
  if (typeof arg === "bigint") return [arg];
  if (typeof arg === "string") {
    const enc = new TextEncoder();
    const bytes = enc.encode(arg);
    const ptr = malloc(BigInt(bytes.length)); // TODO: free this at some point
    writeBytes(ptr, bytes);
    return [ptr, BigInt(bytes.length)];
  }
  if (Array.isArray(arg)) {
    // treat as array of u64 scalars
    const len = arg.length;
    const bytes = new Uint8Array(len * 8);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < len; i++) {
      const v = typeof arg[i] === "bigint" ? arg[i] : BigInt(arg[i]);
      // little-endian write of 64-bit value
      view.setBigUint64(i * 8, BigInt(v), true);
    }
    const ptr = malloc(BigInt(bytes.length)); // TODO: free this at some point
    writeBytes(ptr, bytes);
    return [ptr, BigInt(len)];
  }
  if (arg instanceof Uint8Array) {
    const ptr = malloc(BigInt(arg.length)); // TODO: free this at some point
    writeBytes(ptr, arg);
    return [ptr, BigInt(arg.length)];
  }
  throw new TypeError(`Unsupported argument type: ${typeof arg}`);
}

const imports: WebAssembly.Imports = {
  host: {
    host_print: (ptr: any, len: any) => {
      try {
        if (!sharedMemory) throw new Error("wasm memory not initialized");
        const p = toNumber(ptr);
        const l = toNumber(len);
        if (p < 0 || l < 0 || p + l > sharedMemory.buffer.byteLength) {
          throw new RangeError(
            `host_print out of bounds: ptr=${ptr} len=${len}`
          );
        }
        const bytes = new Uint8Array(sharedMemory.buffer, p, l);
        const s = new TextDecoder().decode(bytes);

        postMessage({ type: "log", message: s });
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },

    return_string: (id: any, ptr: any, len: any) => {
      try {
        if (!sharedMemory) throw new Error("wasm memory not initialized");
        const p = toNumber(ptr);
        const l = toNumber(len);
        if (p < 0 || l < 0 || p + l > sharedMemory.buffer.byteLength) {
          throw new RangeError(
            `host_print out of bounds: ptr=${ptr} len=${len}`
          );
        }

        const resBuf = resBufs.get(toNumber(id));
        if (!resBuf) {
          throw new Error(`no result buffer for id ${id}`);
        }

        const bytes = new Uint8Array(sharedMemory.buffer, p, l);
        if (bytes.length > resBuf.byteLength) {
          if (resBuf.growable && resBuf.maxByteLength >= bytes.length) {
            resBuf.grow(bytes.length);
          } else {
            throw new RangeError(
              `result buffer too small: ${resBuf.byteLength} < ${bytes.length}`
            );
          }
        }

        const resView = new Uint8Array(resBuf);
        resView.set(bytes);

        postMessage({ type: "result", id: toNumber(id) });
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
        malloc = instance.exports?.malloc ?? null;
        free = instance.exports?.free ?? null;

        postMessage({ type: "ready" });
        break;
      case "call":
        const { id, fn, resBuf, args } = data;
        if (!instance || !instance.exports) throw new Error("not initialized");
        if (typeof instance.exports[fn] !== "function")
          throw new Error(`export ${fn} not found`);

        resBufs.set(id, resBuf);

        const marshalled: bigint[] = [];
        for (const a of args ?? []) marshalled.push(...convertArg(a));
        const result = instance.exports[fn](BigInt(id), ...(marshalled as any));

        if (result) {
          console.warn(
            `Ignored returned a value: ${result} from Wasm call "${fn}". Use \`return_string\` instead.`
          );
        }

        break;
      default:
        throw new Error(`unknown message type: ${data?.type}`);
    }
  } catch (err: any) {
    postMessage({ type: "error", message: String(err), id: data?.id });
  }
});
