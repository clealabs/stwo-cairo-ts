import initWasm from "../../backend/target/wasm64-unknown-unknown/release/cairo_prove_wasm.wasm?init";

let instance: any = null;
let sharedMemory: WebAssembly.Memory | null = null;
let heapOffset: bigint | null = null; // bump allocator offset (BigInt for wasm64)

function toNumber(x: number | bigint): number {
  if (typeof x === "number") return x;
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(0)) {
    throw new RangeError(
      `bigint ${x} cannot be represented safely as JS Number`
    );
  }
  return Number(x);
}

function initHeapOffset() {
  if (heapOffset !== null) return;
  const baseExport = instance?.exports?.__heap_base;
  if (typeof baseExport === "bigint") {
    heapOffset = baseExport;
  } else if (
    typeof baseExport === "object" &&
    baseExport !== null &&
    "valueOf" in baseExport
  ) {
    try {
      const v = (baseExport as any).valueOf();
      heapOffset = typeof v === "bigint" ? v : BigInt(v);
    } catch {
      heapOffset = BigInt(sharedMemory!.buffer.byteLength);
    }
  } else {
    heapOffset = BigInt(sharedMemory!.buffer.byteLength);
  }
}

// safer alloc: returns BigInt pointer
function alloc(len: number, align: number = 8): bigint {
  if (len <= 0) return 0n;
  if (!sharedMemory) throw new Error("wasm memory not initialized");
  initHeapOffset();
  let off = heapOffset!;
  const mask = BigInt(align - 1);
  if ((off & mask) !== 0n) off = (off + mask) & ~mask;

  // compute required end offset as BigInt
  const end = off + BigInt(len);
  console.log("alloc: off=", off, "mask=", mask, "end=", end);

  // grow if needed
  if (end > BigInt(sharedMemory.buffer.byteLength)) {
    console.log("alloc: growing memory");
    const pageSize: bigint = 64n * 1024n;
    const additionalBytes = end - BigInt(sharedMemory.buffer.byteLength);
    const pages: bigint = BigInt(
      Math.ceil(Number((additionalBytes + pageSize - 1n) / pageSize))
    );
    console.log("alloc: growing memory", pages);
    // grow accepts Number pages
    (sharedMemory as any).grow(pages);
    // after grow, sharedMemory.buffer is a new ArrayBuffer — that's fine,
    // we always create new views after this check.
  }

  console.log("alloc: final", off, end);

  // final sanity check (no unsafe Number conversion yet)
  if (end > BigInt(sharedMemory.buffer.byteLength)) {
    throw new Error(
      `alloc: still out of bounds after grow: end=${end} buffer=${sharedMemory.buffer.byteLength}`
    );
  }

  heapOffset = end;
  return off;
}

// safer write: verifies bounds and uses safe conversion only when guaranteed safe
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
    console.log("convertArg: string", bytes.length);
    const ptr = alloc(bytes.length, 1);
    console.log("convertArg: string", bytes.length);
    writeBytes(ptr, bytes);
    console.log("convertArg: string", ptr, bytes.length);
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
    const ptr = alloc(bytes.length, 8);
    writeBytes(ptr, bytes);
    return [ptr, BigInt(len)];
  }
  if (arg instanceof Uint8Array) {
    const ptr = alloc(arg.length, 1);
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
        const bytes = new Uint8Array(sharedMemory.buffer, p, l).slice(); // slice makes a copy
        const s = new TextDecoder().decode(bytes);

        postMessage({ type: "log", message: s });
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },

    return_string: (ptr: any, len: any) => {
      try {
        if (!sharedMemory) throw new Error("wasm memory not initialized");
        const p = toNumber(ptr);
        const l = toNumber(len);
        if (p < 0 || l < 0 || p + l > sharedMemory.buffer.byteLength) {
          throw new RangeError(
            `host_print out of bounds: ptr=${ptr} len=${len}`
          );
        }
        const bytes = new Uint8Array(sharedMemory.buffer, p, l).slice(); // slice makes a copy
        const s = new TextDecoder().decode(bytes);

        postMessage({ type: "result", message: s });
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
      case "call":
        const { id, fn, args } = data;
        if (!instance || !instance.exports) throw new Error("not initialized");
        if (typeof instance.exports[fn] !== "function")
          throw new Error(`export ${fn} not found`);

        const marshalled: bigint[] = [];
        console.log("Marshalled arguments:", marshalled, args);
        for (const a of args ?? []) marshalled.push(...convertArg(a));
        console.log("Final marshalled arguments:", marshalled);
        const result = instance.exports[fn](...(marshalled as any));
        if (result) {
          console.warn(
            `Ignored returned a value: ${result} from Wasm call "${fn}". Use \`return_string\` instead.`
          );
        }

        postMessage({ type: "returned", id });
        break;
      default:
        throw new Error(`unknown message type: ${data?.type}`);
    }
  } catch (err: any) {
    postMessage({ type: "error", message: String(err), id: data?.id });
  }
});
