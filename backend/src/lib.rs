use getrandom::Error;
use std::alloc::{Layout, alloc, dealloc};
use std::panic;

use cairo_air::{CairoProof, PreProcessedTraceVariant, verifier::verify_cairo};
use cairo_lang_runner::Arg;
use cairo_prove::{
    execute::execute as cairo_execute,
    prove::{prove as cairo_prove, prover_input_from_runner},
};
use cairo_vm::Felt252;
use serde::Serialize;
use stwo_cairo_adapter::ProverInput;
use stwo_cairo_prover::stwo_prover::core::{
    fri::FriConfig,
    pcs::PcsConfig,
    vcs::blake2_merkle::{Blake2sMerkleChannel, Blake2sMerkleHasher},
};

use std::fmt;
use tracing::field::{Field, Visit};
use tracing::{Event, Level};
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;

#[repr(u64)]
#[allow(dead_code)]
enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

// Wasm imports

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn __log(level: LogLevel, ptr: u64, len: u64);
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn __performance_mark(ptr: u64, len: u64);
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn __performance_measure(
        name_ptr: u64,
        name_len: u64,
        start_ptr: u64,
        start_len: u64,
        end_ptr: u64,
        end_len: u64,
    );
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn __return_string(call_id: u64, ptr: u64, len: u64);
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn __crypto_get_random(ptr: u64, len: u64);
}

fn log(level: LogLevel, msg: &str) {
    unsafe {
        __log(level, msg.as_ptr() as u64, msg.len() as u64);
    }
}

fn mark(name: &str) {
    unsafe {
        __performance_mark(name.as_ptr() as u64, name.len() as u64);
    }
}

fn measure(name: &str, start_mark: &str, end_mark: &str) {
    unsafe {
        __performance_measure(
            name.as_ptr() as u64,
            name.len() as u64,
            start_mark.as_ptr() as u64,
            start_mark.len() as u64,
            end_mark.as_ptr() as u64,
            end_mark.len() as u64,
        );
    }
}

fn return_string(call_id: u64, result: &str) {
    unsafe {
        __return_string(call_id, result.as_ptr() as u64, result.len() as u64);
    }
}

#[unsafe(no_mangle)]
unsafe extern "Rust" fn __getrandom_v03_custom(
    dest: *mut u8,
    len: usize,
) -> Result<(), Error> {
    Err(Error::UNSUPPORTED)
}

/// https://github.com/rustwasm/console_error_panic_hook/blob/master/src/lib.rs
fn hook(info: &panic::PanicHookInfo) {
    let msg = info.to_string();
    log(LogLevel::Error, &msg);
}

#[inline]
fn panic_hook_set_once() {
    use std::sync::Once;
    static SET_HOOK: Once = Once::new();
    SET_HOOK.call_once(|| {
        panic::set_hook(Box::new(hook));
    });
}

// Tracing subscriber to forward logs to host

#[derive(Default)]
struct MessageVisitor {
    message: Option<String>,
}

impl MessageVisitor {
    fn new() -> Self {
        Self { message: None }
    }
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{:?}", value));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        }
    }
}

struct WasmLogLayer;

impl<S: tracing::Subscriber> Layer<S> for WasmLogLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);

        let msg = match visitor.message {
            Some(m) => m,
            None => {
                struct AllFieldsVisitor(String);
                use std::fmt::Write;
                impl Visit for AllFieldsVisitor {
                    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
                        let _ = write!(&mut self.0, "{}={:?} ", field.name(), value);
                    }
                    fn record_str(&mut self, field: &Field, value: &str) {
                        let _ = write!(&mut self.0, "{}={} ", field.name(), value);
                    }
                }
                let mut fallback = AllFieldsVisitor(String::new());
                event.record(&mut fallback);
                fallback.0
            }
        };

        let level_code = match *event.metadata().level() {
            Level::TRACE => LogLevel::Trace,
            Level::DEBUG => LogLevel::Debug,
            Level::INFO => LogLevel::Info,
            Level::WARN => LogLevel::Warn,
            Level::ERROR => LogLevel::Error,
        };

        log(level_code, &msg);
    }
}

fn secure_pcs_config() -> PcsConfig {
    PcsConfig {
        pow_bits: 26,
        fri_config: FriConfig {
            log_last_layer_degree_bound: 0,
            log_blowup_factor: 1,
            n_queries: 70,
        },
    }
}

fn _execute(executable_json: &str, args: Vec<Arg>) -> ProverInput {
    mark("deserialize-executable-started");
    let executable = sonic_rs::from_str(executable_json).expect("Failed to read executable");
    mark("deserialize-executable-ended");
    measure(
        "deserialize-executable",
        "deserialize-executable-started",
        "deserialize-executable-ended",
    );
    mark("execute-started");
    let runner = cairo_execute(executable, args);
    let prover_input = prover_input_from_runner(&runner);
    mark("execute-ended");
    measure("execute", "execute-started", "execute-ended");
    prover_input
}

fn _prove(prover_input: ProverInput) -> CairoProof<Blake2sMerkleHasher> {
    mark("prove-start");
    log(LogLevel::Info, "[DEBUG]");
    let json = sonic_rs::to_string(&prover_input).expect("_prove: error serialize prover input");
    log(LogLevel::Info, &json);
    log(LogLevel::Info, "Running prove...");
    let proof = cairo_prove(prover_input, secure_pcs_config());
    mark("prove-end");
    measure("prove", "prove-start", "prove-end");
    proof
}

fn _verify(cairo_proof: CairoProof<Blake2sMerkleHasher>, with_pedersen: bool) -> bool {
    let preprocessed_trace = match with_pedersen {
        true => PreProcessedTraceVariant::Canonical,
        false => PreProcessedTraceVariant::CanonicalWithoutPedersen,
    };
    mark("verify-start");
    let verdict =
        verify_cairo::<Blake2sMerkleChannel>(cairo_proof, secure_pcs_config(), preprocessed_trace)
            .is_ok();
    mark("verify-end");
    measure("verify", "verify-start", "verify-end");
    verdict
}

fn _contains_pedersen(prover_input: &ProverInput) -> bool {
    prover_input.public_segment_context[1]
}

/// Wrapper around `return_string` with JSON serialization.
fn return_json<T: Serialize>(call_id: u64, value: &T) {
    mark("serialize-return-value-started");
    let json = sonic_rs::to_string(value).expect("serialize return value");
    mark("serialize-return-value-ended");
    measure(
        "serialize-return-value",
        "serialize-return-value-started",
        "serialize-return-value-ended",
    );
    return_string(call_id, &json);
}

// Wasm exports
// CONVENTION: All exports must not return values directly, but use `return_string` instead.
// Any returned value will be ignored by the host.

/// Executes a compiled Cairo program.
///
/// SAFETY: host must ensure that (exe_ptr, exe_len) is a valid UTF-8 region in linear memory,
/// and that (args_ptr, args_len) references a contiguous array of u64 values.
#[unsafe(no_mangle)]
pub extern "C" fn execute(call_id: u64, exe_ptr: u64, exe_len: u64, args_ptr: u64, args_len: u64) {
    panic_hook_set_once();

    let executable_json: &str = unsafe {
        let bytes = core::slice::from_raw_parts(exe_ptr as *const u8, exe_len as usize);
        core::str::from_utf8(bytes).expect("executable_json not valid UTF-8")
    };

    let arg_words: &[u64] =
        unsafe { core::slice::from_raw_parts(args_ptr as *const u64, args_len as usize) };
    let args: Vec<Arg> = arg_words
        .iter()
        .map(|&x| Arg::Value(Felt252::from(x)))
        .collect();

    let prover_input = _execute(executable_json, args);
    return_json(call_id, &prover_input);
}

/// Produce a Cairo proof from a provided ProverInput JSON.
///
/// SAFETY: host must ensure (prover_input_ptr, prover_input_len) is valid UTF-8 JSON
/// representing `ProverInput`.
#[unsafe(no_mangle)]
pub extern "C" fn prove(call_id: u64, prover_input_ptr: u64, prover_input_len: u64) {
    panic_hook_set_once();

    // debug tracing
    let subscriber = tracing_subscriber::registry().with(WasmLogLayer);
    subscriber.init();

    let prover_input_json: &str = unsafe {
        let bytes =
            core::slice::from_raw_parts(prover_input_ptr as *const u8, prover_input_len as usize);
        core::str::from_utf8(bytes).expect("prover_input json not valid UTF-8")
    };

    mark("deserialize-prover-input-started");
    let prover_input: ProverInput =
        sonic_rs::from_str(&prover_input_json).expect("deserialize prover_input");
    mark("deserialize-prover-input-ended");
    measure(
        "deserialize-prover-input",
        "deserialize-prover-input-started",
        "deserialize-prover-input-ended",
    );
    let proof = _prove(prover_input);
    return_json(call_id, &proof);
}

/// Verify a Cairo proof. Returns `{"ok": true}` if the proof is valid.
///
/// SAFETY: host must ensure (proof_ptr, proof_len) is valid UTF-8 JSON representing
/// `CairoProof<Blake2sMerkleHasher>`.
#[unsafe(no_mangle)]
pub extern "C" fn verify(call_id: u64, proof_ptr: u64, proof_len: u64, with_pedersen: u64) {
    panic_hook_set_once();
    let proof_json: &str = unsafe {
        let bytes = core::slice::from_raw_parts(proof_ptr as *const u8, proof_len as usize);
        core::str::from_utf8(bytes).expect("proof json not valid UTF-8")
    };
    mark("deserialize-proof-started");
    let proof: CairoProof<Blake2sMerkleHasher> =
        sonic_rs::from_str(proof_json).expect("deserialize proof");
    mark("deserialize-proof-ended");
    measure(
        "deserialize-proof",
        "deserialize-proof-started",
        "deserialize-proof-ended",
    );

    let ok = _verify(proof, with_pedersen != 0);

    #[derive(Serialize)]
    struct VerifyResult {
        ok: bool,
    }
    let res = VerifyResult { ok };
    return_json(call_id, &res);
}

/// Allocate `size` bytes and return the pointer (u64). Returns 0 on size==0.
/// Memory is uninitialized.
/// SAFETY: The caller must ensure the allocated memory is eventually freed.
#[unsafe(no_mangle)]
pub extern "C" fn malloc(size: u64) -> u64 {
    panic_hook_set_once();
    let usize_size: usize = match usize::try_from(size) {
        Ok(v) => v,
        Err(_) => panic!("size too large for this platform"),
    };

    let align: usize = 8;

    if let Ok(layout) = Layout::from_size_align(usize_size, align) {
        unsafe {
            if layout.size() > 0 {
                let ptr = alloc(layout);
                if !ptr.is_null() {
                    return ptr as usize as u64;
                }
            } else {
                return align as u64;
            }
        }
    }

    panic!("allocation failed");
}

/// Deallocate a block previously allocated with `malloc`.
/// SAFETY: The (ptr,size) pair must exactly match a previous successful `malloc` call.
#[unsafe(no_mangle)]
pub extern "C" fn free(ptr: u64, size: u64) {
    panic_hook_set_once();
    if ptr == 0 || size == 0 {
        return;
    }
    let usize_ptr: usize = match usize::try_from(ptr) {
        Ok(v) => v,
        Err(_) => panic!("pointer too large for this platform"),
    };
    let usize_size: usize = match usize::try_from(size) {
        Ok(v) => v,
        Err(_) => panic!("size too large for this platform"),
    };
    unsafe {
        let layout = Layout::from_size_align(usize_size, 8).expect("invalid layout");
        dealloc(usize_ptr as *mut u8, layout);
    }
}

#[cfg(test)]
fn test_e2e() {
    let executable_json = include_str!("example_executable.json");
    let args = vec![Arg::Value(Felt252::from(100))];

    log(LogLevel::Info, "Running execute...");

    let prover_input = _execute(executable_json, args);
    let prover_input_json = sonic_rs::to_string(&prover_input).expect("serialize prover_input");
    let prover_input2: ProverInput =
        sonic_rs::from_str(&prover_input_json).expect("deserialize prover_input");

    let with_pedersen = _contains_pedersen(&prover_input2);

    log(LogLevel::Info, "Running prove...");

    let cairo_proof = _prove(prover_input2);

    log(LogLevel::Info, "Running verify...");

    let result = _verify(cairo_proof, with_pedersen);
    assert!(result, "cairo proof verification failed");
}

#[cfg(test)]
fn test_crypto_get_random() {
    let buf = [0u8; 32];
    unsafe {
        __crypto_get_random(buf.as_ptr() as u64, buf.len() as u64);
    }
    assert!(!buf.iter().all(|&b| b == 0), "buf is all zeros");
    let s = format!("{:?}", &buf);
    log(LogLevel::Debug, &s);
}

/// Run tests
#[cfg(test)]
#[unsafe(no_mangle)]
pub extern "C" fn test(call_id: u64) {
    panic_hook_set_once();
    log(LogLevel::Info, "Starting tests...");

    test_e2e();
    test_crypto_get_random();

    return_string(call_id, "Success!");
}
