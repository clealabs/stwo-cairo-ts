# stwo-cairo-ts

This is a Typescript library compatible with [cairo-prove](https://github.com/starkware-libs/stwo-cairo/blob/main/cairo-prove/README.md). It targets modern browsers supporting the [Memory64](https://webassembly.org/features/) WebAssembly feature.

## Installation

```sh
npm i stwo-cairo
```

## Server settings

Due to [security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements), the following headers must be set on every request made by your webapp:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: cross-origin
```

## Usage

Executing and generating a proof of execution for a compiled Cairo program:

```ts
import { execute, containsPedersenBuiltin, prove } from "stwo-cairo";

const executable: string = "..."; // Cairo executable JSON string
const args: BigInt[] = [1n, 2n]; // arguments for the program

const prover_input: string = await execute(executable, ...args); // the execution trace
const with_pedersen: boolean = containsPedersenBuiltin(prover_input); // for the verifier
const proof: string = await prove(prover_input); // the generated Cairo proof
```

Verifying a proof:

```ts
import { verify } from "stwo-cairo";

const verdict: boolean = await verify(proof, with_pedersen); // whether the proof is valid
```

## Development

### Build the rust Wasm package

Make sure you have rust installed on your computer and run:

```
pnpm run build:wasm
```

### Run tests

```
pnpm run test:browser
```
