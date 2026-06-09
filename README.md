# love20-anvil

Local Anvil deployment orchestrator for LOVE20 integration testing.

This repo does not copy Solidity deployment logic from the contract repos. It starts from the opposite premise: if Anvil deployment calls the same per-repo deploy scripts, then a successful local run also regression-tests the code path that future `public_test` and `public` deployments depend on.

## Scope

V1 orchestrates only the repos and contracts that already have public-test style deployment paths:

```text
core -> periphery -> extension -> extension-lp -> group -> group-defaults -> group-delegate -> extension-group -> group-chat -> batch-transfer
```

The legacy `chat` repo is intentionally not part of the default graph.

## Commands

Start a local chain:

```bash
npm run anvil:start
```

Deploy the full graph:

```bash
npm run deploy
```

Deploy dependencies up to one node:

```bash
npm run deploy -- --to group-chat
```

Deploy from one node onward:

```bash
npm run deploy -- --from group-chat
```

Deploy only one node, using existing upstream Anvil address files:

```bash
npm run deploy -- --only group-chat
```

Skip a node:

```bash
npm run deploy -- --skip batch-transfer
```

Generate frontend env:

```bash
npm run env
```

Generate and apply to `../interface-test/.env.local`:

```bash
npm run env:apply
```

Run repo checks and central cross-repo checks:

```bash
npm run check
```

## Deployer

All nodes use the same Anvil deployer:

```text
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

The private key is the first default Anvil key and is stored in `config/deployer.json`. The orchestrator writes each repo's `script/network/anvil/.account` from that config. It only touches the `anvil` network directory and does not update `public_test` or `public` network files.

The `core` repo keeps using its original Foundry `--account` deploy path. To avoid changing `core`, the orchestrator creates an isolated Foundry keystore under `love20-anvil/.home/.foundry/keystores`, links compiler caches from the real user `HOME`, runs core commands with that private `HOME`, then feeds the configured `keystorePassword` to the existing password prompt. Core deploy also runs `forge clean` first so stale generated artifacts cannot point at deleted source files. Because core does not accept the Anvil-specific Foundry output env vars, its `out/` artifacts are mirrored back to `love20-anvil/.foundry/core/out` after core deploy/check commands.

## Outputs

- Per-repo Anvil addresses are written by the original deploy scripts under each repo's `script/network/anvil/address*.params`.
- The orchestrator summarizes those outputs to `state/addresses.json`.
- Foundry artifacts for Anvil runs are isolated or mirrored under `.foundry/<node>/out`.
- Frontend config is generated as `../interface-test/.env.anvil`, with ABI paths pointing at those isolated Anvil artifacts.
- `npm run env:apply` backs up `../interface-test/.env.local` before replacing it.

## Adding a Contract

Add the deployment at the narrowest layer that owns it:

1. Add or update the contract repo's deploy script, usually under `script/deploy`.
2. Make that script write the deployed address to `script/network/anvil/address*.params`.
3. If downstream nodes need the address, add a `sync` or `prefill` entry in `config/deploy.graph.json`.
4. Add the address key to the node's `outputFiles.requiredKeys`.
5. If the frontend needs the address, add the env binding in `src/env.mjs`.
6. Run `npm run deploy -- --to <node>`, then `npm run check`, then `npm run env`.

## Design Rules

- The DAG is fixed in `config/deploy.graph.json`.
- The orchestrator performs preflight checks for Foundry tools, RPC chain id, deployer balance, and repo paths.
- Before each deploy, upstream address files are copied into downstream Anvil network dirs.
- After each deploy, required address keys are validated.
- `npm run check` prefers each repo's existing check script, then adds cross-repo address consistency and chain-code existence checks.
