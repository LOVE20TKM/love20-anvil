import { spawnSync } from 'node:child_process';

import { repoRoot } from './lib.mjs';

const MAX_RECEIPT_BLOCKS = 80;

export const anvilAccounts = [
  {
    role: 'deployer/bootstrap',
    label: 'account0',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account1',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account2',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account3',
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account4',
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account5',
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  },
  {
    role: 'fair-launch/governance/action voter/speaker',
    label: 'account6',
    address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    privateKey: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  },
  {
    role: 'chain-group service provider',
    label: 'account7',
    address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    privateKey: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  },
  {
    role: 'chain-group action participant',
    label: 'account8',
    address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    privateKey: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  },
  {
    role: 'negative sample',
    label: 'account9',
    address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    privateKey: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  },
];

function lower(value) {
  return String(value || '').toLowerCase();
}

export class CastRunner {
  constructor({ rpcUrl, root = repoRoot, verbose = true }) {
    this.rpcUrl = rpcUrl;
    this.root = root;
    this.verbose = verbose;
    this.pendingNonces = new Map();
  }

  run(args, context = {}, options = {}) {
    const result = spawnSync('cast', args, {
      cwd: this.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0 && !options.allowFailure) {
      const message = [
        `cast failed (${result.status ?? 'signal'})`,
        `stage=${context.stage || '(unknown)'}`,
        `account=${context.account?.label || context.account || '(n/a)'}`,
        `contract=${context.contract || '(n/a)'}`,
        `function=${context.fn || args.join(' ')}`,
        `args=${JSON.stringify(context.args || [], (_, value) => (
          typeof value === 'bigint' ? value.toString() : value
        ))}`,
        result.stderr.trim() || result.stdout.trim(),
      ].filter(Boolean).join('\n');
      throw new Error(message);
    }

    return {
      ok: result.status === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      status: result.status,
    };
  }

  call(address, signature, args = [], context = {}) {
    const result = this.run(
      [
        'call',
        address,
        signature,
        ...args.map(String),
        ...(context.from ? ['--from', context.from] : []),
        ...(context.json ? ['--json'] : []),
        '--rpc-url',
        this.rpcUrl,
      ],
      {
        ...context,
        contract: context.contract || address,
        fn: context.fn || signature,
        args,
      },
      { allowFailure: context.allowFailure },
    );
    if (!result.ok && context.allowFailure) return result;
    return result.stdout;
  }

  callJson(address, signature, args = [], context = {}) {
    const output = this.call(address, signature, args, { ...context, json: true });
    try {
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`${context.stage || signature}: invalid cast JSON output: ${output}`, { cause: error });
    }
  }

  send(address, signature, args = [], account, context = {}, options = {}) {
    if (!account?.privateKey) {
      throw new Error(`Missing private key for ${account?.label || account?.address || '(unknown account)'}`);
    }
    if (!options.async && account?.address) {
      this.pendingNonces.delete(lower(account.address));
    }
    if (this.verbose) {
      console.log(`  ${context.stage || 'send'}: ${account.label} -> ${context.contract || address}.${signature}`);
    }
    return this.run(
      [
        'send',
        address,
        signature,
        ...args.map(String),
        '--private-key',
        account.privateKey,
        '--rpc-url',
        this.rpcUrl,
        '--legacy',
        ...(options.nonce !== undefined ? ['--nonce', String(options.nonce)] : []),
        ...(options.gasLimit !== undefined ? ['--gas-limit', String(options.gasLimit)] : []),
        ...(options.async ? ['--async'] : []),
      ],
      {
        ...context,
        account,
        contract: context.contract || address,
        fn: context.fn || signature,
        args,
      },
      options,
    );
  }

  sendAsync(address, signature, args = [], account, context = {}, options = {}) {
    const nonce = this.nextPendingNonce(account, context);
    const result = this.send(address, signature, args, account, context, { ...options, async: true, nonce });
    this.pendingNonces.set(lower(account.address), nonce + 1n);
    return transactionHashFromOutput(result.stdout);
  }

  nextPendingNonce(account, context = {}) {
    if (!account?.address) {
      throw new Error(`Missing address for ${account?.label || '(unknown account)'}`);
    }
    const key = lower(account.address);
    if (!this.pendingNonces.has(key)) {
      const result = this.run(
        ['nonce', account.address, '--block', 'pending', '--rpc-url', this.rpcUrl],
        {
          ...context,
          account,
          contract: '(nonce)',
          fn: 'nonce',
          args: [account.address],
        },
      );
      this.pendingNonces.set(key, BigInt(result.stdout));
    }
    return this.pendingNonces.get(key);
  }

  rpc(method, params = [], context = {}) {
    const result = this.run(
      ['rpc', method, ...params.map(String), '--rpc-url', this.rpcUrl],
      {
        ...context,
        fn: method,
        args: params,
      },
      { allowFailure: context.allowFailure },
    );
    if (!result.ok && context.allowFailure) return result;
    return result.stdout;
  }

  txValue(address, signature, value, args = [], account, context = {}) {
    if (this.verbose) {
      console.log(`  ${context.stage || 'send'}: ${account.label} -> ${context.contract || address}.${signature} value=${value}`);
    }
    return this.run(
      [
        'send',
        address,
        signature,
        ...args.map(String),
        '--value',
        String(value),
        '--private-key',
        account.privateKey,
        '--rpc-url',
        this.rpcUrl,
        '--legacy',
      ],
      {
        ...context,
        account,
        contract: context.contract || address,
        fn: context.fn || signature,
        args: [value, ...args],
      },
    );
  }
}

export function transactionHashFromOutput(output) {
  const match = String(output || '').match(/0x[a-fA-F0-9]{64}/);
  if (!match) throw new Error(`Missing transaction hash in cast output: ${output}`);
  return match[0];
}

export function mineBlocks(runner, count, stage = 'mine') {
  if (count <= 0) return;
  runner.rpc('anvil_mine', [`0x${Number(count).toString(16)}`], { stage });
}

export function setAutomine(runner, enabled, stage) {
  runner.rpc('evm_setAutomine', [String(enabled)], { stage });
}

export function setIntervalMining(runner, seconds, stage) {
  runner.rpc('anvil_setIntervalMining', [String(seconds)], { stage });
}

export function parseTransactionReceipt(output) {
  const parsed = JSON.parse(output);
  const status = parsed?.status;
  return {
    raw: parsed,
    status: typeof status === 'string' ? status.toLowerCase() : status,
    blockNumber: parsed?.blockNumber,
  };
}

export function waitForTransactionReceipt(runner, txHash, stage, { mine = true } = {}) {
  for (let attempt = 0; attempt < MAX_RECEIPT_BLOCKS; attempt += 1) {
    const raw = runner.rpc('eth_getTransactionReceipt', [txHash], { stage });
    if (raw && raw !== 'null') {
      const receipt = parseTransactionReceipt(raw);
      if (receipt.status !== '0x1' && receipt.status !== 1) {
        throw new Error(`${stage}: transaction failed: ${txHash}`);
      }
      return receipt;
    }
    if (mine) mineBlocks(runner, 1, stage);
  }
  throw new Error(`${stage}: transaction receipt not found: ${txHash}`);
}

export function sendPendingTransaction(runner, address, signature, args, account, context) {
  return {
    txHash: runner.sendAsync(address, signature, args, account, context),
    stage: context.stage || 'send',
  };
}

export function minePendingTransactions(runner, pendingTransactions, stage) {
  if (pendingTransactions.length === 0) return [];
  mineBlocks(runner, 1, `${stage}:mine`);
  return pendingTransactions.map((transaction) => waitForTransactionReceipt(
    runner,
    transaction.txHash,
    `${transaction.stage}:receipt`,
    { mine: false },
  ));
}

export function sendMinedTransaction(runner, address, signature, args, account, context) {
  const txHash = runner.sendAsync(address, signature, args, account, context);
  mineBlocks(runner, 1, `${context.stage || 'send'}:mine`);
  waitForTransactionReceipt(runner, txHash, `${context.stage || 'send'}:receipt`);
  return txHash;
}

export function expectRevertedTransaction(runner, address, signature, args, account, context) {
  const stage = context.stage || 'send';
  if (!context.expectedError) throw new Error(`${stage}: expectedError is required`);

  const selector = runner.run(
    ['sig', context.expectedError],
    { stage: `${stage}:error-selector` },
  ).stdout.toLowerCase();
  const simulation = runner.call(address, signature, args, {
    stage: `${stage}:simulate`,
    from: account.address,
    allowFailure: true,
  });
  if (typeof simulation === 'string' || simulation.ok) {
    throw new Error(`${stage}: expected simulation to revert with ${context.expectedError}`);
  }
  const failure = `${simulation.stderr}\n${simulation.stdout}`.toLowerCase();
  if (!failure.includes(selector)) {
    throw new Error(`${stage}: expected ${context.expectedError} (${selector}), got: ${failure.trim()}`);
  }

  const txHash = runner.sendAsync(address, signature, args, account, context, { gasLimit: 5_000_000 });
  mineBlocks(runner, 1, `${stage}:mine`);
  const raw = runner.rpc('eth_getTransactionReceipt', [txHash], { stage: `${stage}:receipt` });
  if (!raw || raw === 'null') throw new Error(`${stage}: transaction receipt not found: ${txHash}`);
  const receipt = parseTransactionReceipt(raw);
  if (receipt.status !== '0x0' && receipt.status !== 0) {
    throw new Error(`${stage}: expected transaction to revert: ${txHash}`);
  }
  const trace = JSON.parse(runner.rpc('debug_traceTransaction', [txHash], { stage: `${stage}:trace` }));
  const revertData = String(trace.returnValue || trace.output || '').toLowerCase();
  if (!revertData.replace(/^0x/, '').startsWith(selector.replace(/^0x/, ''))) {
    throw new Error(`${stage}: actual transaction expected ${context.expectedError} (${selector}), got: ${revertData || '(empty revert data)'}`);
  }
  return receipt;
}

export function pauseMining(runner, stage) {
  setIntervalMining(runner, 0, `${stage}:disable-interval-mining`);
  setAutomine(runner, false, `${stage}:disable-automine`);
}

export function resumeMining(runner, secondsPerBlock, stage) {
  if (secondsPerBlock !== undefined) {
    setAutomine(runner, false, `${stage}:keep-automine-disabled`);
    setIntervalMining(runner, secondsPerBlock, `${stage}:restore-interval-mining`);
    return;
  }
  setAutomine(runner, true, `${stage}:enable-automine`);
}
