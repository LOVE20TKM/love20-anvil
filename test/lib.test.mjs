import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildEnvContent,
} from '../src/env.mjs';
import {
  parseArgs,
} from '../src/cli.mjs';
import {
  anvilAccounts,
  buildGroupChatSeedState,
  CastRunner,
  clearGroupChatSeedFailure,
  collectGroupChatSeedAddresses,
  groupChatSeedPlan,
  groupChatSeedRoles,
  groupChatSeedStatePath,
  parseTransactionReceipt,
  pauseMining,
  readAnvilMetadata,
  resumeMining,
  minePendingTransactions,
  sendMinedTransaction,
  sendPendingTransaction,
  transactionHashFromOutput,
  waitForTransactionReceipt,
} from '../src/group-chat-seed.mjs';
import {
  anvilKeystoreHome,
  clearDeployState,
  clearAnvilFoundryArtifacts,
  clearNodeOutputFiles,
  deployAffectsGroupChatSeed,
  ensureAnvilFiles,
  formatParams,
  invalidatedNodesForDeploy,
  parseParams,
  resetAnvilDeployOutputs,
  resetNodesForDeploy,
  selectNodes,
  setParamInContent,
  stripInlineComment,
  validateNodeOutputs,
  ensureAnvilKeystore,
  ensureSharedToolCaches,
  syncMirroredFoundryArtifacts,
  writeParamsFile,
} from '../src/lib.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));

function addr(id) {
  return `0x${id.toString(16).padStart(40, '0')}`;
}

function writeAnvilParams(root, repo, file, params) {
  writeParamsFile(join(root, repo, 'script/network/anvil', file), params, { merge: false });
}

function makeEnvFixture() {
  const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));

  writeAnvilParams(root, 'core', 'LOVE20.params', {
    FIRST_TOKEN_SYMBOL: 'TestLOVE20',
    MAX_SUPPLY: '10000000000000000000000000000',
    FIRST_PARENT_TOKEN_FUNDRAISING_GOAL: '100000000000000000',
    PARENT_TOKEN_FUNDRAISING_GOAL: '20000000000000000000000000',
    LAUNCH_AMOUNT: '1000000000000000000000000000',
    WITHDRAW_WAITING_BLOCKS: '20',
    MIN_GOV_REWARD_MINTS_TO_LAUNCH: '2',
    PHASE_BLOCKS: '10',
    PROMISED_WAITING_PHASES_MIN: '1',
    PROMISED_WAITING_PHASES_MAX: '4',
    SUBMIT_MIN_PER_THOUSAND: '3',
    MAX_VERIFICATION_KEY_LENGTH: '32',
    JOIN_END_PHASE_BLOCKS: '1',
    ACTION_REWARD_MIN_VOTE_PER_THOUSAND: '30',
    ROUND_REWARD_GOV_PER_THOUSAND: '1',
    ROUND_REWARD_ACTION_PER_THOUSAND: '1',
  });
  writeAnvilParams(root, 'core', 'WETH.params', {
    WETH_NAME: 'Wrapped anvil Ether',
    WETH_SYMBOL: 'ETH20',
  });
  writeAnvilParams(root, 'core', 'address.params', {
    rootParentTokenAddress: addr(1),
    uniswapV2FactoryAddress: addr(2),
    tokenFactoryAddress: addr(3),
    launchAddress: addr(4),
    stakeAddress: addr(5),
    submitAddress: addr(6),
    voteAddress: addr(7),
    joinAddress: addr(8),
    randomAddress: addr(9),
    verifyAddress: addr(10),
    mintAddress: addr(11),
    firstTokenAddress: addr(12),
  });
  writeAnvilParams(root, 'periphery', 'address.params', {
    tokenViewerAddress: addr(101),
    roundViewerAddress: addr(102),
    mintViewerAddress: addr(103),
    love20HubAddress: addr(104),
    uniswapV2Router02Address: addr(105),
    uniswapV2ZapAddress: addr(106),
  });
  writeAnvilParams(root, 'group', 'address.group.params', { groupAddress: addr(201) });
  writeAnvilParams(root, 'group', 'address.group.defaults.params', { groupDefaultsAddress: addr(202) });
  writeAnvilParams(root, 'group', 'address.group.delegate.params', { groupDelegateAddress: addr(203) });
  writeAnvilParams(root, 'extension', 'address.extension.center.params', { centerAddress: addr(301) });
  writeAnvilParams(root, 'extension-lp', 'address.extension.lp.params', { lpFactoryAddress: addr(401) });
  writeAnvilParams(root, 'extension-lp', 'address.extension.lp.v2.params', { lpFactoryV2Address: addr(402) });
  writeAnvilParams(root, 'extension-group', 'address.extension.group.params', {
    groupManagerAddress: addr(501),
    groupJoinAddress: addr(502),
    groupVerifyAddress: addr(503),
    groupActionFactoryAddress: addr(504),
    groupRecipientsAddress: addr(505),
    groupServiceFactoryAddress: addr(506),
  });
  writeAnvilParams(root, 'group-chat', 'address.group.chat.params', {
    groupChatAddress: addr(601),
    groupAdminAddress: addr(602),
    groupBanListAddress: addr(603),
    adminBanSourceAddress: addr(604),
    govVotedBanSourceAddress: addr(605),
    groupMemberAddress: addr(606),
    groupMemberScopeAddress: addr(607),
    groupJoinScopeSourceAddress: addr(608),
    tokenMainManagerAddress: addr(609),
    tokenGovManagerAddress: addr(610),
    tokenActionGovManagerAddress: addr(611),
    tokenActionMainManagerAddress: addr(612),
  });
  writeAnvilParams(root, 'batch-transfer', 'address.batch-transfer.params', {
    batchTransferAddress: addr(701),
  });

  return root;
}

describe('params parser', () => {
  it('parses shell-like params with comments and quoted values', () => {
    const params = parseParams(`
# 注释
WETH_NAME="Wrapped # Anvil Ether"
MAX_SUPPLY=10000000000000000000000000000 # 注释
EMPTY=
bad line
`);

    assert.equal(params.WETH_NAME, 'Wrapped # Anvil Ether');
    assert.equal(params.MAX_SUPPLY, '10000000000000000000000000000');
    assert.equal(params.EMPTY, '');
  });

  it('strips inline comments only outside quotes', () => {
    assert.equal(stripInlineComment('abc # 注释'), 'abc');
    assert.equal(stripInlineComment('"abc # def" # 注释'), '"abc # def"');
  });

  it('updates params content without disturbing unrelated comments', () => {
    const next = setParamInContent('# 标题\nA=1 # 旧值\nB=2\n', 'A', '3');
    assert.equal(next, '# 标题\nA=3\nB=2\n');
    assert.equal(setParamInContent(next, 'C', '4'), '# 标题\nA=3\nB=2\n\nC=4\n');
  });

  it('formats params deterministically', () => {
    assert.equal(formatParams({ A: '1', B: '2' }), 'A=1\nB=2\n');
  });
});

describe('DAG selection', () => {
  const graph = {
    nodes: [
      { id: 'core' },
      { id: 'periphery' },
      { id: 'group-chat' },
      { id: 'batch-transfer' },
    ],
  };

  it('selects from a node', () => {
    assert.deepEqual(
      selectNodes(graph, { from: 'group-chat' }).map((node) => node.id),
      ['group-chat', 'batch-transfer'],
    );
  });

  it('selects through a node', () => {
    assert.deepEqual(
      selectNodes(graph, { to: 'group-chat' }).map((node) => node.id),
      ['core', 'periphery', 'group-chat'],
    );
  });

  it('selects only a node', () => {
    assert.deepEqual(
      selectNodes(graph, { only: 'group-chat' }).map((node) => node.id),
      ['group-chat'],
    );
  });

  it('skips nodes', () => {
    assert.deepEqual(
      selectNodes(graph, { skip: ['batch-transfer'] }).map((node) => node.id),
      ['core', 'periphery', 'group-chat'],
    );
  });

  it('rejects unknown skipped nodes', () => {
    assert.throws(
      () => selectNodes(graph, { skip: ['missing-node'] }),
      /Unknown deploy node: missing-node/,
    );
  });

  it('rejects mixed scope options', () => {
    assert.throws(
      () => selectNodes(graph, { from: 'periphery', to: 'group-chat' }),
      /Use only one of --only, --from, or --to/,
    );
  });
});

describe('output validation', () => {
  it('rejects zero addresses for required outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const graph = {
      nodes: [
        {
          id: 'core',
          repo: 'core',
          outputFiles: [{ path: 'address.params', requiredKeys: ['tokenFactoryAddress'] }],
        },
      ],
    };
    const node = graph.nodes[0];

    try {
      writeAnvilParams(root, 'core', 'address.params', {
        tokenFactoryAddress: '0x0000000000000000000000000000000000000000',
      });

      assert.throws(
        () => validateNodeOutputs(graph, node, root),
        /tokenFactoryAddress is not a non-zero address/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('anvil keystore', () => {
  it('links compiler caches into the isolated HOME', () => {
    const sourceHome = mkdtempSync(join(tmpdir(), 'love20-home-source-'));
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const previousHome = process.env.HOME;

    try {
      mkdirSync(join(sourceHome, '.solc-select'), { recursive: true });
      mkdirSync(join(sourceHome, 'Library', 'Application Support', 'svm'), { recursive: true });
      process.env.HOME = sourceHome;

      const linked = ensureSharedToolCaches(anvilKeystoreHome(root));

      assert.equal(lstatSync(join(anvilKeystoreHome(root), '.solc-select')).isSymbolicLink(), true);
      assert.equal(lstatSync(join(anvilKeystoreHome(root), 'Library', 'Application Support', 'svm')).isSymbolicLink(), true);
      assert.equal(lstatSync(join(anvilKeystoreHome(root), '.svm')).isSymbolicLink(), true);
      assert.equal(linked.length, 3);
    } finally {
      process.env.HOME = previousHome;
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates an isolated Foundry keystore for the core deploy path', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const deployer = {
      accountAddress: addr(1),
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      keystoreAccount: 'anvil_account',
      keystorePassword: 'anvil',
    };

    try {
      const keystorePath = ensureAnvilKeystore(deployer, root);
      assert.equal(keystorePath, join(anvilKeystoreHome(root), '.foundry', 'keystores', 'anvil_account'));
      assert.equal(existsSync(keystorePath), true);

      assert.equal(ensureAnvilKeystore(deployer, root), keystorePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('foundry artifacts', () => {
  it('preserves core network params while generating other node network params', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const deployer = {
      accountAddress: addr(1),
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      keystoreAccount: 'anvil_account',
    };
    const graph = {
      network: {
        chainId: '31337',
        rpcUrl: 'http://127.0.0.1:8545',
        secondsPerBlock: '3',
      },
      nodes: [
        {
          id: 'core',
          repo: 'core',
          preserveNetworkParams: true,
          outputFiles: [{ path: 'address.params' }],
        },
        {
          id: 'periphery',
          repo: 'periphery',
          outputFiles: [{ path: 'address.params' }],
        },
      ],
    };

    try {
      mkdirSync(join(root, 'core/script/network/anvil'), { recursive: true });
      mkdirSync(join(root, 'periphery/script/network/anvil'), { recursive: true });
      writeFileSync(join(root, 'core/script/network/anvil/network.params'), '# Network\nSECONDS_PER_BLOCK=1\nRPC_URL=http://127.0.0.1:8545');

      ensureAnvilFiles(graph, deployer, root);

      assert.equal(
        readFileSync(join(root, 'core/script/network/anvil/network.params'), 'utf8'),
        '# Network\nSECONDS_PER_BLOCK=1\nRPC_URL=http://127.0.0.1:8545',
      );
      assert.equal(parseParams(readFileSync(join(root, 'periphery/script/network/anvil/network.params'), 'utf8')).CHAIN_ID, '31337');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears selected node output files before deploy without removing config params', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const node = {
      id: 'core',
      repo: 'core',
      outputFiles: [{ path: 'address.params', requiredKeys: ['tokenFactoryAddress'] }],
    };

    try {
      writeAnvilParams(root, 'core', 'address.params', { tokenFactoryAddress: addr(1) });
      writeAnvilParams(root, 'core', 'LOVE20.params', { PHASE_BLOCKS: '10' });

      const cleared = clearNodeOutputFiles(node, root);

      assert.deepEqual(cleared, [join(root, 'core/script/network/anvil/address.params')]);
      assert.equal(parseParams(readFileSync(join(root, 'core/script/network/anvil/address.params'), 'utf8')).tokenFactoryAddress, undefined);
      assert.equal(parseParams(readFileSync(join(root, 'core/script/network/anvil/LOVE20.params'), 'utf8')).PHASE_BLOCKS, '10');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears only the selected node isolated artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const node = { id: 'extension-group' };

    try {
      mkdirSync(join(root, '.foundry', 'extension-group', 'out'), { recursive: true });
      mkdirSync(join(root, '.foundry', 'extension-group', 'cache'), { recursive: true });
      mkdirSync(join(root, '.foundry', 'extension', 'out'), { recursive: true });
      writeFileSync(join(root, '.foundry', 'extension-group', 'out', 'old.json'), '{}');
      writeFileSync(join(root, '.foundry', 'extension-group', 'cache', 'old.json'), '{}');
      writeFileSync(join(root, '.foundry', 'extension', 'out', 'keep.json'), '{}');

      const cleared = clearAnvilFoundryArtifacts(node, root);

      assert.deepEqual(cleared, [
        join(root, '.foundry', 'extension-group', 'out'),
        join(root, '.foundry', 'extension-group', 'cache'),
      ]);
      assert.equal(existsSync(join(root, '.foundry', 'extension-group', 'out')), false);
      assert.equal(existsSync(join(root, '.foundry', 'extension-group', 'cache')), false);
      assert.equal(existsSync(join(root, '.foundry', 'extension', 'out', 'keep.json')), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mirrors core artifacts into the anvil ABI directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const node = {
      id: 'core',
      repo: 'core',
      mirrorFoundryArtifacts: true,
    };

    try {
      mkdirSync(join(root, 'core', 'out', 'Contract.sol'), { recursive: true });
      writeFileSync(join(root, 'core', 'out', 'Contract.sol', 'Contract.json'), '{"abi":[]}');
      mkdirSync(join(root, '.foundry', 'core', 'out', 'Old.sol'), { recursive: true });
      writeFileSync(join(root, '.foundry', 'core', 'out', 'Old.sol', 'Old.json'), '{}');

      const copied = syncMirroredFoundryArtifacts(node, root);

      assert.deepEqual(copied, [join(root, '.foundry', 'core', 'out')]);
      assert.equal(existsSync(join(root, '.foundry', 'core', 'out', 'Contract.sol', 'Contract.json')), true);
      assert.equal(existsSync(join(root, '.foundry', 'core', 'out', 'Old.sol', 'Old.json')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears deploy-selected nodes and real dependents when dependencies are redeployed', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const graph = {
      nodes: [
        { id: 'core', repo: 'core', outputFiles: [{ path: 'address.params' }] },
        {
          id: 'group-chat',
          repo: 'group-chat',
          sync: [{ from: 'core', source: 'address.params', target: 'address.core.params' }],
          outputFiles: [{ path: 'address.group.chat.params' }],
        },
        { id: 'batch-transfer', repo: 'batch-transfer', outputFiles: [{ path: 'address.batch-transfer.params' }] },
      ],
    };

    try {
      writeAnvilParams(root, 'core', 'address.params', { coreAddress: addr(1) });
      writeAnvilParams(root, 'group-chat', 'address.group.chat.params', { groupChatAddress: addr(2) });
      writeAnvilParams(root, 'batch-transfer', 'address.batch-transfer.params', { batchTransferAddress: addr(3) });
      mkdirSync(join(root, '.foundry/core/out'), { recursive: true });
      mkdirSync(join(root, '.foundry/group-chat/out'), { recursive: true });
      mkdirSync(join(root, 'state'), { recursive: true });
      writeFileSync(join(root, 'state/addresses.json'), '{}');
      writeFileSync(join(root, 'state/group-chat-seed.json'), '{}');

      const resetNodes = resetNodesForDeploy(graph, { to: 'group-chat' }).map((node) => node.id);
      const invalidatedNodes = invalidatedNodesForDeploy(graph, { to: 'group-chat' }).map((node) => node.id);
      const cleared = resetAnvilDeployOutputs(graph, { to: 'group-chat' }, root);

      assert.deepEqual(resetNodes, ['core', 'group-chat']);
      assert.deepEqual(invalidatedNodes, ['core', 'group-chat']);
      assert.equal(readFileSync(join(root, 'core/script/network/anvil/address.params'), 'utf8'), '');
      assert.equal(readFileSync(join(root, 'group-chat/script/network/anvil/address.group.chat.params'), 'utf8'), '');
      assert.notEqual(readFileSync(join(root, 'batch-transfer/script/network/anvil/address.batch-transfer.params'), 'utf8'), '');
      assert.equal(existsSync(join(root, '.foundry/core/out')), false);
      assert.equal(existsSync(join(root, '.foundry/group-chat/out')), false);
      assert.equal(existsSync(join(root, 'state/addresses.json')), false);
      assert.equal(existsSync(join(root, 'state/group-chat-seed.json')), false);
      assert.equal(cleared.outputFiles.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not clear skipped downstream nodes', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const graph = {
      nodes: [
        { id: 'core', repo: 'core', outputFiles: [{ path: 'address.params' }] },
        {
          id: 'periphery',
          repo: 'periphery',
          sync: [{ from: 'core', source: 'address.params', target: 'address.core.params' }],
          outputFiles: [{ path: 'address.periphery.params' }],
        },
      ],
    };

    try {
      writeAnvilParams(root, 'core', 'address.params', { coreAddress: addr(1) });
      writeAnvilParams(root, 'periphery', 'address.periphery.params', { peripheryAddress: addr(2) });

      resetAnvilDeployOutputs(graph, { skip: ['periphery'] }, root);

      assert.deepEqual(invalidatedNodesForDeploy(graph, { skip: ['periphery'] }).map((node) => node.id), ['core']);
      assert.equal(readFileSync(join(root, 'core/script/network/anvil/address.params'), 'utf8'), '');
      assert.notEqual(readFileSync(join(root, 'periphery/script/network/anvil/address.periphery.params'), 'utf8'), '');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not clear group-chat seed state when deployment does not affect it', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));
    const graph = {
      nodes: [
        { id: 'core', repo: 'core', outputFiles: [{ path: 'address.params' }] },
        { id: 'batch-transfer', repo: 'batch-transfer', outputFiles: [{ path: 'address.batch-transfer.params' }] },
      ],
    };

    try {
      writeAnvilParams(root, 'batch-transfer', 'address.batch-transfer.params', { batchTransferAddress: addr(3) });
      mkdirSync(join(root, 'state'), { recursive: true });
      writeFileSync(join(root, 'state/group-chat-seed.json'), '{}');

      resetAnvilDeployOutputs(graph, { only: 'batch-transfer' }, root);

      assert.equal(existsSync(join(root, 'state/group-chat-seed.json')), true);
      assert.deepEqual(invalidatedNodesForDeploy(graph, { only: 'batch-transfer' }).map((node) => node.id), ['batch-transfer']);
      assert.equal(deployAffectsGroupChatSeed([{ id: 'batch-transfer' }]), false);
      assert.equal(deployAffectsGroupChatSeed([{ id: 'core' }]), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears only the deploy state file', () => {
    const root = mkdtempSync(join(tmpdir(), 'love20-anvil-test-'));

    try {
      mkdirSync(join(root, 'state'), { recursive: true });
      writeFileSync(join(root, 'state/addresses.json'), '{}');
      writeFileSync(join(root, 'state/group-chat-seed.json'), '{}');

      clearDeployState(root);

      assert.equal(existsSync(join(root, 'state/addresses.json')), false);
      assert.equal(existsSync(join(root, 'state/group-chat-seed.json')), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI options', () => {
  it('parses the group-chat seed command', () => {
    assert.deepEqual(parseArgs(['seed', 'group-chat']), {
      command: 'seed',
      target: 'group-chat',
      skip: [],
    });
  });

  it('rejects missing option values before deployment', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'deploy', '--from'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--from requires a value/);
  });

  it('rejects missing --to values before deployment', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'deploy', '--to'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--to requires a value/);
  });

  it('rejects unknown skipped nodes before deployment', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'deploy', '--skip', 'missing-node'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown deploy node: missing-node/);
  });

  it('rejects the removed --force deployment option', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'deploy', '--force'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown argument: --force/);
  });

  it('rejects a missing seed target before RPC preflight', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'seed'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /seed requires a target/);
    assert.doesNotMatch(result.stderr, /Anvil RPC is not reachable/);
  });

  it('rejects an unknown seed target before RPC preflight', () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs', 'seed', 'missing'], {
      cwd: join(testDir, '..'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown seed target: missing/);
    assert.doesNotMatch(result.stderr, /Anvil RPC is not reachable/);
  });
});

describe('group-chat seed fixtures', () => {
  function seedGraphFixture() {
    return {
      nodes: [
        { id: 'core', repo: 'core' },
        { id: 'group', repo: 'group' },
        { id: 'group-defaults', repo: 'group' },
        { id: 'extension', repo: 'extension' },
        { id: 'extension-group', repo: 'extension-group' },
        { id: 'group-chat', repo: 'group-chat' },
      ],
    };
  }

  it('defines the ten default Anvil roles deterministically', () => {
    const roles = groupChatSeedRoles();

    assert.equal(anvilAccounts.length, 10);
    assert.equal(roles.deployer.label, 'account0');
    assert.equal(roles.governors.map((account) => account.label).join(','), 'account1,account2,account3,account4,account5,account6');
    assert.equal(roles.serviceProvider.label, 'account7');
    assert.equal(roles.groupActionParticipant.label, 'account8');
    assert.equal(roles.negativeSample.label, 'account9');
  });

  it('builds a dry-run plan for the expected group-chat surfaces', () => {
    const plan = groupChatSeedPlan();

    assert.deepEqual(plan.map((step) => step.id), [
      'assets',
      'governance-stake',
      'actions',
      'chain-group',
      'typed-manager-chats',
      'service-provider-chat',
      'sample-messages',
    ]);
    assert.deepEqual(plan.find((step) => step.id === 'typed-manager-chats').managers, [
      'token-main',
      'token-gov',
      'token-action-main',
      'token-action-gov',
    ]);
  });

  it('resolves the seed state path under love20-anvil/state', () => {
    assert.equal(groupChatSeedStatePath('/tmp/love20-anvil'), join('/tmp/love20-anvil', 'state/group-chat-seed.json'));
  });

  it('collects seed addresses from Anvil params files', () => {
    const root = makeEnvFixture();

    try {
      const addresses = collectGroupChatSeedAddresses(seedGraphFixture(), root);

      assert.equal(addresses.firstTokenAddress, addr(12));
      assert.equal(addresses.groupAddress, addr(201));
      assert.equal(addresses.groupChatAddress, addr(601));
      assert.equal(addresses.groupActionFactoryAddress, addr(504));
      assert.equal(addresses.tokenActionMainManagerAddress, addr(612));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a serializable state shape without private keys', () => {
    const state = buildGroupChatSeedState({
      addresses: { firstTokenAddress: addr(12) },
      anvil: { instanceId: '0xabc', chainId: '31337' },
      actions: { base: { id: '1' } },
    });

    assert.equal(state.version, 1);
    assert.equal(state.status, 'pending');
    assert.equal(state.anvil.instanceId, '0xabc');
    assert.equal(state.accounts.length, 10);
    assert.equal(state.accounts[0].privateKey, undefined);
    assert.equal(state.actions.base.id, '1');
    assert.doesNotThrow(() => JSON.stringify(state));
  });

  it('clears stale failure metadata from successful seed state', () => {
    const state = clearGroupChatSeedFailure({
      actions: { base: { id: '1' } },
      assertions: { groupIdsCount: '5' },
      failedAt: '2026-01-01T00:00:00.000Z',
      error: 'old failure',
    });

    assert.equal(state.failedAt, undefined);
    assert.equal(state.error, undefined);
    assert.deepEqual(state.actions, { base: { id: '1' } });
    assert.deepEqual(state.assertions, { groupIdsCount: '5' });
  });

  it('requires Anvil metadata to include instanceId', () => {
    assert.deepEqual(
      readAnvilMetadata({
        rpc: () => JSON.stringify({
          chainId: 31337,
          instanceId: '0xabc',
          latestBlockNumber: 10,
          latestBlockHash: '0xhash',
          clientVersion: 'anvil/v1',
        }),
      }),
      {
        chainId: '31337',
        instanceId: '0xabc',
        latestBlockNumber: 10,
        latestBlockHash: '0xhash',
        clientVersion: 'anvil/v1',
      },
    );

    assert.throws(
      () => readAnvilMetadata({ rpc: () => JSON.stringify({ chainId: 31337 }) }),
      /instanceId/,
    );
  });

  it('parses async cast transaction hashes and receipts', () => {
    const hash = `0x${'ab'.repeat(32)}`;

    assert.equal(transactionHashFromOutput(`transactionHash ${hash}`), hash);
    assert.deepEqual(parseTransactionReceipt(JSON.stringify({
      status: '0x1',
      blockNumber: '0x2a',
    })), {
      raw: {
        status: '0x1',
        blockNumber: '0x2a',
      },
      status: '0x1',
      blockNumber: '0x2a',
    });
    assert.throws(() => transactionHashFromOutput('no tx hash'), /Missing transaction hash/);
  });

  it('pauses interval mining and restores the configured block interval', () => {
    const calls = [];
    const runner = {
      rpc(method, params, context) {
        calls.push({ method, params, stage: context.stage });
        return 'null';
      },
    };

    pauseMining(runner, 'seed-window');
    resumeMining(runner, '1', 'seed-window');

    assert.deepEqual(calls, [
      { method: 'anvil_setIntervalMining', params: ['0'], stage: 'seed-window:disable-interval-mining' },
      { method: 'evm_setAutomine', params: ['false'], stage: 'seed-window:disable-automine' },
      { method: 'evm_setAutomine', params: ['false'], stage: 'seed-window:keep-automine-disabled' },
      { method: 'anvil_setIntervalMining', params: ['1'], stage: 'seed-window:restore-interval-mining' },
    ]);
  });

  it('mines async transactions and waits for successful receipts', () => {
    const txHash = `0x${'12'.repeat(32)}`;
    const calls = [];
    const runner = {
      sendAsync(address, signature, args, account, context) {
        calls.push({ method: 'sendAsync', address, signature, args, account: account.label, stage: context.stage });
        return txHash;
      },
      rpc(method, params, context) {
        calls.push({ method, params, stage: context.stage });
        if (method === 'eth_getTransactionReceipt') {
          return JSON.stringify({ status: '0x1', blockNumber: '0x10' });
        }
        return 'null';
      },
    };

    const sent = sendMinedTransaction(
      runner,
      addr(1),
      'vote(address,uint256[],uint256[])',
      [addr(2), '[1]', '[1]'],
      { label: 'account1' },
      { stage: 'vote:actions' },
    );

    assert.equal(sent, txHash);
    assert.deepEqual(calls, [
      {
        method: 'sendAsync',
        address: addr(1),
        signature: 'vote(address,uint256[],uint256[])',
        args: [addr(2), '[1]', '[1]'],
        account: 'account1',
        stage: 'vote:actions',
      },
      { method: 'anvil_mine', params: ['0x1'], stage: 'vote:actions:mine' },
      { method: 'eth_getTransactionReceipt', params: [txHash], stage: 'vote:actions:receipt' },
    ]);
  });

  it('mines a pending transaction batch in one block', () => {
    const txHashes = [`0x${'12'.repeat(32)}`, `0x${'34'.repeat(32)}`];
    const calls = [];
    const runner = {
      sendAsync(address, signature, args, account, context) {
        const txHash = txHashes[calls.filter((call) => call.method === 'sendAsync').length];
        calls.push({ method: 'sendAsync', txHash, address, signature, args, account: account.label, stage: context.stage });
        return txHash;
      },
      rpc(method, params, context) {
        calls.push({ method, params, stage: context.stage });
        if (method === 'eth_getTransactionReceipt') {
          return JSON.stringify({ status: '0x1', blockNumber: '0x10' });
        }
        return 'null';
      },
    };

    const pending = [
      sendPendingTransaction(
        runner,
        addr(1),
        'vote(address,uint256[],uint256[])',
        [addr(2), '[1]', '[1]'],
        { label: 'account1' },
        { stage: 'vote:account1' },
      ),
      sendPendingTransaction(
        runner,
        addr(1),
        'vote(address,uint256[],uint256[])',
        [addr(2), '[1]', '[1]'],
        { label: 'account2' },
        { stage: 'vote:account2' },
      ),
    ];

    minePendingTransactions(runner, pending, 'vote:batch');

    assert.deepEqual(calls, [
      {
        method: 'sendAsync',
        txHash: txHashes[0],
        address: addr(1),
        signature: 'vote(address,uint256[],uint256[])',
        args: [addr(2), '[1]', '[1]'],
        account: 'account1',
        stage: 'vote:account1',
      },
      {
        method: 'sendAsync',
        txHash: txHashes[1],
        address: addr(1),
        signature: 'vote(address,uint256[],uint256[])',
        args: [addr(2), '[1]', '[1]'],
        account: 'account2',
        stage: 'vote:account2',
      },
      { method: 'anvil_mine', params: ['0x1'], stage: 'vote:batch:mine' },
      { method: 'eth_getTransactionReceipt', params: [txHashes[0]], stage: 'vote:account1:receipt' },
      { method: 'eth_getTransactionReceipt', params: [txHashes[1]], stage: 'vote:account2:receipt' },
    ]);
  });

  it('assigns explicit pending nonces for repeated async transactions from one sender', () => {
    const txHashes = [`0x${'12'.repeat(32)}`, `0x${'34'.repeat(32)}`];
    const calls = [];
    const runner = new CastRunner({ rpcUrl: 'http://127.0.0.1:8545', root: '/tmp', verbose: false });
    runner.run = (args, context) => {
      calls.push({ args, stage: context.stage });
      if (args[0] === 'nonce') {
        return { ok: true, stdout: '7', stderr: '', status: 0 };
      }
      if (args[0] === 'send') {
        return { ok: true, stdout: txHashes.shift(), stderr: '', status: 0 };
      }
      throw new Error(`unexpected cast command: ${args[0]}`);
    };
    const account = {
      label: 'account1',
      address: addr(1),
      privateKey: `0x${'11'.repeat(32)}`,
    };

    sendPendingTransaction(
      runner,
      addr(2),
      'vote(address,uint256[],uint256[])',
      [addr(3), '[1]', '[1]'],
      account,
      { stage: 'vote:first' },
    );
    sendPendingTransaction(
      runner,
      addr(2),
      'vote(address,uint256[],uint256[])',
      [addr(3), '[2]', '[2]'],
      account,
      { stage: 'vote:second' },
    );

    assert.deepEqual(calls.map((call) => call.args[0]), ['nonce', 'send', 'send']);
    assert.deepEqual(calls[0].args, ['nonce', addr(1), '--block', 'pending', '--rpc-url', 'http://127.0.0.1:8545']);
    assert.deepEqual(calls[1].args.slice(-4), ['--legacy', '--nonce', '7', '--async']);
    assert.deepEqual(calls[2].args.slice(-4), ['--legacy', '--nonce', '8', '--async']);
  });

  it('rejects failed async transaction receipts', () => {
    const txHash = `0x${'34'.repeat(32)}`;
    const runner = {
      rpc(method) {
        if (method === 'eth_getTransactionReceipt') {
          return JSON.stringify({ status: '0x0', blockNumber: '0x10' });
        }
        return 'null';
      },
    };

    assert.throws(
      () => waitForTransactionReceipt(runner, txHash, 'tx:receipt'),
      /transaction failed/,
    );
  });
});

describe('env generation', () => {
  it('maps known address keys to frontend env names', () => {
    const root = makeEnvFixture();
    const graph = {
      network: {
        chainId: '31337',
        rpcUrl: 'http://127.0.0.1:8545',
        secondsPerBlock: '3',
      },
      nodes: [
        { id: 'core', repo: 'core' },
        { id: 'periphery', repo: 'periphery' },
        { id: 'group', repo: 'group' },
        { id: 'group-defaults', repo: 'group' },
        { id: 'group-delegate', repo: 'group' },
        { id: 'extension', repo: 'extension' },
        { id: 'extension-lp', repo: 'extension-lp' },
        { id: 'extension-group', repo: 'extension-group' },
        { id: 'group-chat', repo: 'group-chat' },
        { id: 'batch-transfer', repo: 'batch-transfer' },
      ],
    };

    try {
      const env = buildEnvContent(graph, root);
      assert.match(env, /NEXT_PUBLIC_CHAIN=anvil/);
      assert.match(env, /NEXT_PUBLIC_BLOCK_TIME_MS=3000/);
      assert.match(env, /NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT=/);
      assert.match(env, /NEXT_PUBLIC_CONTRACT_ADDRESS_BATCH_TRANSFER=/);
      assert.match(env, /NEXT_PUBLIC_CONTRACT_ADDRESS_UNISWAP_V2_ZAP=/);
      assert.match(env, /NEXT_PUBLIC_FOUNDRY_GROUP_CHAT_ABI_PATH=\.\.\/love20-anvil\/\.foundry\/group-chat\/out\//);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
