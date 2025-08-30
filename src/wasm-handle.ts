type CallResolver = {
  resolve: (v: any) => void;
  reject: (e: any) => void;
};

export type WasmWorkerHandle = {
  init: () => Promise<void>;
  call: (fn: string, resBuf: SharedArrayBuffer, ...args: any[]) => Promise<any>;
  terminate: () => void;
  onLog?: (s: string) => void;
  onError?: (s: string) => void;
};

export function createWasmWorkerHandle(options?: {
  onLog?: (s: string) => void;
  onError?: (s: string) => void;
}): WasmWorkerHandle {
  if (!isSecureContext) throw new Error("Wasm worker requires secure context");
  if (!crossOriginIsolated)
    throw new Error("Wasm worker requires cross-origin isolation");

  const worker = new Worker(
    new URL("./worker/wasm-worker.ts", import.meta.url),
    { type: "module" }
  );

  const pendingCalls = new Map<number, CallResolver>();
  let callId = 1;

  const onLog = options?.onLog ?? (() => {});
  const onError = options?.onError ?? (() => {});

  worker.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data;
    if (!data) return;
    switch (data.type) {
      case "ready":
        break;
      case "log":
        onLog(String(data.message ?? ""));
        break;
      case "result":
        const id: number = data.id;
        const resolver = pendingCalls.get(id);
        if (resolver) {
          resolver.resolve(data.message);
          pendingCalls.delete(id);
        } else {
          onError(`no resolver for call id ${id}`);
        }
        break;
      case "error": {
        const id: number | undefined = data.id;
        if (id != null && pendingCalls.has(id)) {
          const resolver = pendingCalls.get(id)!;
          resolver.reject(new Error(String(data.message ?? "unknown error")));
          pendingCalls.delete(id);
        } else {
          onError(String(data.message ?? "unknown error"));
        }
        break;
      }
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

  function call(
    fn: string,
    resBuf: SharedArrayBuffer,
    ...args: any[]
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const id = callId++;
      const resolver: CallResolver = { resolve, reject };

      pendingCalls.set(id, resolver);
      worker.postMessage({ type: "call", id, fn, resBuf, args });
    });
  }

  function terminate() {
    for (const [_id, resolver] of pendingCalls.entries())
      resolver.reject(new Error("worker terminated"));
    pendingCalls.clear();
    worker.terminate();
  }

  return {
    init,
    call,
    terminate,
    onLog,
    onError,
  };
}
