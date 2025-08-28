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

const LogLevel = {
  Error: 0,
  Warn: 1,
  Info: 2,
  Debug: 3,
  Trace: 4,
} as const;
type LogLevel = typeof LogLevel[keyof typeof LogLevel];

function toNumber(x: number | bigint): number {
  if (typeof x === "number") return x;
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(0)) {
    throw new RangeError(
      `bigint ${x} cannot be represented safely as JS Number`
    );
  }
  return Number(x);
}

function checkMemoryBounds(ptr: bigint, len: bigint) {
  if (!sharedMemory) throw new Error("wasm memory not initialized");
  const p = toNumber(ptr);
  const l = toNumber(len);
  if (p < 0 || l < 0 || p + l > sharedMemory.buffer.byteLength) {
    throw new RangeError(
      `out of bounds: ptr=${ptr} len=${len} buffer=${sharedMemory.buffer.byteLength}`
    );
  }
}

function writeBytes(ptr: bigint, bytes: Uint8Array) {
  checkMemoryBounds(ptr, BigInt(bytes.length));
  new Uint8Array(sharedMemory!.buffer, toNumber(ptr), bytes.length).set(bytes);
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
  if (arg instanceof SharedArrayBuffer) {
    const ptr = malloc(BigInt(arg.byteLength)); // TODO: free this at some point
    writeBytes(ptr, new Uint8Array(arg));
    return [ptr, BigInt(arg.byteLength)];
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
    __log: (level: any, ptr: any, len: any) => {
      try {
        checkMemoryBounds(ptr, len);
        const bytes = new Uint8Array(sharedMemory!.buffer, toNumber(ptr), toNumber(len));
        const s = new TextDecoder().decode(bytes);
        switch (toNumber(level)) {
          case LogLevel.Error:
            console.error(s);
            break;
          case LogLevel.Warn:
            console.warn(s);
            break;
          case LogLevel.Info:
            console.info(s);
            break;
          case LogLevel.Debug:
            console.debug(s);
            break;
          case LogLevel.Trace:
            console.trace(s);
            break;
          default:
            throw new Error(`unknown log level: ${level}`);
        }
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },

    __performance_mark: (ptr: any, len: any) => {
      try {
        checkMemoryBounds(ptr, len);
        const bytes = new Uint8Array(sharedMemory!.buffer, toNumber(ptr), toNumber(len));
        const s = new TextDecoder().decode(bytes);
        performance.mark(s);
      } catch (err: any) {
        postMessage({ type: "error", message: String(err) });
      }
    },

    __return_string: (id: any, ptr: any, len: any) => {
      try {
        checkMemoryBounds(ptr, len);
        const resBuf = resBufs.get(toNumber(id));
        if (!resBuf) {
          throw new Error(`no result buffer for id ${id}`);
        }

        const bytes = new Uint8Array(sharedMemory!.buffer, toNumber(ptr), toNumber(len));
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

    __crypto_get_random: (ptr: any, len: any) => {
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
