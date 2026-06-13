import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  isNonZeroAddress,
  loadJson,
  readNodeParams,
  readParamsFile,
  repoRoot,
  zeroAddress,
} from './lib.mjs';

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

export const seedConfig = {
  minFirstTokenBalance: 10_000_000_000_000_000_000_000n,
  minParentBalance: 1_000_000_000_000_000n,
  launchContributionPerAccount: 20_000_000_000_000_000n,
  postLaunchParentTopUp: 5_000_000_000_000_000n,
  groupMintReserve: 10_000_000_000_000_000_000_000n,
  managedGroupMintReserve: 10_000_000_000_000_000_000_000n,
  stakeTokenAmountForLp: 1_000_000_000_000_000n,
  stakeParentAmountForLp: 1_000_000_000_000n,
  stakeTokenAmount: 100_000_000_000_000n,
  submitterStakeTokenAmountForLp: 20_000_000_000_000_000_000_000n,
  submitterStakeParentAmountForLp: 80_000_000_000_000_000n,
  actionMinStake: 100_000_000_000_000n,
  actionJoinAmount: 200_000_000_000_000n,
  groupActivationStakeAmount: 200_000_000_000_000n,
  groupJoinAmount: 200_000_000_000_000n,
  maxRandomAccounts: 3n,
  maxJoinAmountRatio: 1_000_000_000_000_000_000n,
  activationMinGovRatio: 0n,
  serviceGovRatioMultiplier: 0n,
  maxAutoMineBlocks: 80,
  sampleContentPrefix: 'seed group-chat',
};

const postSelectors = {
  ok: '0x00000000',
  scopeRejected: '0xab1f07dd',
  banRejected: '0xa9cc8792',
};

function lower(value) {
  return String(value || '').toLowerCase();
}

function bigintText(value) {
  return BigInt(value).toString();
}

function groupNameFor(account) {
  return `TestSeed${account.label[0].toUpperCase()}${account.label.slice(1)}`;
}

export function groupChatSeedStatePath(root = repoRoot) {
  return join(root, 'state/group-chat-seed.json');
}

export function groupChatSeedRoles(accounts = anvilAccounts) {
  return {
    deployer: accounts[0],
    governors: accounts.slice(1, 7),
    serviceProvider: accounts[7],
    groupActionParticipant: accounts[8],
    negativeSample: accounts[9],
    fundedAccounts: accounts.slice(1, 10),
  };
}

export function groupChatSeedPlan(accounts = anvilAccounts) {
  const roles = groupChatSeedRoles(accounts);
  return [
    { id: 'assets', accounts: roles.fundedAccounts.map((account) => account.label) },
    { id: 'governance-stake', accounts: roles.governors.map((account) => account.label) },
    { id: 'actions', kinds: ['base', 'chain-group', 'chain-group-service'] },
    { id: 'chain-group', serviceProvider: roles.serviceProvider.label, participant: roles.groupActionParticipant.label },
    { id: 'typed-manager-chats', managers: ['token-main', 'token-gov', 'token-action-main', 'token-action-gov'] },
    { id: 'service-provider-chat', owner: roles.serviceProvider.label, banned: roles.negativeSample.label },
    { id: 'sample-messages', samples: ['normal', 'default-sender', 'mention', 'mention-all', 'quote', 'ban-rejected', 'scope-rejected'] },
  ];
}

export function collectGroupChatSeedAddresses(graph, root = repoRoot) {
  const core = readNodeParams(graph, 'core', 'address.params', root);
  const group = readNodeParams(graph, 'group', 'address.group.params', root);
  const groupDefaults = readNodeParams(graph, 'group-defaults', 'address.group.defaults.params', root);
  const extension = readNodeParams(graph, 'extension', 'address.extension.center.params', root);
  const extensionGroup = readNodeParams(graph, 'extension-group', 'address.extension.group.params', root);
  const groupChat = readNodeParams(graph, 'group-chat', 'address.group.chat.params', root);

  const addresses = {
    rootParentTokenAddress: core.rootParentTokenAddress,
    launchAddress: core.launchAddress,
    stakeAddress: core.stakeAddress,
    submitAddress: core.submitAddress,
    voteAddress: core.voteAddress,
    joinAddress: core.joinAddress,
    firstTokenAddress: core.firstTokenAddress,
    groupAddress: group.groupAddress,
    groupDefaultsAddress: groupDefaults.groupDefaultsAddress,
    extensionCenterAddress: extension.centerAddress,
    groupManagerAddress: extensionGroup.groupManagerAddress,
    groupJoinAddress: extensionGroup.groupJoinAddress,
    groupActionFactoryAddress: extensionGroup.groupActionFactoryAddress,
    groupServiceFactoryAddress: extensionGroup.groupServiceFactoryAddress,
    groupChatAddress: groupChat.groupChatAddress,
    groupAdminAddress: groupChat.groupAdminAddress,
    groupBanListAddress: groupChat.groupBanListAddress,
    adminBanSourceAddress: groupChat.adminBanSourceAddress,
    groupMemberAddress: groupChat.groupMemberAddress,
    groupJoinScopeSourceAddress: groupChat.groupJoinScopeSourceAddress,
    tokenMainManagerAddress: groupChat.tokenMainManagerAddress,
    tokenGovManagerAddress: groupChat.tokenGovManagerAddress,
    tokenActionMainManagerAddress: groupChat.tokenActionMainManagerAddress,
    tokenActionGovManagerAddress: groupChat.tokenActionGovManagerAddress,
  };

  const missing = Object.entries(addresses)
    .filter(([, value]) => !isNonZeroAddress(value))
    .map(([key, value]) => `${key}=${value || '(missing)'}`);
  if (missing.length > 0) {
    throw new Error(`Missing group-chat seed address(es): ${missing.join(', ')}`);
  }

  return addresses;
}

export function buildGroupChatSeedState({
  addresses,
  anvil,
  accounts = anvilAccounts,
  actions = {},
  extensions = {},
  groupIds = {},
  managerGroupIds = {},
  samples = {},
  assertions = {},
} = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    anvil,
    status: 'pending',
    addresses,
    accounts: accounts.map((account) => ({
      label: account.label,
      address: account.address,
      role: account.role,
    })),
    actions,
    extensions,
    groupIds,
    managerGroupIds,
    samples,
    assertions,
  };
}

function readSeedState(path) {
  if (!existsSync(path)) return null;
  return loadJson(path);
}

function writeSeedState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function clearGroupChatSeedFailure(state) {
  const cleaned = { ...state };
  delete cleaned.failedAt;
  delete cleaned.error;
  return cleaned;
}

export function readAnvilMetadata(runner) {
  const raw = runner.rpc('anvil_metadata', [], { stage: 'anvil:metadata' });
  const metadata = JSON.parse(raw);
  if (!metadata?.instanceId) {
    throw new Error('Anvil metadata does not include instanceId');
  }
  return {
    chainId: String(metadata.chainId),
    instanceId: metadata.instanceId,
    latestBlockNumber: metadata.latestBlockNumber,
    latestBlockHash: metadata.latestBlockHash,
    clientVersion: metadata.clientVersion,
  };
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
        `args=${JSON.stringify(context.args || [])}`,
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
      ['call', address, signature, ...args.map(String), '--rpc-url', this.rpcUrl],
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

  sendAsync(address, signature, args = [], account, context = {}) {
    const nonce = this.nextPendingNonce(account, context);
    const result = this.send(address, signature, args, account, context, { async: true, nonce });
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
  if (!match) {
    throw new Error(`Missing transaction hash in cast output: ${output}`);
  }
  return match[0];
}

function parseFirstUint(output, fallback = 0n) {
  const match = String(output || '').match(/\d+/);
  return match ? BigInt(match[0]) : fallback;
}

function parseFirstAddress(output) {
  const match = String(output || '').match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : '';
}

function parseBool(output) {
  return /\btrue\b/i.test(String(output || ''));
}

function parseCanPost(output) {
  const allowed = /\btrue\b/i.test(String(output || ''));
  const selectorMatch = String(output || '').match(/0x[a-fA-F0-9]{8}/);
  return {
    allowed,
    reasonCode: selectorMatch ? selectorMatch[0].toLowerCase() : postSelectors.ok,
  };
}

function tuple(values) {
  return `(${values.map((value) => String(value)).join(',')})`;
}

function stringArray(values) {
  return `[${values.map((value) => JSON.stringify(String(value))).join(',')}]`;
}

function uintArray(values) {
  return `[${values.map((value) => String(value)).join(',')}]`;
}

function addressArray(values) {
  return `[${values.map((value) => String(value)).join(',')}]`;
}

function stageError(stage, detail, error) {
  error.message = `[${stage}] ${detail}\n${error.message}`;
  return error;
}

function mineBlocks(runner, count, stage = 'mine') {
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
  for (let attempt = 0; attempt < seedConfig.maxAutoMineBlocks; attempt += 1) {
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

function sendMaybeMined(runner, address, signature, args, account, context, { manualMining = false, allowFailure = false } = {}) {
  if (manualMining) {
    if (allowFailure) throw new Error(`${context.stage || 'send'}: allowFailure is not supported in manual mining mode`);
    return sendMinedTransaction(runner, address, signature, args, account, context);
  }
  return runner.send(address, signature, args, account, context, { allowFailure });
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

function blockNumber(runner, stage = 'block-number') {
  return parseFirstUint(runner.run(['block-number', '--rpc-url', runner.rpcUrl], { stage, fn: 'block-number' }).stdout);
}

function waitUntilRound(runner, contractAddress, minRound, stage) {
  for (let i = 0; i < seedConfig.maxAutoMineBlocks; i += 1) {
    const round = parseFirstUint(runner.call(contractAddress, 'currentRound()(uint256)', [], { stage, contract: contractAddress }));
    if (round >= minRound) return round;
    mineBlocks(runner, 1, stage);
  }
  throw new Error(`[${stage}] round did not reach ${minRound}`);
}

function waitForJoinRoundAtLeast(runner, addresses, targetRound, stage) {
  for (let i = 0; i < seedConfig.maxAutoMineBlocks; i += 1) {
    const round = parseFirstUint(runner.call(addresses.joinAddress, 'currentRound()(uint256)', [], { stage, contract: 'LOVE20Join' }));
    if (round >= targetRound) return round;
    mineBlocks(runner, 1, stage);
  }
  throw new Error(`[${stage}] join round did not reach ${targetRound}`);
}

function waitForFreshCoreRound(runner, addresses, stage) {
  for (let attempt = 0; attempt < seedConfig.maxAutoMineBlocks; attempt += 1) {
    const origin = parseFirstUint(runner.call(addresses.submitAddress, 'originBlocks()(uint256)', [], { stage, contract: 'LOVE20Submit', fn: 'originBlocks' }));
    const phaseBlocks = parseFirstUint(runner.call(addresses.submitAddress, 'phaseBlocks()(uint256)', [], { stage, contract: 'LOVE20Submit', fn: 'phaseBlocks' }));
    const block = blockNumber(runner, stage);
    if (block < origin) {
      mineBlocks(runner, Number(origin - block), stage);
      continue;
    }
    const offset = (block - origin) % phaseBlocks;
    if (offset <= 1n) {
      return parseFirstUint(runner.call(addresses.submitAddress, 'currentRound()(uint256)', [], { stage, contract: 'LOVE20Submit', fn: 'currentRound' }));
    }
    mineBlocks(runner, Number(phaseBlocks - offset + 1n), stage);
  }
  throw new Error(`[${stage}] could not reach a fresh submit/vote round`);
}

function waitForJoinRoundExactly(runner, addresses, targetRound, stage) {
  for (let i = 0; i < seedConfig.maxAutoMineBlocks; i += 1) {
    const round = parseFirstUint(runner.call(addresses.joinAddress, 'currentRound()(uint256)', [], { stage, contract: 'LOVE20Join', fn: 'currentRound' }));
    if (round === targetRound) return round;
    if (round > targetRound) {
      throw new Error(`[${stage}] join round advanced past target ${targetRound}; current=${round}`);
    }
    mineBlocks(runner, 1, stage);
  }
  throw new Error(`[${stage}] join round did not reach exactly ${targetRound}`);
}

function ensureAllowance(runner, token, spender, amount, account, stage, { manualMining = false } = {}) {
  const allowance = parseFirstUint(runner.call(
    token,
    'allowance(address,address)(uint256)',
    [account.address, spender],
    { stage, contract: token, fn: 'allowance' },
  ));
  if (allowance >= amount) return;
  sendMaybeMined(
    runner,
    token,
    'approve(address,uint256)',
    [spender, bigintText(amount)],
    account,
    { stage, contract: token, fn: 'approve' },
    { manualMining },
  );
}

function tokenBalance(runner, token, accountOrAddress, stage = 'balance') {
  const address = typeof accountOrAddress === 'string' ? accountOrAddress : accountOrAddress.address;
  return parseFirstUint(runner.call(token, 'balanceOf(address)(uint256)', [address], { stage, contract: token, fn: 'balanceOf' }));
}

function hasEnoughBalance(runner, token, accounts, amount, stage) {
  return accounts.every((account) => tokenBalance(runner, token, account, stage) >= amount);
}

function launchHasEnded(runner, addresses) {
  const info = runner.call(
    addresses.launchAddress,
    'launchInfo(address)((address,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256))',
    [addresses.firstTokenAddress],
    { stage: 'assets:launch-info', contract: 'LOVE20Launch', fn: 'launchInfo' },
  );
  return /\btrue\b/i.test(info);
}

function launchSecondHalfMinBlocks(runner, addresses) {
  return parseFirstUint(runner.call(
    addresses.launchAddress,
    'SECOND_HALF_MIN_BLOCKS()(uint256)',
    [],
    { stage: 'assets:launch-params', contract: 'LOVE20Launch', fn: 'SECOND_HALF_MIN_BLOCKS' },
  ));
}

function ensureRootParentToken(runner, addresses, accounts, minBalance = seedConfig.minParentBalance) {
  for (const account of accounts) {
    const balance = tokenBalance(runner, addresses.rootParentTokenAddress, account, 'assets:parent-balance');
    if (balance >= minBalance) continue;
    runner.txValue(
      addresses.rootParentTokenAddress,
      'deposit()',
      bigintText(minBalance - balance + seedConfig.postLaunchParentTopUp),
      [],
      account,
      { stage: 'assets:deposit-parent', contract: 'ETH20', fn: 'deposit' },
    );
  }
}

function claimFirstTokenIfPossible(runner, addresses, accounts) {
  if (!launchHasEnded(runner, addresses)) return;
  for (const account of accounts) {
    const claimInfo = runner.call(
      addresses.launchAddress,
      'claimInfo(address,address)(uint256,uint256,bool)',
      [addresses.firstTokenAddress, account.address],
      {
        stage: 'assets:claim-info',
        contract: 'LOVE20Launch',
        fn: 'claimInfo',
        allowFailure: true,
      },
    );
    if (typeof claimInfo !== 'string') continue;
    if (/\btrue\b/i.test(claimInfo)) continue;
    const receiveAmount = parseFirstUint(claimInfo);
    if (receiveAmount === 0n) continue;
    runner.send(
      addresses.launchAddress,
      'claim(address)',
      [addresses.firstTokenAddress],
      account,
      { stage: 'assets:claim', contract: 'LOVE20Launch', fn: 'claim' },
      { allowFailure: true },
    );
  }
}

function distributeFirstTokenFromBootstrap(runner, addresses, accounts, amount) {
  const bootstrap = anvilAccounts[0];
  const lowBalanceAccounts = accounts.filter(
    (account) => tokenBalance(runner, addresses.firstTokenAddress, account, 'assets:distribution-balance') < amount,
  );
  if (lowBalanceAccounts.length === 0) return;

  const totalNeeded = lowBalanceAccounts.reduce((sum, account) => {
    const balance = tokenBalance(runner, addresses.firstTokenAddress, account, 'assets:distribution-needed');
    return sum + (amount - balance);
  }, 0n);
  const bootstrapBalance = tokenBalance(runner, addresses.firstTokenAddress, bootstrap, 'assets:bootstrap-balance');
  if (bootstrapBalance < totalNeeded) {
    throw new Error(`Bootstrap account0 first token balance is too low for distribution. need=${totalNeeded}, balance=${bootstrapBalance}`);
  }

  for (const account of lowBalanceAccounts) {
    const balance = tokenBalance(runner, addresses.firstTokenAddress, account, 'assets:distribution-before');
    const needed = amount - balance;
    if (needed <= 0n) continue;
    runner.send(
      addresses.firstTokenAddress,
      'transfer(address,uint256)',
      [account.address, bigintText(needed)],
      bootstrap,
      { stage: 'assets:distribute-first-token', contract: 'LOVE20Token', fn: 'transfer' },
    );
  }
}

function ensureFirstTokenBalances(runner, addresses, accounts) {
  const targetAccounts = accounts.slice(1, 10);
  if (hasEnoughBalance(runner, addresses.firstTokenAddress, targetAccounts, seedConfig.minFirstTokenBalance, 'assets:first-balance')) {
    ensureRootParentToken(runner, addresses, targetAccounts);
    return;
  }

  ensureRootParentToken(runner, addresses, targetAccounts, seedConfig.launchContributionPerAccount);

  if (!launchHasEnded(runner, addresses)) {
    for (const account of targetAccounts) {
      ensureAllowance(
        runner,
        addresses.rootParentTokenAddress,
        addresses.launchAddress,
        seedConfig.launchContributionPerAccount,
        account,
        'assets:launch-allowance',
      );
      runner.send(
        addresses.launchAddress,
        'contribute(address,uint256,address)',
        [addresses.firstTokenAddress, bigintText(seedConfig.launchContributionPerAccount), account.address],
        account,
        { stage: 'assets:contribute', contract: 'LOVE20Launch', fn: 'contribute' },
      );
    }

    mineBlocks(runner, Number(launchSecondHalfMinBlocks(runner, addresses) + 2n), 'assets:mine-launch-second-half');
    if (!launchHasEnded(runner, addresses)) {
      const account = targetAccounts[0];
      ensureAllowance(
        runner,
        addresses.rootParentTokenAddress,
        addresses.launchAddress,
        1n,
        account,
        'assets:launch-final-allowance',
      );
      runner.send(
        addresses.launchAddress,
        'contribute(address,uint256,address)',
        [addresses.firstTokenAddress, '1', account.address],
        account,
        { stage: 'assets:final-contribute', contract: 'LOVE20Launch', fn: 'contribute' },
      );
    }
    mineBlocks(runner, 2, 'assets:mine-claim-delay');
  }

  claimFirstTokenIfPossible(runner, addresses, targetAccounts);
  distributeFirstTokenFromBootstrap(runner, addresses, targetAccounts, seedConfig.minFirstTokenBalance);

  const lowBalanceAccounts = targetAccounts.filter(
    (account) => tokenBalance(runner, addresses.firstTokenAddress, account, 'assets:first-balance-after-claim') < seedConfig.minFirstTokenBalance,
  );
  if (lowBalanceAccounts.length > 0) {
    const balances = lowBalanceAccounts.map((account) => `${account.label}:${tokenBalance(runner, addresses.firstTokenAddress, account, 'assets:first-balance-report')}`);
    throw new Error(`First token balances are too low after launch/claim: ${balances.join(', ')}`);
  }

  ensureRootParentToken(runner, addresses, targetAccounts);
}

function ensureGovernanceStake(runner, addresses, governors) {
  waitUntilRound(runner, addresses.stakeAddress, 1n, 'stake:wait-round-one');
  for (const account of governors) {
    const validVotes = parseFirstUint(runner.call(
      addresses.stakeAddress,
      'validGovVotes(address,address)(uint256)',
      [addresses.firstTokenAddress, account.address],
      { stage: 'stake:valid-votes', contract: 'LOVE20Stake', fn: 'validGovVotes' },
    ));
    if (validVotes > 0n) continue;

    ensureAllowance(runner, addresses.firstTokenAddress, addresses.stakeAddress, seedConfig.stakeTokenAmountForLp + seedConfig.stakeTokenAmount, account, 'stake:first-allowance');
    ensureAllowance(runner, addresses.rootParentTokenAddress, addresses.stakeAddress, seedConfig.stakeParentAmountForLp, account, 'stake:parent-allowance');
    runner.send(
      addresses.stakeAddress,
      'stakeLiquidity(address,uint256,uint256,uint256,address)',
      [
        addresses.firstTokenAddress,
        bigintText(seedConfig.stakeTokenAmountForLp),
        bigintText(seedConfig.stakeParentAmountForLp),
        '1',
        account.address,
      ],
      account,
      { stage: 'stake:liquidity', contract: 'LOVE20Stake', fn: 'stakeLiquidity' },
    );
    runner.send(
      addresses.stakeAddress,
      'stakeToken(address,uint256,uint256,address)',
      [
        addresses.firstTokenAddress,
        bigintText(seedConfig.stakeTokenAmount),
        '1',
        account.address,
      ],
      account,
      { stage: 'stake:token', contract: 'LOVE20Stake', fn: 'stakeToken' },
    );

    const confirmedVotes = parseFirstUint(runner.call(
      addresses.stakeAddress,
      'validGovVotes(address,address)(uint256)',
      [addresses.firstTokenAddress, account.address],
      { stage: 'stake:confirm-valid-votes', contract: 'LOVE20Stake', fn: 'validGovVotes' },
    ));
    if (confirmedVotes === 0n) {
      throw new Error(`No valid governance votes after staking for ${account.label}`);
    }
  }
}

function canSubmitAction(runner, addresses, account, stage = 'submitter:can-submit') {
  return parseBool(runner.call(
    addresses.submitAddress,
    'canSubmit(address,address)(bool)',
    [addresses.firstTokenAddress, account.address],
    { stage, contract: 'LOVE20Submit', fn: 'canSubmit' },
  ));
}

function ensureActionSubmitterEligibility(runner, addresses, submitters) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const missing = submitters.filter((account) => !canSubmitAction(runner, addresses, account, `submitter:can-submit:${attempt}`));
    if (missing.length === 0) return;

    for (const account of missing) {
      ensureRootParentToken(
        runner,
        addresses,
        [account],
        seedConfig.submitterStakeParentAmountForLp + seedConfig.minParentBalance,
      );
      distributeFirstTokenFromBootstrap(
        runner,
        addresses,
        [account],
        seedConfig.submitterStakeTokenAmountForLp + seedConfig.managedGroupMintReserve,
      );
      ensureAllowance(
        runner,
        addresses.firstTokenAddress,
        addresses.stakeAddress,
        seedConfig.submitterStakeTokenAmountForLp,
        account,
        'submitter:stake-first-allowance',
      );
      ensureAllowance(
        runner,
        addresses.rootParentTokenAddress,
        addresses.stakeAddress,
        seedConfig.submitterStakeParentAmountForLp,
        account,
        'submitter:stake-parent-allowance',
      );
      runner.send(
        addresses.stakeAddress,
        'stakeLiquidity(address,uint256,uint256,uint256,address)',
        [
          addresses.firstTokenAddress,
          bigintText(seedConfig.submitterStakeTokenAmountForLp),
          bigintText(seedConfig.submitterStakeParentAmountForLp),
          '1',
          account.address,
        ],
        account,
        { stage: 'submitter:stake-liquidity', contract: 'LOVE20Stake', fn: 'stakeLiquidity' },
      );
    }
  }

  const totalVotes = parseFirstUint(runner.call(
    addresses.stakeAddress,
    'govVotesNum(address)(uint256)',
    [addresses.firstTokenAddress],
    { stage: 'submitter:total-votes', contract: 'LOVE20Stake', fn: 'govVotesNum' },
  ));
  const submitMinPerThousand = parseFirstUint(runner.call(
    addresses.submitAddress,
    'SUBMIT_MIN_PER_THOUSAND()(uint256)',
    [],
    { stage: 'submitter:min-threshold', contract: 'LOVE20Submit', fn: 'SUBMIT_MIN_PER_THOUSAND' },
  ));
  const reports = submitters.map((account) => {
    const votes = parseFirstUint(runner.call(
      addresses.stakeAddress,
      'validGovVotes(address,address)(uint256)',
      [addresses.firstTokenAddress, account.address],
      { stage: 'submitter:valid-votes-report', contract: 'LOVE20Stake', fn: 'validGovVotes' },
    ));
    return `${account.label}:votes=${votes}`;
  });
  throw new Error(`Seed action submitters still cannot submit. totalVotes=${totalVotes}, SUBMIT_MIN_PER_THOUSAND=${submitMinPerThousand}, ${reports.join(', ')}`);
}

function createExtensionFromFactory(runner, factoryAddress, signature, args, creator, stage) {
  const beforeCount = parseFirstUint(runner.call(factoryAddress, 'extensionsCount()(uint256)', [], { stage, contract: factoryAddress, fn: 'extensionsCount' }));
  runner.send(factoryAddress, signature, args, creator, { stage, contract: factoryAddress, fn: signature });
  const afterCount = parseFirstUint(runner.call(factoryAddress, 'extensionsCount()(uint256)', [], { stage, contract: factoryAddress, fn: 'extensionsCount' }));
  if (afterCount <= beforeCount) {
    throw new Error(`Factory extension count did not increase at ${stage}`);
  }
  return parseFirstAddress(runner.call(
    factoryAddress,
    'extensionsAtIndex(uint256)(address)',
    [bigintText(afterCount - 1n)],
    { stage, contract: factoryAddress, fn: 'extensionsAtIndex' },
  ));
}

function ensureExtension(runner, state, key, addresses, creator, type) {
  if (isNonZeroAddress(state.extensions?.[key])) {
    const exists = parseBool(runner.call(
      type === 'action' ? addresses.groupActionFactoryAddress : addresses.groupServiceFactoryAddress,
      'exists(address)(bool)',
      [state.extensions[key]],
      { stage: `extension:${key}:exists`, contract: type === 'action' ? 'ExtensionGroupActionFactory' : 'ExtensionGroupServiceFactory', fn: 'exists' },
    ));
    if (exists) return state.extensions[key];
    delete state.extensions[key];
  }

  ensureAllowance(runner, addresses.firstTokenAddress, type === 'action' ? addresses.groupActionFactoryAddress : addresses.groupServiceFactoryAddress, 1_000_000_000_000_000_000n, creator, `extension:${key}:default-join-allowance`);

  const extensionAddress = type === 'action'
    ? createExtensionFromFactory(
      runner,
      addresses.groupActionFactoryAddress,
      'createExtension(address,uint256,uint256,address,uint256)',
      [
        addresses.firstTokenAddress,
        bigintText(seedConfig.activationMinGovRatio),
        bigintText(seedConfig.groupActivationStakeAmount),
        addresses.firstTokenAddress,
        bigintText(seedConfig.maxJoinAmountRatio),
      ],
      creator,
      `extension:${key}:create`,
    )
    : createExtensionFromFactory(
      runner,
      addresses.groupServiceFactoryAddress,
      'createExtension(address,address,uint256)',
      [
        addresses.firstTokenAddress,
        addresses.firstTokenAddress,
        bigintText(seedConfig.serviceGovRatioMultiplier),
      ],
      creator,
      `extension:${key}:create`,
    );
  state.extensions[key] = extensionAddress;
  return extensionAddress;
}

function actionBody({ minStake, whiteListAddress, title }) {
  return tuple([
    bigintText(minStake),
    bigintText(seedConfig.maxRandomAccounts),
    whiteListAddress,
    JSON.stringify(title),
    JSON.stringify('seed verification rule'),
    stringArray(['default']),
    stringArray(['seed verification info']),
  ]);
}

function ensureAction(runner, state, key, addresses, author, whiteListAddress, minStake, { manualMining = false, pendingTransactions } = {}) {
  const submitRound = parseFirstUint(runner.call(
    addresses.submitAddress,
    'currentRound()(uint256)',
    [],
    { stage: `action:${key}:submit-round`, contract: 'LOVE20Submit', fn: 'currentRound' },
  ));
  if (
    state.actions?.[key]?.id !== undefined
    && state.actions[key].submitRound === bigintText(submitRound)
    && lower(state.actions[key].whiteListAddress) === lower(whiteListAddress)
  ) {
    const submitted = runner.call(
      addresses.submitAddress,
      'isSubmitted(address,uint256,uint256)(bool)',
      [addresses.firstTokenAddress, bigintText(submitRound), state.actions[key].id],
      { stage: `action:${key}:submitted-current-round`, contract: 'LOVE20Submit', fn: 'isSubmitted', allowFailure: true },
    );
    if (typeof submitted === 'string' && parseBool(submitted)) return BigInt(state.actions[key].id);
  }

  const beforeCount = parseFirstUint(runner.call(
    addresses.submitAddress,
    'actionsCount(address)(uint256)',
    [addresses.firstTokenAddress],
    { stage: `action:${key}:count-before`, contract: 'LOVE20Submit', fn: 'actionsCount' },
  ));
  const sendArgs = [
    addresses.firstTokenAddress,
    actionBody({
      minStake,
      whiteListAddress,
      title: `seed ${key}`,
    }),
  ];
  const sendContext = { stage: `action:${key}:submit-new`, contract: 'LOVE20Submit', fn: 'submitNewAction' };
  if (manualMining && pendingTransactions) {
    const actionId = beforeCount + BigInt(pendingTransactions.length);
    pendingTransactions.push(sendPendingTransaction(
      runner,
      addresses.submitAddress,
      'submitNewAction(address,(uint256,uint256,address,string,string,string[],string[]))',
      sendArgs,
      author,
      sendContext,
    ));
    state.actions[key] = { id: bigintText(actionId), author: author.address, whiteListAddress, submitRound: bigintText(submitRound) };
    return actionId;
  }

  sendMaybeMined(
    runner,
    addresses.submitAddress,
    'submitNewAction(address,(uint256,uint256,address,string,string,string[],string[]))',
    sendArgs,
    author,
    sendContext,
    { manualMining },
  );
  const afterCount = parseFirstUint(runner.call(
    addresses.submitAddress,
    'actionsCount(address)(uint256)',
    [addresses.firstTokenAddress],
    { stage: `action:${key}:count-after`, contract: 'LOVE20Submit', fn: 'actionsCount' },
  ));
  if (afterCount <= beforeCount) {
    throw new Error(`Action count did not increase for ${key}`);
  }
  const actionId = afterCount - 1n;
  state.actions[key] = { id: bigintText(actionId), author: author.address, whiteListAddress, submitRound: bigintText(submitRound) };
  return actionId;
}

function latestActionIdByAuthor(runner, addresses, author, stage) {
  const count = parseFirstUint(runner.call(
    addresses.submitAddress,
    'authorActionIdsCount(address,address)(uint256)',
    [addresses.firstTokenAddress, author.address],
    { stage: `${stage}:author-action-count`, contract: 'LOVE20Submit', fn: 'authorActionIdsCount' },
  ));
  if (count === 0n) throw new Error(`${stage}: author has no actions: ${author.label}`);
  return parseFirstUint(runner.call(
    addresses.submitAddress,
    'authorActionIdsAtIndex(address,address,uint256)(uint256)',
    [addresses.firstTokenAddress, author.address, bigintText(count - 1n)],
    { stage: `${stage}:author-action-id`, contract: 'LOVE20Submit', fn: 'authorActionIdsAtIndex' },
  ));
}

function refreshSubmittedActionIds(runner, state, addresses, actionDescriptors) {
  const resolved = {};

  for (const descriptor of actionDescriptors) {
    const actionId = latestActionIdByAuthor(runner, addresses, descriptor.author, `action:${descriptor.key}:resolve-id`);
    const submitted = parseBool(runner.call(
      addresses.submitAddress,
      'isSubmitted(address,uint256,uint256)(bool)',
      [addresses.firstTokenAddress, bigintText(descriptor.submitRound), bigintText(actionId)],
      { stage: `action:${descriptor.key}:submitted-after-batch`, contract: 'LOVE20Submit', fn: 'isSubmitted' },
    ));
    if (!submitted) {
      throw new Error(`Action ${descriptor.key} was not submitted in round ${descriptor.submitRound}: ${actionId}`);
    }

    state.actions[descriptor.key] = {
      ...state.actions[descriptor.key],
      id: bigintText(actionId),
      author: descriptor.author.address,
      whiteListAddress: descriptor.whiteListAddress,
      submitRound: bigintText(descriptor.submitRound),
    };
    resolved[descriptor.key] = actionId;
  }

  return resolved;
}

function voteActions(runner, addresses, governors, actionIds, { manualMining = false, pendingTransactions } = {}) {
  const round = parseFirstUint(runner.call(addresses.voteAddress, 'currentRound()(uint256)', [], { stage: 'vote:round', contract: 'LOVE20Vote', fn: 'currentRound' }));
  const actionIdArgs = uintArray(actionIds);
  for (const account of governors) {
    const maxVotes = parseFirstUint(runner.call(
      addresses.voteAddress,
      'maxVotesNum(address,address)(uint256)',
      [addresses.firstTokenAddress, account.address],
      { stage: 'vote:max-votes', contract: 'LOVE20Vote', fn: 'maxVotesNum' },
    ));
    if (maxVotes === 0n) continue;
    const perAction = maxVotes / BigInt(actionIds.length);
    if (perAction === 0n) continue;
    const votes = actionIds.map(() => perAction);
    const alreadyVoted = actionIds.every((actionId) => parseFirstUint(runner.call(
      addresses.voteAddress,
      'votesNumByAccountByActionId(address,uint256,address,uint256)(uint256)',
      [addresses.firstTokenAddress, bigintText(round), account.address, bigintText(actionId)],
      { stage: 'vote:already', contract: 'LOVE20Vote', fn: 'votesNumByAccountByActionId' },
    )) > 0n);
    if (alreadyVoted) continue;
    const sendArgs = [addresses.firstTokenAddress, actionIdArgs, uintArray(votes)];
    const sendContext = { stage: 'vote:actions', contract: 'LOVE20Vote', fn: 'vote' };
    if (manualMining && pendingTransactions) {
      pendingTransactions.push(sendPendingTransaction(
        runner,
        addresses.voteAddress,
        'vote(address,uint256[],uint256[])',
        sendArgs,
        account,
        sendContext,
      ));
    } else {
      sendMaybeMined(
        runner,
        addresses.voteAddress,
        'vote(address,uint256[],uint256[])',
        sendArgs,
        account,
        sendContext,
        { manualMining },
      );
    }
  }

  if (manualMining && pendingTransactions) return round;

  confirmVotedActions(runner, addresses, actionIds, round);
  return round;
}

function confirmVotedActions(runner, addresses, actionIds, round) {
  for (const actionId of actionIds) {
    const voted = parseBool(runner.call(
      addresses.voteAddress,
      'isActionIdVoted(address,uint256,uint256)(bool)',
      [addresses.firstTokenAddress, bigintText(round), bigintText(actionId)],
      { stage: 'vote:confirm', contract: 'LOVE20Vote', fn: 'isActionIdVoted' },
    ));
    if (!voted) throw new Error(`Action ${actionId} was not voted in round ${round}`);
  }
}

function ensureActionSetup(runner, state, addresses, roles, { secondsPerBlock, resumeMiningAfterSuccess = true } = {}) {
  state.actions ||= {};
  state.extensions ||= {};

  delete state.extensions.chainGroupAction;
  delete state.extensions.chainGroupService;

  const groupActionExtension = ensureExtension(runner, state, 'chainGroupAction', addresses, roles.governors[1], 'action');
  const groupServiceExtension = ensureExtension(runner, state, 'chainGroupService', addresses, roles.governors[2], 'service');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let completed = false;
    pauseMining(runner, `action:manual-mining:${attempt}`);
    try {
      const freshRound = waitForFreshCoreRound(runner, addresses, `action:wait-fresh-round:${attempt}`);
      delete state.actions.base;
      delete state.actions.chainGroupAction;
      delete state.actions.chainGroupService;

      const manualMining = true;
      const pendingSubmits = [];
      ensureAction(runner, state, 'base', addresses, roles.governors[0], zeroAddress, seedConfig.actionMinStake, { manualMining, pendingTransactions: pendingSubmits });
      ensureAction(runner, state, 'chainGroupAction', addresses, roles.governors[1], groupActionExtension, seedConfig.groupJoinAmount, { manualMining, pendingTransactions: pendingSubmits });
      ensureAction(runner, state, 'chainGroupService', addresses, roles.governors[2], groupServiceExtension, seedConfig.actionMinStake, { manualMining, pendingTransactions: pendingSubmits });
      minePendingTransactions(runner, pendingSubmits, `action:manual-mining:${attempt}:submits`);
      const resolvedActionIds = refreshSubmittedActionIds(runner, state, addresses, [
        { key: 'base', author: roles.governors[0], whiteListAddress: zeroAddress, submitRound: freshRound },
        { key: 'chainGroupAction', author: roles.governors[1], whiteListAddress: groupActionExtension, submitRound: freshRound },
        { key: 'chainGroupService', author: roles.governors[2], whiteListAddress: groupServiceExtension, submitRound: freshRound },
      ]);
      const { base: baseActionId, chainGroupAction: groupActionId, chainGroupService: serviceActionId } = resolvedActionIds;

      const voteRound = parseFirstUint(runner.call(addresses.voteAddress, 'currentRound()(uint256)', [], { stage: 'vote:round-before-vote', contract: 'LOVE20Vote', fn: 'currentRound' }));
      const submitRounds = ['base', 'chainGroupAction', 'chainGroupService'].map((key) => BigInt(state.actions[key].submitRound));
      if (voteRound !== freshRound || submitRounds.some((round) => round !== voteRound)) {
        continue;
      }

      const pendingVotes = [];
      const confirmedVoteRound = voteActions(
        runner,
        addresses,
        roles.governors.slice(0, 3),
        [baseActionId, groupActionId, serviceActionId],
        { manualMining, pendingTransactions: pendingVotes },
      );
      minePendingTransactions(runner, pendingVotes, `action:manual-mining:${attempt}:votes`);
      confirmVotedActions(runner, addresses, [baseActionId, groupActionId, serviceActionId], confirmedVoteRound);

      state.actions.base.voteRound = bigintText(confirmedVoteRound);
      state.actions.chainGroupAction.voteRound = bigintText(confirmedVoteRound);
      state.actions.chainGroupService.voteRound = bigintText(confirmedVoteRound);

      completed = true;
      return { baseActionId, groupActionId, serviceActionId, groupActionExtension, groupServiceExtension, voteRound: confirmedVoteRound };
    } finally {
      if (!completed || resumeMiningAfterSuccess) {
        resumeMining(runner, secondsPerBlock, `action:manual-mining:${attempt}`);
      }
    }
  }

  throw new Error('Could not submit and vote all seed actions in one current round');
}

function ensureBaseActionJoins(runner, addresses, accounts, baseActionId, { manualMining = false, pendingTransactions } = {}) {
  for (const account of accounts.slice(1, 5)) {
    const joinedAmount = parseFirstUint(runner.call(
      addresses.joinAddress,
      'amountByActionIdByAccount(address,uint256,address)(uint256)',
      [addresses.firstTokenAddress, bigintText(baseActionId), account.address],
      { stage: 'join:base:amount', contract: 'LOVE20Join', fn: 'amountByActionIdByAccount' },
    ));
    if (joinedAmount > 0n) continue;
    ensureAllowance(runner, addresses.firstTokenAddress, addresses.joinAddress, seedConfig.actionJoinAmount, account, 'join:base:allowance', { manualMining });
    const sendArgs = [addresses.firstTokenAddress, bigintText(baseActionId), bigintText(seedConfig.actionJoinAmount), stringArray(['seed base join'])];
    const sendContext = { stage: 'join:base', contract: 'LOVE20Join', fn: 'join' };
    if (manualMining && pendingTransactions) {
      pendingTransactions.push(sendPendingTransaction(
        runner,
        addresses.joinAddress,
        'join(address,uint256,uint256,string[])',
        sendArgs,
        account,
        sendContext,
      ));
    } else {
      sendMaybeMined(
        runner,
        addresses.joinAddress,
        'join(address,uint256,uint256,string[])',
        sendArgs,
        account,
        sendContext,
        { manualMining },
      );
    }
  }
}

function ensureExtensionInitialized(runner, extensionAddress, account, stage, contract, { manualMining = false, pendingTransactions } = {}) {
  const initialized = parseBool(runner.call(
    extensionAddress,
    'initialized()(bool)',
    [],
    { stage: `${stage}:initialized`, contract, fn: 'initialized' },
  ));
  if (initialized) return;
  const sendContext = { stage, contract, fn: 'initializeIfNeeded' };
  if (manualMining && pendingTransactions) {
    pendingTransactions.push(sendPendingTransaction(
      runner,
      extensionAddress,
      'initializeIfNeeded()',
      [],
      account,
      sendContext,
    ));
  } else {
    sendMaybeMined(
      runner,
      extensionAddress,
      'initializeIfNeeded()',
      [],
      account,
      sendContext,
      { manualMining },
    );
  }
}

function ensureGroupNft(runner, addresses, account, state) {
  const name = groupNameFor(account);
  const existing = parseFirstUint(runner.call(
    addresses.groupAddress,
    'tokenIdOf(string)(uint256)',
    [name],
    { stage: `group:${account.label}:token-id`, contract: 'LOVE20Group', fn: 'tokenIdOf' },
  ));
  let groupId = existing;
  if (groupId === 0n) {
    const cost = parseFirstUint(runner.call(
      addresses.groupAddress,
      'calculateMintCost(string)(uint256)',
      [name],
      { stage: `group:${account.label}:mint-cost`, contract: 'LOVE20Group', fn: 'calculateMintCost' },
    ));
    ensureAllowance(runner, addresses.firstTokenAddress, addresses.groupAddress, cost, account, `group:${account.label}:allowance`);
    runner.send(
      addresses.groupAddress,
      'mint(string)',
      [name],
      account,
      { stage: `group:${account.label}:mint`, contract: 'LOVE20Group', fn: 'mint' },
    );
    groupId = parseFirstUint(runner.call(
      addresses.groupAddress,
      'tokenIdOf(string)(uint256)',
      [name],
      { stage: `group:${account.label}:token-id-after`, contract: 'LOVE20Group', fn: 'tokenIdOf' },
    ));
  }

  if (groupId === 0n) throw new Error(`Group NFT was not minted for ${account.label}`);
  state.groupIds[account.label] = bigintText(groupId);

  const defaultGroup = parseFirstUint(runner.call(
    addresses.groupDefaultsAddress,
    'defaultGroupIdOf(address)(uint256)',
    [account.address],
    { stage: `group:${account.label}:default`, contract: 'GroupDefaults', fn: 'defaultGroupIdOf' },
  ));
  if (defaultGroup !== groupId) {
    runner.send(
      addresses.groupDefaultsAddress,
      'setDefaultGroupId(uint256)',
      [bigintText(groupId)],
      account,
      { stage: `group:${account.label}:set-default`, contract: 'GroupDefaults', fn: 'setDefaultGroupId' },
      { allowFailure: defaultGroup === groupId },
    );
  }

  return groupId;
}

function ensureGroupNfts(runner, addresses, accounts, state) {
  state.groupIds ||= {};
  for (const account of accounts.slice(1, 10)) {
    ensureGroupNft(runner, addresses, account, state);
  }
}

function prepareJoinRoundAllowances(runner, addresses, roles) {
  for (const account of roles.governors.slice(0, 4)) {
    ensureAllowance(runner, addresses.firstTokenAddress, addresses.joinAddress, seedConfig.actionJoinAmount, account, 'prepare:base-join-allowance');
  }
  ensureAllowance(
    runner,
    addresses.firstTokenAddress,
    addresses.groupManagerAddress,
    seedConfig.groupActivationStakeAmount,
    roles.serviceProvider,
    'prepare:group-manager-allowance',
  );
  ensureAllowance(
    runner,
    addresses.firstTokenAddress,
    addresses.groupJoinAddress,
    seedConfig.groupJoinAmount,
    roles.groupActionParticipant,
    'prepare:group-join-allowance',
  );
}

function ensureChainGroupAction(
  runner,
  state,
  addresses,
  roles,
  groupActionExtension,
  { manualMining = false, pendingTransactions, activationOnly = false } = {},
) {
  const serviceGroupId = BigInt(state.groupIds[roles.serviceProvider.label]);
  const active = parseBool(runner.call(
    addresses.groupManagerAddress,
    'isGroupActive(address,uint256)(bool)',
    [groupActionExtension, bigintText(serviceGroupId)],
    { stage: 'chain-group:is-active', contract: 'GroupManager', fn: 'isGroupActive' },
  ));
  if (!active) {
    ensureAllowance(runner, addresses.firstTokenAddress, addresses.groupManagerAddress, seedConfig.groupActivationStakeAmount, roles.serviceProvider, 'chain-group:activation-allowance', { manualMining });
    const sendArgs = [
      groupActionExtension,
      bigintText(serviceGroupId),
      'seed chain group',
      '0',
      bigintText(seedConfig.groupJoinAmount),
      '0',
      '0',
    ];
    const sendContext = { stage: 'chain-group:activate', contract: 'GroupManager', fn: 'activateGroup' };
    if (manualMining && pendingTransactions) {
      pendingTransactions.push(sendPendingTransaction(
        runner,
        addresses.groupManagerAddress,
        'activateGroup(address,uint256,string,uint256,uint256,uint256,uint256)',
        sendArgs,
        roles.serviceProvider,
        sendContext,
      ));
      if (activationOnly) {
        state.groupIds.chainGroupServiceProviderChatSource = bigintText(serviceGroupId);
        return serviceGroupId;
      }
    } else {
      sendMaybeMined(
        runner,
        addresses.groupManagerAddress,
        'activateGroup(address,uint256,string,uint256,uint256,uint256,uint256)',
        sendArgs,
        roles.serviceProvider,
        sendContext,
        { manualMining },
      );
    }
  }

  const participant = roles.groupActionParticipant;
  const currentRound = parseFirstUint(runner.call(
    addresses.joinAddress,
    'currentRound()(uint256)',
    [],
    { stage: 'chain-group:current-round', contract: 'LOVE20Join', fn: 'currentRound' },
  ));
  const joinedGroupId = parseFirstUint(runner.call(
    addresses.groupJoinAddress,
    'groupIdByAccount(address,uint256,address)(uint256)',
    [groupActionExtension, bigintText(currentRound), participant.address],
    { stage: 'chain-group:participant-state', contract: 'GroupJoin', fn: 'groupIdByAccount' },
  ));
  if (joinedGroupId !== serviceGroupId) {
    ensureAllowance(runner, addresses.firstTokenAddress, addresses.groupJoinAddress, seedConfig.groupJoinAmount, participant, 'chain-group:join-allowance', { manualMining });
    const sendArgs = [groupActionExtension, bigintText(serviceGroupId), bigintText(seedConfig.groupJoinAmount), stringArray(['seed group action join'])];
    const sendContext = { stage: 'chain-group:join', contract: 'GroupJoin', fn: 'join' };
    if (manualMining && pendingTransactions) {
      pendingTransactions.push(sendPendingTransaction(
        runner,
        addresses.groupJoinAddress,
        'join(address,uint256,uint256,string[])',
        sendArgs,
        participant,
        sendContext,
      ));
    } else {
      sendMaybeMined(
        runner,
        addresses.groupJoinAddress,
        'join(address,uint256,uint256,string[])',
        sendArgs,
        participant,
        sendContext,
        { manualMining },
      );
    }
  }

  state.groupIds.chainGroupServiceProviderChatSource = bigintText(serviceGroupId);
  return serviceGroupId;
}

function ensureGroupServiceJoin(runner, state, addresses, roles, groupServiceExtension, { manualMining = false, pendingTransactions } = {}) {
  const serviceProvider = roles.serviceProvider;
  const joinedRound = parseFirstUint(runner.call(
    groupServiceExtension,
    'joinInfo(address)(uint256)',
    [serviceProvider.address],
    { stage: 'group-service:join-info', contract: 'ExtensionGroupService', fn: 'joinInfo' },
  ));
  if (joinedRound === 0n) {
    const sendArgs = [stringArray(['seed service provider'])];
    const sendContext = { stage: 'group-service:join', contract: 'ExtensionGroupService', fn: 'join' };
    if (manualMining && pendingTransactions) {
      pendingTransactions.push(sendPendingTransaction(
        runner,
        groupServiceExtension,
        'join(string[])',
        sendArgs,
        serviceProvider,
        sendContext,
      ));
    } else {
      sendMaybeMined(
        runner,
        groupServiceExtension,
        'join(string[])',
        sendArgs,
        serviceProvider,
        sendContext,
        { manualMining },
      );
    }
  }
  state.extensions.chainGroupService = groupServiceExtension;
}

function ensureJoinSetup(runner, state, addresses, roles, setup, { secondsPerBlock } = {}) {
  pauseMining(runner, 'join:manual-mining');
  try {
    const joinRound = waitForJoinRoundExactly(runner, addresses, setup.voteRound, 'round:wait-join-after-vote');
    state.joinRound = bigintText(joinRound);

    const manualMining = true;
    const pendingCoreJoins = [];
    ensureExtensionInitialized(runner, setup.groupActionExtension, roles.governors[1], 'chain-group:extension-init', 'ExtensionGroupAction', { manualMining, pendingTransactions: pendingCoreJoins });
    ensureExtensionInitialized(runner, setup.groupServiceExtension, roles.governors[2], 'group-service:extension-init', 'ExtensionGroupService', { manualMining, pendingTransactions: pendingCoreJoins });
    ensureBaseActionJoins(runner, addresses, anvilAccounts, setup.baseActionId, { manualMining, pendingTransactions: pendingCoreJoins });
    minePendingTransactions(runner, pendingCoreJoins, 'join:manual-mining:core-joins');

    const pendingActivation = [];
    const serviceGroupId = ensureChainGroupAction(runner, state, addresses, roles, setup.groupActionExtension, {
      manualMining,
      pendingTransactions: pendingActivation,
      activationOnly: true,
    });
    minePendingTransactions(runner, pendingActivation, 'join:manual-mining:chain-group-activation');

    const pendingExtensionJoins = [];
    ensureChainGroupAction(runner, state, addresses, roles, setup.groupActionExtension, { manualMining, pendingTransactions: pendingExtensionJoins });
    ensureGroupServiceJoin(runner, state, addresses, roles, setup.groupServiceExtension, { manualMining, pendingTransactions: pendingExtensionJoins });
    minePendingTransactions(runner, pendingExtensionJoins, 'join:manual-mining:extension-joins');

    return { joinRound, serviceGroupId };
  } finally {
    resumeMining(runner, secondsPerBlock, 'join:manual-mining');
  }
}

function managerGroupId(runner, managerAddress, signature, args, stage) {
  return parseFirstUint(runner.call(managerAddress, signature, args, { stage, contract: managerAddress, fn: signature }));
}

function ensureManagerGroup(runner, state, key, managerAddress, readSignature, readArgs, activateSignature, activateArgs, payer) {
  state.managerGroupIds ||= {};
  let groupId = managerGroupId(runner, managerAddress, readSignature, readArgs, `manager:${key}:read`);
  if (groupId !== 0n) {
    state.managerGroupIds[key] = bigintText(groupId);
    return groupId;
  }

  ensureAllowance(runner, state.addresses.firstTokenAddress, managerAddress, seedConfig.managedGroupMintReserve, payer, `manager:${key}:allowance`);
  runner.send(
    managerAddress,
    activateSignature,
    activateArgs,
    payer,
    { stage: `manager:${key}:activate`, contract: managerAddress, fn: activateSignature },
  );
  groupId = managerGroupId(runner, managerAddress, readSignature, readArgs, `manager:${key}:read-after`);
  if (groupId === 0n) throw new Error(`Manager ${key} did not activate a group`);
  state.managerGroupIds[key] = bigintText(groupId);
  return groupId;
}

function ensureTypedManagerChats(runner, state, addresses, roles, baseActionId) {
  state.addresses = addresses;
  const payer = roles.governors[0];
  ensureManagerGroup(
    runner,
    state,
    'tokenMain',
    addresses.tokenMainManagerAddress,
    'groupIdOfToken(address)(uint256)',
    [addresses.firstTokenAddress],
    'activate(address)',
    [addresses.firstTokenAddress],
    payer,
  );
  ensureManagerGroup(
    runner,
    state,
    'tokenGov',
    addresses.tokenGovManagerAddress,
    'groupIdOfToken(address)(uint256)',
    [addresses.firstTokenAddress],
    'activate(address)',
    [addresses.firstTokenAddress],
    payer,
  );
  ensureManagerGroup(
    runner,
    state,
    'tokenActionMain',
    addresses.tokenActionMainManagerAddress,
    'groupIdOfAction(address,uint256)(uint256)',
    [addresses.firstTokenAddress, bigintText(baseActionId)],
    'activate(address,uint256)',
    [addresses.firstTokenAddress, bigintText(baseActionId)],
    payer,
  );
  ensureManagerGroup(
    runner,
    state,
    'tokenActionGov',
    addresses.tokenActionGovManagerAddress,
    'groupIdOfAction(address,uint256)(uint256)',
    [addresses.firstTokenAddress, bigintText(baseActionId)],
    'activate(address,uint256)',
    [addresses.firstTokenAddress, bigintText(baseActionId)],
    payer,
  );
}

function ensureServiceProviderChat(runner, state, addresses, roles, serviceGroupId) {
  const owner = roles.serviceProvider;
  const participant = roles.groupActionParticipant;
  const negative = roles.negativeSample;
  const participantGroupId = BigInt(state.groupIds[participant.label]);
  const negativeGroupId = BigInt(state.groupIds[negative.label]);

  const info = runner.call(
    addresses.groupChatAddress,
    'chatInfo(uint256)((uint256,address,bool,bool,address,address,address,address,address,uint256,uint256))',
    [bigintText(serviceGroupId)],
    {
      stage: 'service-chat:info',
      contract: 'GroupChat',
      fn: 'chatInfo',
      allowFailure: true,
    },
  );
  const activated = typeof info === 'string' && /\btrue\b/i.test(info);
  if (!activated) {
    runner.send(
      addresses.groupChatAddress,
      'activateChat(uint256,address,address,address,address)',
      [bigintText(serviceGroupId), addresses.groupJoinScopeSourceAddress, addresses.adminBanSourceAddress, zeroAddress, zeroAddress],
      owner,
      { stage: 'service-chat:activate', contract: 'GroupChat', fn: 'activateChat' },
    );
  }

  const adminId = parseFirstUint(runner.call(
    addresses.groupAdminAddress,
    'adminIdOf(uint256,address)(uint256)',
    [bigintText(serviceGroupId), participant.address],
    { stage: 'service-chat:admin-id', contract: 'GroupAdmin', fn: 'adminIdOf' },
  ));
  if (adminId === 0n) {
    runner.send(
      addresses.groupAdminAddress,
      'addAdmins(uint256,uint256[])',
      [bigintText(serviceGroupId), uintArray([participantGroupId])],
      owner,
      { stage: 'service-chat:add-admin', contract: 'GroupAdmin', fn: 'addAdmins' },
      { allowFailure: true },
    );
  }

  const isMember = parseBool(runner.call(
    addresses.groupMemberAddress,
    'isMemberId(uint256,uint256)(bool)',
    [bigintText(serviceGroupId), bigintText(participantGroupId)],
    { stage: 'service-chat:is-member', contract: 'GroupMember', fn: 'isMemberId' },
  ));
  const negativeIsMember = parseBool(runner.call(
    addresses.groupMemberAddress,
    'isMemberId(uint256,uint256)(bool)',
    [bigintText(serviceGroupId), bigintText(negativeGroupId)],
    { stage: 'service-chat:negative-is-member', contract: 'GroupMember', fn: 'isMemberId' },
  ));
  if (!isMember || !negativeIsMember) {
    const memberIds = [];
    if (!isMember) memberIds.push(participantGroupId);
    if (!negativeIsMember) memberIds.push(negativeGroupId);
    runner.send(
      addresses.groupMemberAddress,
      'addMemberIds(uint256,uint256[])',
      [bigintText(serviceGroupId), uintArray(memberIds)],
      owner,
      { stage: 'service-chat:add-member', contract: 'GroupMember', fn: 'addMemberIds' },
    );
  }

  const banned = parseBool(runner.call(
    addresses.groupBanListAddress,
    'isBanned(uint256,uint256,address)(bool)',
    [bigintText(serviceGroupId), bigintText(negativeGroupId), negative.address],
    { stage: 'service-chat:is-banned', contract: 'GroupBanList', fn: 'isBanned' },
  ));
  if (!banned) {
    runner.send(
      addresses.groupBanListAddress,
      'banBySenders(uint256,uint256[],address[])',
      [bigintText(serviceGroupId), uintArray([negativeGroupId]), addressArray([negative.address])],
      owner,
      { stage: 'service-chat:ban-negative', contract: 'GroupBanList', fn: 'banBySenders' },
    );
  }

  state.groupIds.serviceProviderChat = bigintText(serviceGroupId);
}

function postIfEmpty(runner, addresses, groupId, account, signature, args, stage) {
  runner.send(addresses.groupChatAddress, signature, args, account, {
    stage,
    contract: 'GroupChat',
    fn: signature,
  });
}

function postSampleMessage(runner, state, addresses, account, signature, args, key, stage) {
  if (state.samples[key]?.posted) return BigInt(state.samples[key].messageId || 0);
  const groupId = args[0];
  const beforeCount = parseFirstUint(runner.call(
    addresses.groupChatAddress,
    'messagesCount(uint256)(uint256)',
    [groupId],
    { stage: `${stage}:count-before`, contract: 'GroupChat', fn: 'messagesCount' },
  ));
  postIfEmpty(runner, addresses, groupId, account, signature, args, stage);
  const afterCount = parseFirstUint(runner.call(
    addresses.groupChatAddress,
    'messagesCount(uint256)(uint256)',
    [groupId],
    { stage: `${stage}:count-after`, contract: 'GroupChat', fn: 'messagesCount' },
  ));
  if (afterCount <= beforeCount) throw new Error(`${stage}: message count did not increase`);
  state.samples[key] = {
    posted: true,
    messageId: bigintText(afterCount),
    sender: account.label,
  };
  return afterCount;
}

function assertRejectedPostSample(result, expectedSelector, stage) {
  if (result.ok) throw new Error(`${stage}: post unexpectedly succeeded`);
  if (!lower(result.stderr).includes(lower(expectedSelector))) {
    throw new Error(`${stage}: expected revert ${expectedSelector}, got ${result.stderr || result.stdout}`);
  }
}

function ensureSampleMessages(runner, state, addresses, roles) {
  state.samples ||= {};
  const serviceGroupId = BigInt(state.groupIds.serviceProviderChat);
  const owner = roles.serviceProvider;
  const participant = roles.groupActionParticipant;
  const negative = roles.negativeSample;
  const scopeRejected = roles.governors[5];
  const ownerGroupId = BigInt(state.groupIds[owner.label]);
  const participantGroupId = BigInt(state.groupIds[participant.label]);
  const negativeGroupId = BigInt(state.groupIds[negative.label]);
  const scopeRejectedGroupId = BigInt(state.groupIds[scopeRejected.label]);

  const normalMessageId = postSampleMessage(
    runner,
    state,
    addresses,
    participant,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(participantGroupId),
      `${seedConfig.sampleContentPrefix}: normal`,
      uintArray([]),
      'false',
      '0',
    ],
    'normal',
    'messages:normal',
  );
  postSampleMessage(
    runner,
    state,
    addresses,
    participant,
    'postAsDefaultSender(uint256,string,uint256[],bool,uint256)',
    [bigintText(serviceGroupId), `${seedConfig.sampleContentPrefix}: default sender`, uintArray([]), 'false', '0'],
    'defaultSender',
    'messages:default-sender',
  );
  postSampleMessage(
    runner,
    state,
    addresses,
    participant,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(participantGroupId),
      `${seedConfig.sampleContentPrefix}: mention owner`,
      uintArray([ownerGroupId]),
      'false',
      '0',
    ],
    'mention',
    'messages:mention',
  );
  postSampleMessage(
    runner,
    state,
    addresses,
    owner,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(ownerGroupId),
      `${seedConfig.sampleContentPrefix}: mention all`,
      uintArray([]),
      'true',
      '0',
    ],
    'mentionAll',
    'messages:mention-all',
  );
  postSampleMessage(
    runner,
    state,
    addresses,
    participant,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(participantGroupId),
      `${seedConfig.sampleContentPrefix}: quote normal`,
      uintArray([]),
      'false',
      bigintText(normalMessageId),
    ],
    'quote',
    'messages:quote',
  );

  const banFailure = runner.send(
    addresses.groupChatAddress,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(negativeGroupId),
      `${seedConfig.sampleContentPrefix}: banned should fail`,
      uintArray([]),
      'false',
      '0',
    ],
    negative,
    { stage: 'messages:ban-rejected-sample', contract: 'GroupChat', fn: 'post' },
    { allowFailure: true },
  );
  assertRejectedPostSample(banFailure, postSelectors.banRejected, 'messages:ban-rejected-sample');

  state.samples.banRejected = {
    attempted: true,
    rejected: !banFailure.ok,
    stderr: banFailure.stderr.slice(0, 400),
  };

  const scopeFailure = runner.send(
    addresses.groupChatAddress,
    'post(uint256,uint256,string,uint256[],bool,uint256)',
    [
      bigintText(serviceGroupId),
      bigintText(scopeRejectedGroupId),
      `${seedConfig.sampleContentPrefix}: scope should fail`,
      uintArray([]),
      'false',
      '0',
    ],
    scopeRejected,
    { stage: 'messages:scope-rejected-sample', contract: 'GroupChat', fn: 'post' },
    { allowFailure: true },
  );
  assertRejectedPostSample(scopeFailure, postSelectors.scopeRejected, 'messages:scope-rejected-sample');

  state.samples.scopeRejected = {
    attempted: true,
    rejected: !scopeFailure.ok,
    stderr: scopeFailure.stderr.slice(0, 400),
  };
}

function assertCanPost(runner, addresses, groupId, senderId, account, expected, expectedReason, stage) {
  const result = parseCanPost(runner.call(
    addresses.groupChatAddress,
    'canPost(uint256,uint256,address)(bool,bytes4)',
    [bigintText(groupId), bigintText(senderId), account.address],
    { stage, contract: 'GroupChat', fn: 'canPost' },
  ));
  if (result.allowed !== expected || lower(result.reasonCode) !== lower(expectedReason)) {
    throw new Error(`${stage}: expected (${expected}, ${expectedReason}), got (${result.allowed}, ${result.reasonCode})`);
  }
  return result;
}

function finalAssertions(runner, state, addresses, roles) {
  const serviceGroupId = BigInt(state.groupIds.serviceProviderChat);
  const participantGroupId = BigInt(state.groupIds[roles.groupActionParticipant.label]);
  const negativeGroupId = BigInt(state.groupIds[roles.negativeSample.label]);
  const scopeRejectedGroupId = BigInt(state.groupIds[roles.governors[5].label]);

  const groupIdsCount = parseFirstUint(runner.call(
    addresses.groupChatAddress,
    'groupIdsCount()(uint256)',
    [],
    { stage: 'assert:group-ids-count', contract: 'GroupChat', fn: 'groupIdsCount' },
  ));
  if (groupIdsCount < 5n) throw new Error(`groupIdsCount expected >= 5, got ${groupIdsCount}`);

  for (const key of ['tokenMain', 'tokenGov', 'tokenActionMain', 'tokenActionGov']) {
    if (BigInt(state.managerGroupIds[key] || 0) === 0n) throw new Error(`Missing manager group id: ${key}`);
  }

  const positive = assertCanPost(
    runner,
    addresses,
    serviceGroupId,
    participantGroupId,
    roles.groupActionParticipant,
    true,
    postSelectors.ok,
    'assert:can-post-positive',
  );
  const banNegative = assertCanPost(
    runner,
    addresses,
    serviceGroupId,
    negativeGroupId,
    roles.negativeSample,
    false,
    postSelectors.banRejected,
    'assert:can-post-ban',
  );
  const scopeNegative = assertCanPost(
    runner,
    addresses,
    serviceGroupId,
    scopeRejectedGroupId,
    roles.governors[5],
    false,
    postSelectors.scopeRejected,
    'assert:can-post-scope',
  );

  const groupJoinCount = parseFirstUint(runner.call(
    addresses.groupJoinAddress,
    'gTokenAddressesByGroupIdByAccountCount(uint256,address)(uint256)',
    [bigintText(serviceGroupId), roles.groupActionParticipant.address],
    { stage: 'assert:group-join-count', contract: 'GroupJoin', fn: 'gTokenAddressesByGroupIdByAccountCount' },
  ));
  if (groupJoinCount === 0n) throw new Error('GroupJoinScopeSource prerequisite missing: account8 has not joined through GroupJoin');

  state.assertions = {
    groupIdsCount: bigintText(groupIdsCount),
    positive,
    banNegative,
    scopeNegative,
    groupJoinCount: bigintText(groupJoinCount),
  };
}

export async function seedGroupChat(graph, _deployer, options = {}) {
  const root = options.root || repoRoot;
  const rpcUrl = graph.network.rpcUrl;
  const addresses = collectGroupChatSeedAddresses(graph, root);
  const statePath = groupChatSeedStatePath(root);
  const runner = new CastRunner({ rpcUrl, root, verbose: options.verbose !== false });
  const anvil = readAnvilMetadata(runner);
  const roles = groupChatSeedRoles(anvilAccounts);
  const state = buildGroupChatSeedState({ addresses, anvil });
  state.status = 'running';

  try {
    console.log('\n=== Seed group-chat: assets ===');
    ensureFirstTokenBalances(runner, addresses, anvilAccounts);

    console.log('\n=== Seed group-chat: governance stake ===');
    ensureGovernanceStake(runner, addresses, roles.governors);
    ensureActionSubmitterEligibility(runner, addresses, roles.governors.slice(0, 3));

    console.log('\n=== Seed group-chat: group NFTs ===');
    ensureGroupNfts(runner, addresses, anvilAccounts, state);
    prepareJoinRoundAllowances(runner, addresses, roles);

    console.log('\n=== Seed group-chat: actions and votes ===');
    const setup = ensureActionSetup(runner, state, addresses, roles, {
      secondsPerBlock: graph.network.secondsPerBlock,
      resumeMiningAfterSuccess: false,
    });

    console.log('\n=== Seed group-chat: extension initialization and joins ===');
    const joinSetup = ensureJoinSetup(runner, state, addresses, roles, setup, {
      secondsPerBlock: graph.network.secondsPerBlock,
    });
    const { serviceGroupId } = joinSetup;

    console.log('\n=== Seed group-chat: typed manager chats ===');
    ensureTypedManagerChats(runner, state, addresses, roles, setup.baseActionId);

    console.log('\n=== Seed group-chat: service-provider chat ===');
    ensureServiceProviderChat(runner, state, addresses, roles, serviceGroupId);

    console.log('\n=== Seed group-chat: sample messages ===');
    ensureSampleMessages(runner, state, addresses, roles);

    console.log('\n=== Seed group-chat: assertions ===');
    finalAssertions(runner, state, addresses, roles);

    state.generatedAt = new Date().toISOString();
    state.status = 'completed';
    writeSeedState(statePath, clearGroupChatSeedFailure(state));
    return statePath;
  } catch (error) {
    writeSeedState(statePath, {
      ...state,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: error.message,
    });
    throw stageError('seed-group-chat', `partial state written to ${statePath}`, error);
  }
}

export function loadGroupChatSeedState(root = repoRoot) {
  return readSeedState(groupChatSeedStatePath(root));
}

export function loadCoreAnvilParams(root = repoRoot) {
  return readParamsFile(join(root, '../core/script/network/anvil/LOVE20.params'));
}
