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

// Wasm imports

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn host_print(ptr: u64, len: u64);
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn return_string(call_id: u64, ptr: u64, len: u64);
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    pub(crate) fn crypto_get_random(ptr: u64, len: u64);
}

/// https://docs.rs/getrandom/0.3.3/getrandom/#custom-backend
#[unsafe(no_mangle)]
unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), Error> {
    let buf = unsafe {
        core::ptr::write_bytes(dest, 0, len);
        core::slice::from_raw_parts_mut(dest, len)
    };
    unsafe {
        crypto_get_random(buf.as_ptr() as u64, buf.len() as u64);
    }
    Ok(())
}

/// https://github.com/rustwasm/console_error_panic_hook/blob/master/src/lib.rs
fn hook(info: &panic::PanicHookInfo) {
    let msg = info.to_string();
    let ptr = msg.as_ptr() as u64;
    let len = msg.len() as u64;
    unsafe {
        host_print(ptr, len);
    }
}

#[inline]
fn panic_hook_set_once() {
    use std::sync::Once;
    static SET_HOOK: Once = Once::new();
    SET_HOOK.call_once(|| {
        panic::set_hook(Box::new(hook));
    });
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
    let executable = serde_json::from_str(executable_json).expect("Failed to read executable");
    let runner = cairo_execute(executable, args);
    prover_input_from_runner(&runner)
}

fn _prove(prover_input: ProverInput) -> CairoProof<Blake2sMerkleHasher> {
    cairo_prove(prover_input, secure_pcs_config())
}

fn _verify(cairo_proof: CairoProof<Blake2sMerkleHasher>, with_pedersen: bool) -> bool {
    let preprocessed_trace = match with_pedersen {
        true => PreProcessedTraceVariant::Canonical,
        false => PreProcessedTraceVariant::CanonicalWithoutPedersen,
    };
    verify_cairo::<Blake2sMerkleChannel>(cairo_proof, secure_pcs_config(), preprocessed_trace)
        .is_ok()
}

fn _contains_pedersen(prover_input: &ProverInput) -> bool {
    prover_input.public_segment_context[1]
}

// TODO add #[cfg(test)] to exclude from release build
fn test_e2e() {
    let executable_json = include_str!("example_executable.json");
    let args = vec![Arg::Value(Felt252::from(100))];

    let msg1 = "Running execute...";
    unsafe {
        host_print(msg1.as_ptr() as u64, msg1.len() as u64);
    }

    let prover_input = _execute(executable_json, args);
    let prover_input_json = serde_json::to_string(&prover_input).expect("serialize prover_input");
    let prover_input2: ProverInput =
        serde_json::from_str(&prover_input_json).expect("deserialize prover_input");

    let with_pedersen = _contains_pedersen(&prover_input2);

    let msg2 = "Running prove...";
    unsafe {
        host_print(msg2.as_ptr() as u64, msg2.len() as u64);
    }

    let cairo_proof = _prove(prover_input2);

    let msg3 = "Running verify...";
    unsafe {
        host_print(msg3.as_ptr() as u64, msg3.len() as u64);
    }

    let result = _verify(cairo_proof, with_pedersen);
    assert!(result, "cairo proof verification failed");
}

// TODO add #[cfg(test)] to exclude from release build
fn test_crypto_get_random() {
    let buf = [0u8; 32];
    unsafe {
        crypto_get_random(buf.as_ptr() as u64, buf.len() as u64);
    }
    assert!(!buf.iter().all(|&b| b == 0), "buf is all zeros");
    unsafe {
        let s = format!("{:?}", &buf);
        host_print(s.as_ptr() as u64, s.len() as u64);
    }
}

/// Wrapper around `return_string` with JSON serialization.
fn return_json<T: Serialize>(call_id: u64, value: &T) {
    unsafe {
        let msg = "Serializing return value...";
        host_print(msg.as_ptr() as u64, msg.len() as u64);
    }
    let json = sonic_rs::to_string(value).expect("serialize return value");
    unsafe {
        let msg = "Returning JSON string...";
        host_print(msg.as_ptr() as u64, msg.len() as u64);
    }
    unsafe { return_string(call_id, json.as_ptr() as u64, json.len() as u64) };
}

#[unsafe(no_mangle)]
pub extern "C" fn execute_and_prove(
    call_id: u64,
    exe_ptr: u64,
    exe_len: u64,
    args_ptr: u64,
    args_len: u64,
) {
    panic_hook_set_once();
    // let executable_json = include_str!("example_executable.json");
    // let args = vec![Arg::Value(Felt252::from(100))];

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

    let msg1 = "Running execute...";
    unsafe {
        host_print(msg1.as_ptr() as u64, msg1.len() as u64);
    }

    let prover_input = _execute(executable_json, args);

    // let with_pedersen = _contains_pedersen(&prover_input);

    let msg2 = "Running prove...";
    unsafe {
        host_print(msg2.as_ptr() as u64, msg2.len() as u64);
    }

    let cairo_proof = _prove(prover_input);

    let msg3 = "Returning string...";
    unsafe {
        host_print(msg3.as_ptr() as u64, msg3.len() as u64);
    }

    return_json(call_id, &cairo_proof);
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
    let prover_input_json: &str = unsafe {
        let bytes =
            core::slice::from_raw_parts(prover_input_ptr as *const u8, prover_input_len as usize);
        core::str::from_utf8(bytes).expect("prover_input json not valid UTF-8")
    };

    let prover_input: ProverInput =
        serde_json::from_str(&prover_input_json).expect("deserialize prover_input");
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
    let proof: CairoProof<Blake2sMerkleHasher> =
        serde_json::from_str(proof_json).expect("deserialize proof");
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

/// Run tests
// TODO add #[cfg(test)] to exclude from release build
#[unsafe(no_mangle)]
pub extern "C" fn test(call_id: u64) {
    panic_hook_set_once();

    test_e2e();
    test_crypto_get_random();

    let msg = "Success!";
    unsafe {
        return_string(call_id, msg.as_ptr() as u64, msg.len() as u64);
    }
}
