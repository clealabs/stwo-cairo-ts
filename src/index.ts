export * from "./prove";
export * from "./verify";

// src/index.ts
type CallResolver = { resolve: (v: any) => void; reject: (e: any) => void };

export type WasmWorkerHandle = {
  init: () => Promise<void>;
  // run: () => Promise<void>;
  call: (fn: string, ...args: any[]) => Promise<any>;
  terminate: () => void;
  onLog?: (s: string) => void;
  onError?: (s: string) => void;
};

/**
 * Create and return a worker-backed wasm handle.
 * The worker path is resolved by Vite; use `new URL(..., import.meta.url)`.
 */
export function createWasmWorkerHandle(options?: {
  onLog?: (s: string) => void;
  onError?: (s: string) => void;
}): WasmWorkerHandle {
  // worker entry (Vite-friendly URL)
  const worker = new Worker(
    new URL("./worker/wasm-worker.ts", import.meta.url),
    { type: "module" } // Vite will bundle worker according to config.worker.plugins
  );

  const pendingCalls = new Map<string | number, CallResolver>();
  let callId = 1;

  const onLog = options?.onLog ?? (() => {});
  const onError = options?.onError ?? (() => {});

  worker.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data;
    if (!data) return;
    switch (data.type) {
      case "ready":
        // main thread might listen for init resolution
        // handled in init() promise below
        break;
      case "log":
        onLog(String(data.message ?? ""));
        break;
      case "result":
        {
          const id = data.id;
          const resolver = pendingCalls.get(id);
          if (resolver) {
            resolver.resolve(data.result);
            pendingCalls.delete(id);
          }
        }
        break;
      case "error":
        {
          const id = data.id;
          if (id != null && pendingCalls.has(id)) {
            const resolver = pendingCalls.get(id)!;
            resolver.reject(new Error(String(data.message ?? "unknown error")));
            pendingCalls.delete(id);
          } else {
            onError(String(data.message ?? "unknown error"));
          }
        }
        break;
      // case "ran":
      //   // no-op, could surface
      //   break;
    }
  });

  function init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = (ev: MessageEvent) => {
        if (ev.data?.type === "ready") {
          worker.removeEventListener("message", onReady);
          resolve();
        } else if (ev.data?.type === "error") {
          worker.removeEventListener("message", onReady);
          reject(new Error(String(ev.data.message ?? "init error")));
        }
      };
      worker.addEventListener("message", onReady);
      worker.postMessage({ type: "init" });
    });
  }

  // function run(): Promise<void> {
  //   return new Promise((resolve, reject) => {
  //     const onRun = (ev: MessageEvent) => {
  //       if (ev.data?.type === "ran") {
  //         worker.removeEventListener("message", onRun);
  //         resolve();
  //       } else if (ev.data?.type === "error") {
  //         worker.removeEventListener("message", onRun);
  //         reject(new Error(String(ev.data.message ?? "run error")));
  //       }
  //     };
  //     worker.addEventListener("message", onRun);
  //     worker.postMessage({ type: "run" });
  //   });
  // }

  function call(fn: string, ...args: any[]) {
    return new Promise<any>((resolve, reject) => {
      const id = callId++;
      pendingCalls.set(id, { resolve, reject });
      worker.postMessage({ type: "call", id, fn, args });
      // caller must be resolved or rejected by worker response or timeout (not implemented)
    });
  }

  function terminate() {
    worker.terminate();
    pendingCalls.clear();
  }

  return {
    init,
    // run,
    call,
    terminate,
    onLog,
    onError,
  };
}
