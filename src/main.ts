import { createWasmWorkerHandle } from "./index";

const outEl = document.getElementById("out");

function append(s: string) {
  if (outEl) outEl.textContent += s + "\n";
  else console.log(s);
}

const handle = createWasmWorkerHandle({
  onLog: append,
  onError: (e) => append("worker error: " + e),
});

(async () => {
  try {
    await handle.init();
    append("wasm worker ready");
    const res = await handle.call("run");
    append("call result: " + String(res));
  } catch (e) {
    append("instantiate error: " + String(e));
  }
})();
