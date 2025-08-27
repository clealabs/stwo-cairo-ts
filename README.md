# stwo-cairo-ts

This is a Typescript library compatible with [cairo-prove](https://github.com/starkware-libs/stwo-cairo/blob/main/cairo-prove/README.md). It targets modern browsers supporting the [Memory64](https://webassembly.org/features/) WebAssembly feature.

## Installation

```sh
npm i stwo-cairo
```

## Usage

Executing and generating a proof of execution for a compiled Cairo program:

```ts
import { execute, prove } from "stwo-cairo";

const executable: string = "..."; // Cairo executable JSON string
const args: BigInt[] = [1n, 2n]; // arguments for the program

const prover_input: string = await execute(executable, args);
const proof: string = await prove(prover_input);
```

Verifying a proof:

```ts
import { verify } from "stwo-cairo";

const verdict: boolean = await verify(proof);
```

## Development

### Build the rust Wasm package

Make sure you have rust installed on your computer and run:

```
npm run build:wasm
```

### Run tests in the browser

```
npm run dev
```
