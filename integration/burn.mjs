import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  expectRevertedTransaction,
  minePendingTransactions,
  pauseMining,
  resumeMining,
  sendPendingTransaction,
} from '../src/anvil.mjs';
import {
  prepareGroupActionRound,
  seedConfig,
} from '../src/group-chat-seed.mjs';
import {
  deployNode,
  paramsPathForNode,
  readParamsFile,
  writeParamsFile,
} from '../src/lib.mjs';

const WAD = 1_000_000_000_000_000_000n;
const MAX_UINT = (1n << 256n) - 1n;
const CHILD_SYMBOL = 'BURN20';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BURN_EVENTS = {
  sl: 'SLTokenLocked(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  st: 'STTokenLocked(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  gov: 'GovRewardTokenBurned(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  action: 'ActionRewardTokenBurned(address,address,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  airdrop: 'AirdropClaimed(address,uint256,uint256,uint256)',
};

export const burnInterfaceFunctions = [
  'extensionCenter',
  'scopeTokenAddress',
  'airdropTokenAddress',
  'startRound',
  'roundCount',
  'endRound',
  'quotaMultiplier',
  'totalCommunityWeight',
  'remainingAirdropShare',
  'communities',
  'communityWeight',
  'scoreBase',
  'supportedExtensionFactories',
  'isSupportedExtensionFactory',
  'isRoundOpen',
  'scoreMultiplier',
  'lockSLToken',
  'lockSTToken',
  'burnGovRewardToken',
  'burnActionRewardTokens',
  'claimAirdrop',
  'govRewardBurnState',
  'actionRewardBurnStates',
  'accountRoundBurnStats',
  'accountBurnStats',
  'communityRoundBurnStats',
  'communityBurnStats',
  'accountTokenShare',
  'accountShare',
  'participantsCount',
  'participants',
  'isParticipant',
  'accountAirdropState',
];

function uint(output) {
  const match = String(output).match(/\d+/);
  if (!match) throw new Error(`Expected uint output, got: ${output}`);
  return BigInt(match[0]);
}

function tupleFields(value) {
  assert.ok(typeof value === 'string' && value.startsWith('(') && value.endsWith(')'), `Expected tuple, got: ${value}`);
  const fields = [];
  let depth = 0;
  let start = 1;
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      fields.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(value.slice(start, -1).trim());
  return fields;
}

function onlyTuple(values) {
  assert.ok(Array.isArray(values) && values.length === 1, `Expected one JSON tuple, got: ${JSON.stringify(values)}`);
  return tupleFields(values[0]);
}

function tupleUints(value) {
  return tupleFields(value).flatMap((field) => {
    if (field.startsWith('(')) return tupleUints(field);
    return /^\d+$/.test(field) ? [BigInt(field)] : [];
  });
}

function actionStateIds(values) {
  assert.ok(Array.isArray(values) && values.length === 1, `Expected action state JSON, got: ${JSON.stringify(values)}`);
  return [...values[0].matchAll(/(?:^|\[|,)\s*\((\d+),\s*0x[a-fA-F0-9]{40},/g)]
    .map((match) => BigInt(match[1]));
}

function airdropState(values) {
  const [enabled, shareFinalized, isClaimed, share, claimableAmount, claimedAmount] = onlyTuple(values);
  return {
    enabled: enabled === 'true',
    shareFinalized: shareFinalized === 'true',
    isClaimed: isClaimed === 'true',
    share: BigInt(share),
    claimableAmount: BigInt(claimableAmount),
    claimedAmount: BigInt(claimedAmount),
  };
}

function address(output) {
  const match = String(output).match(/0x[a-fA-F0-9]{40}/);
  if (!match) throw new Error(`Expected address output, got: ${output}`);
  return match[0];
}

function addresses(output) {
  return [...String(output).matchAll(/0x[a-fA-F0-9]{40}/g)].map((match) => match[0]);
}

function bool(output) {
  return /\btrue\b/i.test(String(output));
}

function lower(value) {
  return String(value).toLowerCase();
}

function array(values) {
  return `[${values.map(String).join(',')}]`;
}

function tuple(values) {
  return `(${values.map(String).join(',')})`;
}

function balanceOf(runner, token, owner, stage) {
  return uint(runner.call(token, 'balanceOf(address)(uint256)', [owner], { stage }));
}

function approve(runner, token, spender, amount, account, stage) {
  runner.send(token, 'approve(address,uint256)', [spender, amount], account, { stage });
}

function mine(runner, blocks, stage) {
  if (blocks > 0n) runner.rpc('anvil_mine', [`0x${blocks.toString(16)}`], { stage });
}

function advanceToRound(runner, phaseContract, targetRound, stage) {
  const origin = uint(runner.call(phaseContract, 'originBlocks()(uint256)', [], { stage: `${stage}:origin` }));
  const phaseBlocks = uint(runner.call(phaseContract, 'phaseBlocks()(uint256)', [], { stage: `${stage}:phase-blocks` }));
  const block = uint(runner.run(['block-number', '--rpc-url', runner.rpcUrl], { stage: `${stage}:block` }).stdout);
  const targetBlock = origin + targetRound * phaseBlocks;
  mine(runner, targetBlock > block ? targetBlock - block : 0n, `${stage}:mine`);
  const actual = uint(runner.call(phaseContract, 'currentRound()(uint256)', [], { stage: `${stage}:confirm` }));
  assert.equal(actual, targetRound, `${stage}: round advanced past ${targetRound}`);
}

function sendBatch(runner, transactions, stage) {
  const pending = transactions.map((transaction) => sendPendingTransaction(
    runner,
    transaction.address,
    transaction.signature,
    transaction.args || [],
    transaction.account,
    { stage: transaction.stage || stage },
  ));
  return minePendingTransactions(runner, pending, stage);
}

function eventTopics(runner) {
  return Object.fromEntries(Object.entries(BURN_EVENTS).map(([name, signature]) => [
    name,
    lower(runner.run(['sig-event', signature], { stage: `burn:event-topic:${name}` }).stdout),
  ]));
}

function assertBurnEvent(receipt, burnAddress, topic, expectedCount, stage) {
  const count = (receipt.raw.logs || []).filter((log) => (
    lower(log.address) === lower(burnAddress) && lower(log.topics?.[0]) === topic
  )).length;
  assert.equal(count, expectedCount, `${stage}: expected ${expectedCount} Burn event(s), got ${count}`);
}

function assertExtensionRegistration(runner, center, token, actionId, expectedExtension, expectedFactory, stage) {
  const extension = address(runner.call(center, 'extension(address,uint256)(address)', [token, actionId], { stage: `${stage}:extension` }));
  const factory = address(runner.call(center, 'factory(address,uint256)(address)', [token, actionId], { stage: `${stage}:factory` }));
  assert.equal(lower(extension), lower(expectedExtension), `${stage}: unexpected extension`);
  assert.equal(lower(factory), lower(expectedFactory), `${stage}: unexpected factory`);
}

function actionBody(whiteListAddress, title) {
  return tuple([
    seedConfig.actionMinStake,
    seedConfig.maxRandomAccounts,
    whiteListAddress,
    JSON.stringify(title),
    JSON.stringify('burn integration verification rule'),
    '["default"]',
    '["burn integration verification info"]',
  ]);
}

function actionIdAfterSubmit(runner, core, author, whiteListAddress, title) {
  const before = uint(runner.call(core.submit, 'actionsCount(address)(uint256)', [core.firstToken], { stage: `${title}:count-before` }));
  runner.send(
    core.submit,
    'submitNewAction(address,(uint256,uint256,address,string,string,string[],string[]))',
    [core.firstToken, actionBody(whiteListAddress, title)],
    author,
    { stage: `${title}:submit` },
  );
  const after = uint(runner.call(core.submit, 'actionsCount(address)(uint256)', [core.firstToken], { stage: `${title}:count-after` }));
  assert.equal(after, before + 1n, `${title}: action was not submitted`);
  return after - 1n;
}

function voteAction(runner, core, voter, actionId, expectedRound, stage) {
  const round = uint(runner.call(core.vote, 'currentRound()(uint256)', [], { stage: `${stage}:round` }));
  assert.equal(round, expectedRound, `${stage}: unexpected vote round`);
  const votes = uint(runner.call(core.vote, 'maxVotesNum(address,address)(uint256)', [core.firstToken, voter.address], { stage: `${stage}:max-votes` }));
  assert.ok(votes > 0n, `${stage}: voter has no governance votes`);
  runner.send(core.vote, 'vote(address,uint256[],uint256[])', [core.firstToken, array([actionId]), array([votes])], voter, { stage });
  assert.ok(bool(runner.call(core.vote, 'isActionIdVoted(address,uint256,uint256)(bool)', [core.firstToken, expectedRound, actionId], { stage: `${stage}:confirm` })));
}

function verifyActions(runner, core, round, descriptors, stage) {
  sendBatch(runner, descriptors.map((descriptor) => ({
    address: core.join,
    signature: 'prepareRandomAccountsIfNeeded(address,uint256)',
    args: [core.firstToken, descriptor.actionId],
    account: descriptor.verifier,
    stage: `${stage}:${descriptor.kind}:prepare-random`,
  })), `${stage}:prepare-random`);

  const prepared = descriptors.map((descriptor) => {
    const selected = addresses(runner.call(
      core.join,
      'randomAccounts(address,uint256,uint256)(address[])',
      [core.firstToken, round, descriptor.actionId],
      { stage: `${stage}:${descriptor.kind}:random-accounts` },
    ));
    assert.ok(selected.length > 0, `${stage}:${descriptor.kind}: no accounts selected for verification`);
    if (descriptor.extension) {
      assert.ok(selected.some((account) => lower(account) === lower(descriptor.extension)), `${stage}:${descriptor.kind}: extension was not selected`);
    }
    return { ...descriptor, selected };
  });

  sendBatch(runner, prepared.map((descriptor) => ({
    address: core.verify,
    signature: 'verify(address,uint256,uint256,uint256[])',
    args: [
      core.firstToken,
      descriptor.actionId,
      0,
      array(descriptor.selected.map((account) => (
        descriptor.extension && lower(account) !== lower(descriptor.extension) ? 0 : 100
      ))),
    ],
    account: descriptor.verifier,
    stage: `${stage}:${descriptor.kind}:verify`,
  })), `${stage}:verify`);

  return prepared;
}

function completeQualificationRound(graph, root, runner, core, account) {
  const fixture = prepareGroupActionRound({
    ...graph,
    network: { ...graph.network, secondsPerBlock: undefined },
  }, { root, runner });
  const round = fixture.setup.voteRound;

  advanceToRound(runner, core.verify, round, 'qualification:verify-round');
  pauseMining(runner, 'qualification:manual-mining');
  try {
    verifyActions(runner, core, round, [{
      actionId: fixture.setup.baseActionId,
      kind: 'base',
      verifier: account,
    }], 'qualification');
    advanceToRound(runner, core.verify, round + 1n, 'qualification:mint-round');
    sendBatch(runner, [{
      address: core.mint,
      signature: 'mintGovReward(address,uint256)',
      args: [core.firstToken, round],
      account,
      stage: 'qualification:mint-gov',
    }], 'qualification:mint');
  } finally {
    resumeMining(runner, undefined, 'qualification:resume-mining');
  }

  return round;
}

function launchChildCommunity(runner, core, bootstrap, launcher, contributor) {
  assert.ok(uint(runner.call(core.launch, 'remainingLaunchCount(address,address)(uint256)', [core.firstToken, launcher.address], { stage: 'child:remaining-launch-count' })) > 0n);
  const before = uint(runner.call(core.launch, 'childTokensByLauncherCount(address,address)(uint256)', [core.firstToken, launcher.address], { stage: 'child:count-before' }));
  runner.send(core.launch, 'launchToken(string,address)', [CHILD_SYMBOL, core.firstToken], launcher, { stage: 'child:launch' });
  const after = uint(runner.call(core.launch, 'childTokensByLauncherCount(address,address)(uint256)', [core.firstToken, launcher.address], { stage: 'child:count-after' }));
  assert.equal(after, before + 1n);
  const child = address(runner.call(core.launch, 'childTokensByLauncherAtIndex(address,address,uint256)(address)', [core.firstToken, launcher.address, after - 1n], { stage: 'child:address' }));
  const goal = uint(runner.call(core.launch, 'PARENT_TOKEN_FUNDRAISING_GOAL()(uint256)', [], { stage: 'child:goal' }));
  const firstContribution = goal / 2n;
  const secondContribution = goal - firstContribution;

  for (const [account, required] of [[launcher, firstContribution], [contributor, secondContribution]]) {
    const balance = balanceOf(runner, core.firstToken, account.address, `child:${account.label}:parent-balance`);
    if (balance < required) {
      runner.send(core.firstToken, 'transfer(address,uint256)', [account.address, required - balance], bootstrap, { stage: `child:fund-${account.label}` });
    }
  }

  approve(runner, core.firstToken, core.launch, firstContribution, launcher, 'child:approve-first');
  runner.send(core.launch, 'contribute(address,uint256,address)', [child, firstContribution, launcher.address], launcher, { stage: 'child:contribute-first' });
  const waitBlocks = uint(runner.call(core.launch, 'SECOND_HALF_MIN_BLOCKS()(uint256)', [], { stage: 'child:second-half-blocks' }));
  mine(runner, waitBlocks + 1n, 'child:wait-second-half');
  approve(runner, core.firstToken, core.launch, secondContribution, contributor, 'child:approve-second');
  runner.send(core.launch, 'contribute(address,uint256,address)', [child, secondContribution, contributor.address], contributor, { stage: 'child:contribute-second' });
  assert.ok(bool(runner.call(core.launch, 'launchInfo(address)((address,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256))', [child], { stage: 'child:launch-info' })));
  mine(runner, 1n, 'child:claim-delay');
  runner.send(core.launch, 'claim(address)', [child], launcher, { stage: 'child:claim-launcher' });
  runner.send(core.launch, 'claim(address)', [child], contributor, { stage: 'child:claim-contributor' });
  assert.ok(balanceOf(runner, child, launcher.address, 'child:launcher-balance') > 0n);
  assert.ok(balanceOf(runner, child, contributor.address, 'child:contributor-balance') > 0n);
  return child;
}

function createChildReceipts(runner, core, child, bootstrap, account) {
  const childForLp = 1_000_000_000_000_000_000n;
  const parentForLp = 20_000_000_000_000_000n;
  const childForStake = 1_000_000_000_000_000_000n;
  const parentBalance = balanceOf(runner, core.firstToken, account.address, 'child-stake:parent-balance');
  if (parentBalance < parentForLp) {
    runner.send(core.firstToken, 'transfer(address,uint256)', [account.address, parentForLp - parentBalance], bootstrap, { stage: 'child-stake:fund-parent' });
  }
  approve(runner, child, core.stake, childForLp + childForStake, account, 'child-stake:approve-child');
  approve(runner, core.firstToken, core.stake, parentForLp, account, 'child-stake:approve-parent');
  runner.send(
    core.stake,
    'stakeLiquidity(address,uint256,uint256,uint256,address)',
    [child, childForLp, parentForLp, 1, account.address],
    account,
    { stage: 'child-stake:liquidity' },
  );
  runner.send(core.stake, 'stakeToken(address,uint256,uint256,address)', [child, childForStake, 1, account.address], account, { stage: 'child-stake:token' });
  const sl = address(runner.call(child, 'slAddress()(address)', [], { stage: 'child-stake:sl-address' }));
  const st = address(runner.call(child, 'stAddress()(address)', [], { stage: 'child-stake:st-address' }));
  assert.ok(balanceOf(runner, sl, account.address, 'child-stake:sl-balance') > 0n);
  assert.ok(balanceOf(runner, st, account.address, 'child-stake:st-balance') > 0n);
  return { sl, st };
}

function createLpExtension(runner, core, factory, creator, label) {
  const sl = address(runner.call(core.firstToken, 'slAddress()(address)', [], { stage: `${label}:sl-address` }));
  const pair = address(runner.call(sl, 'uniswapV2Pair()(address)', [], { stage: `${label}:pair-address` }));
  const before = uint(runner.call(factory, 'extensionsCount()(uint256)', [], { stage: `${label}:extensions-before` }));
  approve(runner, core.firstToken, factory, WAD, creator, `${label}:approve-factory`);
  runner.send(factory, 'createExtension(address,address,uint256,uint256)', [core.firstToken, pair, 0, 0], creator, { stage: `${label}:create-extension` });
  const after = uint(runner.call(factory, 'extensionsCount()(uint256)', [], { stage: `${label}:extensions-after` }));
  assert.equal(after, before + 1n);
  const extension = address(runner.call(factory, 'extensionsAtIndex(uint256)(address)', [after - 1n], { stage: `${label}:extension-address` }));
  return { extension, pair };
}

function mintLpTokens(runner, core, pair, extension, account, bootstrap, label) {
  const reserves = runner.callJson(pair, 'getReserves()(uint112,uint112,uint32)', [], { stage: `${label}:reserves` }).map(BigInt);
  const totalSupply = uint(runner.call(pair, 'totalSupply()(uint256)', [], { stage: `${label}:total-supply` }));
  const token0 = address(runner.call(pair, 'token0()(address)', [], { stage: `${label}:token0` }));
  const tokenReserve = lower(token0) === lower(core.firstToken) ? reserves[0] : reserves[1];
  const parentReserve = lower(token0) === lower(core.firstToken) ? reserves[1] : reserves[0];
  const desiredLp = WAD;
  const tokenAmount = (desiredLp * tokenReserve) / totalSupply + 1n;
  const parentAmount = (desiredLp * parentReserve) / totalSupply + 1n;
  const tokenBalance = balanceOf(runner, core.firstToken, account.address, `${label}:token-balance`);
  if (tokenBalance < tokenAmount) {
    runner.send(core.firstToken, 'transfer(address,uint256)', [account.address, tokenAmount - tokenBalance], bootstrap, { stage: `${label}:fund-token` });
  }
  const parentBalance = balanceOf(runner, core.rootParent, account.address, `${label}:parent-balance`);
  if (parentBalance < parentAmount) {
    const missing = parentAmount - parentBalance;
    runner.txValue(core.rootParent, 'deposit()', missing, [], bootstrap, { stage: `${label}:deposit-parent` });
    runner.send(core.rootParent, 'transfer(address,uint256)', [account.address, missing], bootstrap, { stage: `${label}:fund-parent` });
  }
  const before = balanceOf(runner, pair, account.address, `${label}:balance-before`);
  runner.send(core.firstToken, 'transfer(address,uint256)', [pair, tokenAmount], account, { stage: `${label}:transfer-token` });
  runner.send(core.rootParent, 'transfer(address,uint256)', [pair, parentAmount], account, { stage: `${label}:transfer-parent` });
  runner.send(pair, 'mint(address)', [account.address], account, { stage: `${label}:mint-pair` });
  const amount = balanceOf(runner, pair, account.address, `${label}:balance-after`) - before;
  assert.ok(amount >= desiredLp, `${label}: LP mint returned ${amount}, expected at least ${desiredLp}`);
  approve(runner, pair, extension, amount, account, `${label}:approve-extension`);
  return amount;
}

function deployBurn(graph, node, root, deployer, config) {
  const configPath = paramsPathForNode(node, 'burn.params', root);
  const addressPath = paramsPathForNode(node, 'address.burn.params', root);
  const originalConfig = readFileSync(configPath, 'utf8');
  const originalAddress = readFileSync(addressPath, 'utf8');
  try {
    writeParamsFile(configPath, {
      EXTENSION_CENTER: config.extensionCenter,
      SCOPE_TOKEN: config.scopeToken,
      AIRDROP_TOKEN: config.airdropToken,
      COMMUNITY_TOKENS: config.communities.map((community) => community.token).join(','),
      COMMUNITY_WEIGHTS: config.communities.map((community) => community.weight).join(','),
      START_ROUND: String(config.startRound),
      ROUND_COUNT: String(config.roundCount),
      QUOTA_MULTIPLIER: String(config.quotaMultiplier),
      SUPPORTED_EXTENSION_FACTORIES: config.factories.join(','),
    });
    deployNode(graph, deployer, node, { root, prepareInputs: false });
    return readParamsFile(addressPath).burnAddress;
  } finally {
    writeFileSync(configPath, originalConfig);
    writeFileSync(addressPath, originalAddress);
  }
}

function burnClient(runner, contract) {
  const covered = new Set();
  const cover = (signature) => {
    const name = signature.slice(0, signature.indexOf('('));
    assert.ok(burnInterfaceFunctions.includes(name), `Unknown IBurn function in scenario: ${name}`);
    covered.add(name);
  };
  return {
    address: contract,
    covered,
    call(signature, args = [], stage, options = {}) {
      cover(signature);
      return runner.call(contract, signature, args, { stage, ...options });
    },
    callJson(signature, args = [], stage) {
      cover(signature);
      return runner.callJson(contract, signature, args, { stage });
    },
    transaction(signature, args, account, stage) {
      cover(signature);
      return { address: contract, signature, args, account, stage };
    },
  };
}

function assertBurnCoverage(client) {
  const missing = burnInterfaceFunctions.filter((name) => !client.covered.has(name));
  assert.deepEqual(missing, [], `IBurn functions not covered: ${missing.join(', ')}`);
}

function assertBurnInterface(root) {
  const source = readFileSync(resolve(root, '../burn/src/interface/IBurn.sol'), 'utf8');
  const publicInterface = source.slice(source.indexOf('interface IBurn is'));
  const declared = [...publicInterface.matchAll(/\bfunction\s+(\w+)\s*\(/g)].map((match) => match[1]);
  assert.deepEqual([...burnInterfaceFunctions].sort(), declared.sort(), 'Burn integration coverage list does not match IBurn');
}

function positivePortion(value) {
  assert.ok(value > 0n);
  return value > 100n ? value / 100n : 1n;
}

export async function run({ accounts, deployer, graph, node, params, root, runner }) {
  assertBurnInterface(root);
  const coreParams = params('core', 'address.params');
  const extensionParams = params('extension', 'address.extension.center.params');
  const lpParams = params('extension-lp', 'address.extension.lp.params');
  const lpV2Params = params('extension-lp', 'address.extension.lp.v2.params');
  const groupParams = params('extension-group', 'address.extension.group.params');
  const deployedBurn = params('burn', 'address.burn.params').burnAddress;
  const factories = [
    lpParams.lpFactoryAddress,
    lpV2Params.lpFactoryV2Address,
    groupParams.groupActionFactoryAddress,
    groupParams.groupServiceFactoryAddress,
  ];
  const core = {
    firstToken: coreParams.firstTokenAddress,
    join: coreParams.joinAddress,
    launch: coreParams.launchAddress,
    mint: coreParams.mintAddress,
    rootParent: coreParams.rootParentTokenAddress,
    stake: coreParams.stakeAddress,
    submit: coreParams.submitAddress,
    verify: coreParams.verifyAddress,
    vote: coreParams.voteAddress,
  };

  for (const [name, contract] of Object.entries({
    ...core,
    deployedBurn,
    extensionCenter: extensionParams.centerAddress,
    lpFactory: lpParams.lpFactoryAddress,
    lpFactoryV2: lpV2Params.lpFactoryV2Address,
    groupActionFactory: groupParams.groupActionFactoryAddress,
    groupServiceFactory: groupParams.groupServiceFactoryAddress,
  })) {
    const code = runner.run(['code', contract, '--rpc-url', runner.rpcUrl], { stage: `code:${name}` }).stdout;
    assert.notEqual(code, '0x', `${name} has no deployed code`);
  }
  assert.deepEqual(
    addresses(runner.call(deployedBurn, 'supportedExtensionFactories()(address[])', [], { stage: 'deployed-burn:factories' })).map(lower),
    factories.map(lower),
    'Deployment graph Burn does not include all supported extension factories',
  );

  console.log('\n=== Burn integration: child-community eligibility ===');
  completeQualificationRound(graph, root, runner, core, accounts[1]);
  completeQualificationRound(graph, root, runner, core, accounts[1]);
  assert.ok(uint(runner.call(core.mint, 'numOfMintGovRewardByAccount(address,address)(uint256)', [core.firstToken, accounts[1].address], { stage: 'qualification:mint-count' })) >= 2n);

  console.log('\n=== Burn integration: child community and receipts ===');
  const child = launchChildCommunity(runner, core, accounts[0], accounts[1], accounts[2]);
  const childReceipts = createChildReceipts(runner, core, child, accounts[0], accounts[2]);
  console.log('\n=== Burn integration: LP V1/V2 extension assets ===');
  const lpV1 = createLpExtension(runner, core, lpParams.lpFactoryAddress, accounts[1], 'lp-v1');
  const lpV2 = createLpExtension(runner, core, lpV2Params.lpFactoryV2Address, accounts[3], 'lp-v2');
  const lpV1Amount = mintLpTokens(runner, core, lpV1.pair, lpV1.extension, accounts[4], accounts[0], 'lp-v1');
  const lpV2Amount = mintLpTokens(runner, core, lpV2.pair, lpV2.extension, accounts[4], accounts[0], 'lp-v2');

  console.log('\n=== Burn integration: group actions and LP pipeline ===');
  const fixture = prepareGroupActionRound({
    ...graph,
    network: { ...graph.network, secondsPerBlock: undefined },
  }, { root, runner });
  const groupRound = fixture.setup.voteRound;
  const lpRound = groupRound + 1n;
  assert.equal(uint(runner.call(core.vote, 'currentRound()(uint256)', [], { stage: 'lp:vote-round-before-submit' })), lpRound);
  const lpV1ActionId = actionIdAfterSubmit(runner, core, accounts[1], lpV1.extension, 'lp-v1-action');
  const lpV2ActionId = actionIdAfterSubmit(runner, core, accounts[3], lpV2.extension, 'lp-v2-action');
  voteAction(runner, core, accounts[1], lpV1ActionId, lpRound, 'lp-v1-action:vote');
  voteAction(runner, core, accounts[2], lpV2ActionId, lpRound, 'lp-v2-action:vote');

  const burnAddress = deployBurn(graph, node, root, deployer, {
    airdropToken: core.rootParent,
    communities: [{ token: core.firstToken, weight: 1 }, { token: child, weight: 2 }],
    extensionCenter: extensionParams.centerAddress,
    factories,
    quotaMultiplier: 5,
    roundCount: 2,
    scopeToken: core.firstToken,
    startRound: groupRound,
  });
  console.log(`  burn: fixture deployed at ${burnAddress}`);
  const burn = burnClient(runner, burnAddress);
  const topics = eventTopics(runner);

  assert.equal(lower(address(burn.call('extensionCenter()(address)', [], 'burn:extension-center'))), lower(extensionParams.centerAddress));
  assert.equal(lower(address(burn.call('scopeTokenAddress()(address)', [], 'burn:scope-token'))), lower(core.firstToken));
  assert.equal(lower(address(burn.call('airdropTokenAddress()(address)', [], 'burn:airdrop-token'))), lower(core.rootParent));
  assert.equal(uint(burn.call('startRound()(uint256)', [], 'burn:start-round')), groupRound);
  assert.equal(uint(burn.call('roundCount()(uint256)', [], 'burn:round-count')), 2n);
  assert.equal(uint(burn.call('endRound()(uint256)', [], 'burn:end-round')), lpRound);
  assert.equal(uint(burn.call('quotaMultiplier()(uint256)', [], 'burn:quota-multiplier')), 5n);
  assert.equal(uint(burn.call('totalCommunityWeight()(uint256)', [], 'burn:total-community-weight')), 3n);
  assert.equal(uint(burn.call('remainingAirdropShare()(uint256)', [], 'burn:remaining-share')), WAD);
  assert.deepEqual(addresses(burn.call('communities()(address[])', [], 'burn:communities')).map(lower), [core.firstToken, child].map(lower));
  assert.equal(uint(burn.call('communityWeight(address)(uint256)', [core.firstToken], 'burn:first-weight')), 1n);
  assert.equal(uint(burn.call('communityWeight(address)(uint256)', [child], 'burn:child-weight')), 2n);
  assert.ok(uint(burn.call('scoreBase(address)(uint256)', [core.firstToken], 'burn:first-score-base')) >= WAD);
  assert.ok(uint(burn.call('scoreBase(address)(uint256)', [child], 'burn:child-score-base')) >= WAD);
  assert.deepEqual(addresses(burn.call('supportedExtensionFactories()(address[])', [], 'burn:factories')).map(lower), factories.map(lower));
  for (const factory of factories) assert.ok(bool(burn.call('isSupportedExtensionFactory(address)(bool)', [factory], `burn:factory:${factory}`)));
  assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [core.firstToken, groupRound], 'burn:score-multiplier')) > 0n, true);

  runner.txValue(core.rootParent, 'deposit()', WAD, [], accounts[0], { stage: 'airdrop:fund-deployer' });
  pauseMining(runner, 'burn:manual-mining');
  try {
    console.log('\n=== Burn integration: group round verify ===');
    advanceToRound(runner, core.verify, groupRound, 'group-round:verify');
    sendBatch(runner, [
      {
        address: lpV1.extension,
        signature: 'join(uint256,string[])',
        args: [lpV1Amount, '[]'],
        account: accounts[4],
        stage: 'lp-v1:join',
      },
      {
        address: lpV2.extension,
        signature: 'join(uint256,string[])',
        args: [lpV2Amount, '[]'],
        account: accounts[4],
        stage: 'lp-v2:join',
      },
      {
        address: groupParams.groupVerifyAddress,
        signature: 'submitOriginScores(address,uint256,uint256,uint256[])',
        args: [fixture.setup.groupActionExtension, fixture.joinSetup.serviceGroupId, 0, '[100]'],
        account: fixture.roles.serviceProvider,
        stage: 'group-action:submit-score',
      },
    ], 'group-round:joins');

    assertExtensionRegistration(runner, extensionParams.centerAddress, core.firstToken, fixture.setup.baseActionId, ZERO_ADDRESS, ZERO_ADDRESS, 'extension:base');
    assertExtensionRegistration(runner, extensionParams.centerAddress, core.firstToken, fixture.setup.groupActionId, fixture.setup.groupActionExtension, groupParams.groupActionFactoryAddress, 'extension:group-action');
    assertExtensionRegistration(runner, extensionParams.centerAddress, core.firstToken, fixture.setup.serviceActionId, fixture.setup.groupServiceExtension, groupParams.groupServiceFactoryAddress, 'extension:group-service');
    assertExtensionRegistration(runner, extensionParams.centerAddress, core.firstToken, lpV1ActionId, lpV1.extension, lpParams.lpFactoryAddress, 'extension:lp-v1');
    assertExtensionRegistration(runner, extensionParams.centerAddress, core.firstToken, lpV2ActionId, lpV2.extension, lpV2Params.lpFactoryV2Address, 'extension:lp-v2');

    const groupVerified = verifyActions(runner, core, groupRound, [
      { actionId: fixture.setup.baseActionId, kind: 'base', verifier: fixture.roles.governors[0] },
      { actionId: fixture.setup.groupActionId, extension: fixture.setup.groupActionExtension, kind: 'group-action', verifier: fixture.roles.governors[1] },
      { actionId: fixture.setup.serviceActionId, extension: fixture.setup.groupServiceExtension, kind: 'group-service', verifier: fixture.roles.governors[2] },
    ], 'group-round');
    const baseClaimant = accounts.find((account) => lower(account.address) === lower(groupVerified[0].selected[0]));
    assert.ok(baseClaimant, 'Base action selected a non-Anvil account');

    console.log('\n=== Burn integration: group round rewards and burns ===');
    advanceToRound(runner, core.verify, groupRound + 1n, 'group-round:mint');
    assert.ok(bool(burn.call('isRoundOpen(uint256)(bool)', [groupRound], 'burn:group-round-open')));
    expectRevertedTransaction(runner, burnAddress, 'claimAirdrop()', [], accounts[3], {
      stage: 'airdrop:claim-before-finalized',
      expectedError: 'ShareNotFinalized()',
    });
    sendBatch(runner, [
      { address: core.mint, signature: 'mintGovReward(address,uint256)', args: [core.firstToken, groupRound], account: accounts[1], stage: 'group-round:mint-gov' },
      { address: core.mint, signature: 'mintActionReward(address,uint256,uint256)', args: [core.firstToken, groupRound, fixture.setup.baseActionId], account: baseClaimant, stage: 'group-round:claim-base' },
      { address: fixture.setup.groupActionExtension, signature: 'claimReward(uint256)', args: [groupRound], account: fixture.roles.groupActionParticipant, stage: 'group-round:claim-group-action' },
      { address: fixture.setup.groupServiceExtension, signature: 'claimReward(uint256)', args: [groupRound], account: fixture.roles.serviceProvider, stage: 'group-round:claim-group-service' },
    ], 'group-round:claims');

    assert.ok(uint(runner.call(core.mint, 'govRewardMintedByAccount(address,uint256,address)(uint256)', [core.firstToken, groupRound, accounts[1].address], { stage: 'group-round:gov-minted' })) > 0n);
    assert.ok(uint(runner.call(core.mint, 'actionRewardMintedByAccount(address,uint256,uint256,address)(uint256)', [core.firstToken, groupRound, fixture.setup.baseActionId, baseClaimant.address], { stage: 'group-round:base-minted' })) > 0n);
    assert.ok(bool(runner.call(fixture.setup.groupActionExtension, 'rewardByAccount(uint256,address)(uint256,uint256,bool)', [groupRound, fixture.roles.groupActionParticipant.address], { stage: 'group-round:group-action-reward' })));
    assert.ok(bool(runner.call(fixture.setup.groupServiceExtension, 'rewardByAccount(uint256,address)(uint256,uint256,bool)', [groupRound, fixture.roles.serviceProvider.address], { stage: 'group-round:group-service-reward' })));

    const firstSl = address(runner.call(core.firstToken, 'slAddress()(address)', [], { stage: 'first:sl-address' }));
    const firstSt = address(runner.call(core.firstToken, 'stAddress()(address)', [], { stage: 'first:st-address' }));
    const lockRequests = [
      { account: accounts[1], amount: positivePortion(balanceOf(runner, firstSl, accounts[1].address, 'first:sl-balance')), signature: 'lockSLToken(address,uint256,uint256)', token: core.firstToken, receipt: firstSl },
      { account: accounts[1], amount: positivePortion(balanceOf(runner, firstSt, accounts[1].address, 'first:st-balance')), signature: 'lockSTToken(address,uint256,uint256)', token: core.firstToken, receipt: firstSt },
      { account: accounts[2], amount: positivePortion(balanceOf(runner, childReceipts.sl, accounts[2].address, 'child:sl-balance')), signature: 'lockSLToken(address,uint256,uint256)', token: child, receipt: childReceipts.sl },
      { account: accounts[2], amount: positivePortion(balanceOf(runner, childReceipts.st, accounts[2].address, 'child:st-balance')), signature: 'lockSTToken(address,uint256,uint256)', token: child, receipt: childReceipts.st },
    ];
    const rewardAccounts = [accounts[1], baseClaimant, fixture.roles.groupActionParticipant, fixture.roles.serviceProvider];
    const uniqueRewardAccounts = [...new Map(rewardAccounts.map((account) => [lower(account.address), account])).values()];
    sendBatch(runner, [
      ...uniqueRewardAccounts.map((account) => ({ address: core.firstToken, signature: 'approve(address,uint256)', args: [burnAddress, MAX_UINT], account, stage: `burn:approve-reward:${account.label}` })),
      ...lockRequests.map((request) => ({ address: request.receipt, signature: 'approve(address,uint256)', args: [burnAddress, request.amount], account: request.account, stage: `burn:approve-${request.signature}` })),
    ], 'burn:approvals');

    const groupBurnReceipts = sendBatch(runner, [
      burn.transaction('burnGovRewardToken(address,uint256,uint256)', [core.firstToken, groupRound, 1], accounts[1], 'burn:gov-reward'),
      burn.transaction('burnActionRewardTokens(uint256,(address,uint256,uint256)[])', [groupRound, `[${tuple([core.firstToken, fixture.setup.baseActionId, 1])}]`], baseClaimant, 'burn:base-action-reward'),
      burn.transaction('burnActionRewardTokens(uint256,(address,uint256,uint256)[])', [groupRound, `[${tuple([core.firstToken, fixture.setup.groupActionId, 1])}]`], fixture.roles.groupActionParticipant, 'burn:group-action-reward'),
      burn.transaction('burnActionRewardTokens(uint256,(address,uint256,uint256)[])', [groupRound, `[${tuple([core.firstToken, fixture.setup.serviceActionId, 1])}]`], fixture.roles.serviceProvider, 'burn:group-service-reward'),
      ...lockRequests.map((request) => burn.transaction(request.signature, [request.token, groupRound, request.amount], request.account, `burn:${request.signature}:${request.account.label}`)),
    ], 'burn:group-round');

    assertBurnEvent(groupBurnReceipts[0], burnAddress, topics.gov, 1, 'event:gov-reward');
    for (let i = 1; i <= 3; i += 1) {
      assertBurnEvent(groupBurnReceipts[i], burnAddress, topics.action, 1, `event:group-action:${i}`);
    }
    assertBurnEvent(groupBurnReceipts[4], burnAddress, topics.sl, 1, 'event:first-sl');
    assertBurnEvent(groupBurnReceipts[5], burnAddress, topics.st, 1, 'event:first-st');
    assertBurnEvent(groupBurnReceipts[6], burnAddress, topics.sl, 1, 'event:child-sl');
    assertBurnEvent(groupBurnReceipts[7], burnAddress, topics.st, 1, 'event:child-st');

    const govState = onlyTuple(burn.callJson('govRewardBurnState(address,address,uint256)((uint256,uint256,bool,uint256,uint256,uint256))', [accounts[1].address, core.firstToken, groupRound], 'burn:gov-state'));
    assert.equal(govState[2], 'true');
    assert.equal(BigInt(govState[4]), 1n);
    assert.ok(actionStateIds(burn.callJson('actionRewardBurnStates(address,address,uint256)((uint256,address,(uint256,uint256,bool,uint256,uint256,uint256))[])', [fixture.roles.groupActionParticipant.address, core.firstToken, groupRound], 'burn:group-action-states')).includes(fixture.setup.groupActionId));
    const childRoundStats = tupleUints(burn.callJson('accountRoundBurnStats(address,address,uint256)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))', [accounts[2].address, child, groupRound], 'burn:child-round-stats')[0]);
    assert.ok(childRoundStats[0] > 0n && childRoundStats[2] > 0n, 'Child SL/ST lock stats were not recorded');
    const communityRoundStats = tupleUints(burn.callJson('communityRoundBurnStats(address,uint256)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))', [core.firstToken, groupRound], 'burn:first-community-round-stats')[0]);
    assert.ok([0, 2, 4, 6].every((index) => communityRoundStats[index] > 0n), 'First community category stats were not recorded');

    console.log('\n=== Burn integration: LP V1/V2 round verify and burn ===');
    verifyActions(runner, core, lpRound, [
      { actionId: lpV1ActionId, extension: lpV1.extension, kind: 'lp-v1', verifier: accounts[1] },
      { actionId: lpV2ActionId, extension: lpV2.extension, kind: 'lp-v2', verifier: accounts[2] },
    ], 'lp-round');
    advanceToRound(runner, core.verify, lpRound + 1n, 'lp-round:mint');
    assert.ok(bool(burn.call('isRoundOpen(uint256)(bool)', [lpRound], 'burn:lp-round-open')));
    sendBatch(runner, [
      { address: lpV1.extension, signature: 'claimReward(uint256)', args: [lpRound], account: accounts[4], stage: 'lp-v1-round:claim' },
      { address: lpV2.extension, signature: 'claimReward(uint256)', args: [lpRound], account: accounts[4], stage: 'lp-v2-round:claim' },
    ], 'lp-round:claims');
    const lpV1Reward = BigInt(runner.callJson(lpV1.extension, 'rewardByAccount(uint256,address)(uint256,uint256,bool)', [lpRound, accounts[4].address], { stage: 'lp-v1-round:reward' })[0]);
    const lpV2Reward = BigInt(runner.callJson(lpV2.extension, 'rewardByAccount(uint256,address)(uint256,uint256,bool)', [lpRound, accounts[4].address], { stage: 'lp-v2-round:reward' })[0]);
    assert.ok(lpV1Reward > 0n && lpV2Reward > 0n, 'LP V1/V2 rewards were not minted');
    sendBatch(runner, [{ address: core.firstToken, signature: 'approve(address,uint256)', args: [burnAddress, MAX_UINT], account: accounts[4], stage: 'lp-round:approve-burn' }], 'lp-round:approve');

    const statsSignature = 'accountRoundBurnStats(address,address,uint256)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))';
    const statsBeforeRejectedBatch = tupleUints(burn.callJson(statsSignature, [accounts[4].address, core.firstToken, lpRound], 'burn:lp-stats-before-rejected-batch')[0]);
    const supplyBeforeRejectedBatch = uint(runner.call(core.firstToken, 'totalSupply()(uint256)', [], { stage: 'burn:supply-before-rejected-batch' }));
    const rejectedBatch = burn.transaction(
      'burnActionRewardTokens(uint256,(address,uint256,uint256)[])',
      [lpRound, `[${tuple([core.firstToken, lpV1ActionId, 1])},${tuple([core.firstToken, lpV2ActionId, lpV2Reward * 5n + 1n])}]`],
      accounts[4],
      'burn:lp-batch-over-quota',
    );
    expectRevertedTransaction(runner, rejectedBatch.address, rejectedBatch.signature, rejectedBatch.args, rejectedBatch.account, {
      stage: rejectedBatch.stage,
      expectedError: 'BurnQuotaExceeded(uint256,uint256)',
    });
    assert.equal(uint(runner.call(core.firstToken, 'totalSupply()(uint256)', [], { stage: 'burn:supply-after-rejected-batch' })), supplyBeforeRejectedBatch);
    assert.deepEqual(tupleUints(burn.callJson(statsSignature, [accounts[4].address, core.firstToken, lpRound], 'burn:lp-stats-after-rejected-batch')[0]), statsBeforeRejectedBatch);

    const lpBurnReceipts = sendBatch(runner, [burn.transaction(
      'burnActionRewardTokens(uint256,(address,uint256,uint256)[])',
      [lpRound, `[${tuple([core.firstToken, lpV1ActionId, 1])},${tuple([core.firstToken, lpV2ActionId, 1])}]`],
      accounts[4],
      'burn:lp-v1-v2-action-reward',
    )], 'lp-round:burn');
    assertBurnEvent(lpBurnReceipts[0], burnAddress, topics.action, 2, 'event:lp-v1-v2');
    const lpActionIds = actionStateIds(burn.callJson('actionRewardBurnStates(address,address,uint256)((uint256,address,(uint256,uint256,bool,uint256,uint256,uint256))[])', [accounts[4].address, core.firstToken, lpRound], 'burn:lp-action-states'));
    assert.ok(lpActionIds.includes(lpV1ActionId) && lpActionIds.includes(lpV2ActionId));

    console.log('\n=== Burn integration: finalized shares and airdrop ===');
    advanceToRound(runner, core.verify, lpRound + 2n, 'burn:finalize');
    const [account1ShareText, account1Finalized] = burn.callJson('accountShare(address)(uint256,bool)', [accounts[1].address], 'burn:account1-share');
    const [account2ShareText, account2Finalized] = burn.callJson('accountShare(address)(uint256,bool)', [accounts[2].address], 'burn:account2-share');
    const account1Share = BigInt(account1ShareText);
    const account2Share = BigInt(account2ShareText);
    assert.ok(account1Share > 0n && account2Share > 0n);
    assert.equal(account1Finalized, 'true');
    assert.equal(account2Finalized, 'true');
    assert.equal(onlyTuple(burn.callJson('accountTokenShare(address,address)((uint256,uint256,uint256,uint256,uint256,bool))', [accounts[2].address, child], 'burn:child-token-share'))[5], 'true');
    assert.ok(tupleUints(burn.callJson('accountBurnStats(address,address)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))', [accounts[1].address, core.firstToken], 'burn:account-stats')[0]).some((value) => value > 0n));
    assert.ok(tupleUints(burn.callJson('communityBurnStats(address)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))', [child], 'burn:community-stats')[0]).some((value) => value > 0n));
    assert.ok(uint(burn.call('participantsCount()(uint256)', [], 'burn:participants-count')) >= 2n);
    const participants = addresses(burn.call('participants(uint256,uint256)(address[])', [0, 20], 'burn:participants')).map(lower);
    assert.ok(participants.includes(lower(accounts[1].address)) && participants.includes(lower(accounts[2].address)));
    assert.ok(bool(burn.call('isParticipant(address)(bool)', [accounts[2].address], 'burn:is-participant')));

    const expiredWrite = burn.transaction('lockSLToken(address,uint256,uint256)', [core.firstToken, lpRound, 1], accounts[1], 'burn:write-after-end');
    expectRevertedTransaction(runner, expiredWrite.address, expiredWrite.signature, expiredWrite.args, expiredWrite.account, {
      stage: expiredWrite.stage,
      expectedError: 'RoundNotOpen(uint256,uint256)',
    });

    sendBatch(runner, [{ address: core.rootParent, signature: 'transfer(address,uint256)', args: [burnAddress, WAD], account: accounts[0], stage: 'airdrop:fund-burn' }], 'airdrop:fund');
    const airdropPool = balanceOf(runner, core.rootParent, burnAddress, 'airdrop:pool-before-claims');
    assert.equal(airdropPool, WAD);
    const account1AirdropBefore = airdropState(burn.callJson('accountAirdropState(address)((bool,bool,bool,uint256,uint256,uint256))', [accounts[1].address], 'airdrop:account1-state-before'));
    const account2AirdropBefore = airdropState(burn.callJson('accountAirdropState(address)((bool,bool,bool,uint256,uint256,uint256))', [accounts[2].address], 'airdrop:account2-state-before'));
    for (const [state, share] of [[account1AirdropBefore, account1Share], [account2AirdropBefore, account2Share]]) {
      assert.equal(state.enabled, true);
      assert.equal(state.shareFinalized, true);
      assert.equal(state.isClaimed, false);
      assert.equal(state.share, share);
      assert.equal(state.claimableAmount, (airdropPool * share) / WAD);
      assert.equal(state.claimedAmount, 0n);
    }
    const before1 = balanceOf(runner, core.rootParent, accounts[1].address, 'airdrop:account1-before');
    const before2 = balanceOf(runner, core.rootParent, accounts[2].address, 'airdrop:account2-before');
    const claimReceipts = sendBatch(runner, [
      burn.transaction('claimAirdrop()', [], accounts[1], 'airdrop:claim-account1'),
      burn.transaction('claimAirdrop()', [], accounts[2], 'airdrop:claim-account2'),
    ], 'airdrop:claims');
    assertBurnEvent(claimReceipts[0], burnAddress, topics.airdrop, 1, 'event:airdrop-account1');
    assertBurnEvent(claimReceipts[1], burnAddress, topics.airdrop, 1, 'event:airdrop-account2');
    const claimed1 = balanceOf(runner, core.rootParent, accounts[1].address, 'airdrop:account1-after') - before1;
    const claimed2 = balanceOf(runner, core.rootParent, accounts[2].address, 'airdrop:account2-after') - before2;
    const remainingPool = balanceOf(runner, core.rootParent, burnAddress, 'airdrop:pool-after-claims');
    assert.ok(claimed1 > 0n && claimed2 > 0n);
    assert.equal(airdropPool, claimed1 + claimed2 + remainingPool);
    assert.equal(uint(burn.call('remainingAirdropShare()(uint256)', [], 'airdrop:remaining-share-after')), WAD - account1Share - account2Share);
    const account1AirdropAfter = airdropState(burn.callJson('accountAirdropState(address)((bool,bool,bool,uint256,uint256,uint256))', [accounts[1].address], 'airdrop:account1-state-after'));
    const account2AirdropAfter = airdropState(burn.callJson('accountAirdropState(address)((bool,bool,bool,uint256,uint256,uint256))', [accounts[2].address], 'airdrop:account2-state-after'));
    for (const [state, claimed] of [[account1AirdropAfter, claimed1], [account2AirdropAfter, claimed2]]) {
      assert.equal(state.enabled, true);
      assert.equal(state.shareFinalized, true);
      assert.equal(state.isClaimed, true);
      assert.equal(state.claimableAmount, 0n);
      assert.equal(state.claimedAmount, claimed);
    }
    expectRevertedTransaction(runner, burnAddress, 'claimAirdrop()', [], accounts[1], {
      stage: 'airdrop:claim-twice',
      expectedError: 'AirdropAlreadyClaimed()',
    });
    assert.equal(balanceOf(runner, core.rootParent, accounts[1].address, 'airdrop:account1-after-rejected-claim'), before1 + claimed1);
  } finally {
    resumeMining(runner, graph.network.secondsPerBlock, 'burn:restore-mining');
  }

  assertBurnCoverage(burn);
  console.log(`  burn: covered ${burn.covered.size} IBurn functions, 2 communities, 5 action types, ${factories.length} factories`);
}
