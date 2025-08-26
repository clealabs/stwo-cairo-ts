// Guest: imports a host function `host_print(ptr: u64, len: u64)` from module "host"
// and exports `run` which calls it with a pointer/length into the guest linear memory.
use getrandom::Error;
use std::panic;

use cairo_air::{CairoProof, PreProcessedTraceVariant, verifier::verify_cairo};
use cairo_lang_runner::Arg;
use cairo_prove::{
    execute::execute,
    prove::{prove as cairo_prove, prover_input_from_runner},
};
use cairo_vm::Felt252;
use stwo_cairo_adapter::ProverInput;
use stwo_cairo_prover::{
    prover::prove_cairo,
    stwo_prover::core::{
        fri::FriConfig,
        pcs::PcsConfig,
        prover::ProvingError,
        vcs::blake2_merkle::{Blake2sMerkleChannel, Blake2sMerkleHasher},
    },
};

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    fn host_print(ptr: u64, len: u64);
}

/// https://github.com/rustwasm/console_error_panic_hook/blob/master/src/lib.rs
pub fn hook(info: &panic::PanicHookInfo) {
    let msg = info.to_string();
    let ptr = msg.as_ptr() as u64;
    let len = msg.len() as u64;
    unsafe {
        host_print(ptr, len);
    }
}

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    fn crypto_get_random(ptr: u64, len: u64);
}

// https://docs.rs/getrandom/0.3.3/getrandom/#custom-backend
#[unsafe(no_mangle)]
unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), Error> {
    let buf = unsafe {
        // fill the buffer with zeros
        core::ptr::write_bytes(dest, 0, len);
        // create mutable byte slice
        core::slice::from_raw_parts_mut(dest, len)
    };
    unsafe {
        crypto_get_random(buf.as_ptr() as u64, buf.len() as u64);
    }
    Ok(())
}

pub fn secure_pcs_config() -> PcsConfig {
    PcsConfig {
        pow_bits: 26,
        fri_config: FriConfig {
            log_last_layer_degree_bound: 0,
            log_blowup_factor: 1,
            n_queries: 70,
        },
    }
}

pub fn execute_and_prove(
    executable_json: &str,
    args: Vec<Arg>,
    pcs_config: PcsConfig,
) -> CairoProof<Blake2sMerkleHasher> {
    // Execute.
    let executable = serde_json::from_str(executable_json).expect("Failed to read executable");
    let runner = execute(executable, args);
    // Prove.
    let prover_input = prover_input_from_runner(&runner);
    cairo_prove(prover_input, pcs_config)
}

pub fn trace_gen(executable_json: &str, args: Vec<Arg>) -> ProverInput {
    let executable = serde_json::from_str(executable_json).expect("Failed to read executable");
    let runner = execute(executable, args);
    prover_input_from_runner(&runner)
}

pub fn prove(prover_input: ProverInput) -> Result<CairoProof<Blake2sMerkleHasher>, ProvingError> {
    prove_cairo::<Blake2sMerkleChannel>(
        prover_input,
        PcsConfig::default(),
        PreProcessedTraceVariant::CanonicalWithoutPedersen,
    )
}

pub fn verify(cairo_proof: CairoProof<Blake2sMerkleHasher>, with_pedersen: bool) -> bool {
    let preprocessed_trace = match with_pedersen {
        true => PreProcessedTraceVariant::Canonical,
        false => PreProcessedTraceVariant::CanonicalWithoutPedersen,
    };
    verify_cairo::<Blake2sMerkleChannel>(cairo_proof, secure_pcs_config(), preprocessed_trace)
        .is_ok()
}

pub fn test_e2e() {
    let executable_json = include_str!("example_executable.json");
    let args = vec![Arg::Value(Felt252::from(100))];
    let pcs_config = PcsConfig::default();

    let msg1 = "Running trace_gen...";
    unsafe {
        host_print(msg1.as_ptr() as u64, msg1.len() as u64);
    }
    let prover_input = trace_gen(executable_json, args);
    let msg2 = "Running prove...";
    unsafe {
        host_print(msg2.as_ptr() as u64, msg2.len() as u64);
    }
    let cairo_proof = prove(prover_input).expect("Failed to prove");
    let preprocessed_trace = PreProcessedTraceVariant::CanonicalWithoutPedersen;
    let msg3 = "Running verify...";
    unsafe {
        host_print(msg3.as_ptr() as u64, msg3.len() as u64);
    }
    let result = verify_cairo::<Blake2sMerkleChannel>(cairo_proof, pcs_config, preprocessed_trace);
    assert!(result.is_ok());
}

pub fn prove_example() {
    let prover_input_json = include_str!("example_prover_input.json");
    let prover_input: ProverInput =
        serde_json::from_str(prover_input_json).expect("Failed to read prover input");
    let msg = "Running prove...";
    unsafe {
        host_print(msg.as_ptr() as u64, msg.len() as u64);
    }
    let cairo_proof = prove(prover_input);
    assert!(cairo_proof.is_ok());
}

pub fn verify_is_prime_7() {
    let proof_json = include_str!("is_prime_proof_7.json");
    let cairo_proof = serde_json::from_str(proof_json).expect("Failed to read cairo proof");
    let msg = "Running verify...";
    unsafe {
        host_print(msg.as_ptr() as u64, msg.len() as u64);
    }
    let verdict = verify(cairo_proof, false);
    assert!(verdict, "cairo proof verification failed");
}

pub fn test_crypto_get_random() {
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

#[unsafe(no_mangle)]
pub extern "C" fn run() {
    panic::set_hook(Box::new(hook));

    let s = "hello, wasm64-unknown-unknown!";
    let ptr = s.as_ptr() as u64;
    let len = s.len() as u64;

    unsafe {
        host_print(ptr, len);
        // panic!("boom");
    }

    test_e2e();
    // prove_example();
    // verify_is_prime_7();
    test_crypto_get_random();

    let msg = "Success!";
    unsafe {
        host_print(msg.as_ptr() as u64, msg.len() as u64);
    }
}
