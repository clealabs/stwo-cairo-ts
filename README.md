# S-two Cairo TS [![npm](https://img.shields.io/npm/v/stwo-cairo.svg?style=flat-square)](https://www.npmjs.org/package/stwo-cairo) [![npm downloads](https://img.shields.io/npm/dm/stwo-cairo.svg?style=flat-square)](https://npm-stat.com/charts.html?package=stwo-cairo) [![Build status](https://img.shields.io/github/actions/workflow/status/clealabs/stwo-cairo-ts/test.yaml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/clealabs/stwo-cairo-ts/actions/workflows/test.yaml)

This is a Typescript library compatible with [cairo-prove](https://github.com/starkware-libs/stwo-cairo/blob/main/cairo-prove/README.md). It targets modern browsers supporting the [Memory64](https://webassembly.org/features/) WebAssembly feature.

## Installation

```sh
npm i stwo-cairo
```

## Server settings

All responses from your app must send these headers to satisfy the browser [security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements) for SharedArrayBuffer:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

## Usage

Executing and generating a proof of execution for a compiled Cairo program:

```ts
import { init, execute, containsPedersenBuiltin, prove } from "stwo-cairo";

init(); // optional: call this on page load

const executable = "..."; // Cairo executable JSON string
const args = [1n, 2n]; // arguments for the program

const prover_input = await execute(executable, ...args); // the execution trace
const with_pedersen = containsPedersenBuiltin(prover_input); // for the verifier
const proof = await prove(prover_input); // the generated Cairo proof
```

Verifying a proof:

```ts
import { verify } from "stwo-cairo";

const verdict = await verify(proof, with_pedersen); // whether the proof is valid
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
