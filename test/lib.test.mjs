import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildEnvContent,
} from '../src/env.mjs';
import {
  anvilKeystoreHome,
  formatParams,
  parseParams,
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
# comment
WETH_NAME="Wrapped # Anvil Ether"
MAX_SUPPLY=10000000000000000000000000000 # comment
EMPTY=
bad line
`);

    assert.equal(params.WETH_NAME, 'Wrapped # Anvil Ether');
    assert.equal(params.MAX_SUPPLY, '10000000000000000000000000000');
    assert.equal(params.EMPTY, '');
  });

  it('strips inline comments only outside quotes', () => {
    assert.equal(stripInlineComment('abc # def'), 'abc');
    assert.equal(stripInlineComment('"abc # def" # ghi'), '"abc # def"');
  });

  it('updates params content without disturbing unrelated comments', () => {
    const next = setParamInContent('# header\nA=1 # old\nB=2\n', 'A', '3');
    assert.equal(next, '# header\nA=3\nB=2\n');
    assert.equal(setParamInContent(next, 'C', '4'), '# header\nA=3\nB=2\n\nC=4\n');
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
});

describe('CLI options', () => {
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
});

describe('env generation', () => {
  it('maps known address keys to frontend env names', () => {
    const root = makeEnvFixture();
    const graph = {
      network: {
        chainId: '31337',
        rpcUrl: 'http://127.0.0.1:8545',
        secondsPerBlock: '1',
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
      assert.match(env, /NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT=/);
      assert.match(env, /NEXT_PUBLIC_CONTRACT_ADDRESS_BATCH_TRANSFER=/);
      assert.match(env, /NEXT_PUBLIC_FOUNDRY_GROUP_CHAT_ABI_PATH=\.\.\/love20-anvil\/\.foundry\/group-chat\/out\//);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
