import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const WAD = 1_000_000_000_000_000_000n;
const MAX_UINT = (1n << 256n) - 1n;
const CHILD_SYMBOL = 'BURN20';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BURN_INDEXED_FIELDS = [['tokenAddress', 'address'], ['account', 'address'], ['round', 'uint256']];
const BURN_TOTAL_FIELDS = [
  ['amount', 'uint256'],
  ['scoreMultiplier', 'uint256'],
  ['score', 'uint256'],
  ['accountTotalAmount', 'uint256'],
  ['accountTotalScore', 'uint256'],
  ['communityTotalAmount', 'uint256'],
  ['communityTotalScore', 'uint256'],
];
const BURN_EVENT_SPECS = {
  community: {
    name: 'CommunityConfigFrozen',
    indexed: [['tokenAddress', 'address']],
    data: [
      ['tokenSymbol', 'string'],
      ['weight', 'uint256'],
      ['scoreBase', 'uint256'],
      ['totalSupply', 'uint256'],
      ['deploymentRoundReward', 'uint256'],
    ],
  },
  factory: {
    name: 'SupportedExtensionFactoryFrozen',
    indexed: [['factory', 'address']],
    data: [],
  },
  sl: {
    name: 'SLTokenLocked',
    indexed: BURN_INDEXED_FIELDS,
    data: BURN_TOTAL_FIELDS,
  },
  st: {
    name: 'STTokenLocked',
    indexed: BURN_INDEXED_FIELDS,
    data: BURN_TOTAL_FIELDS,
  },
  gov: {
    name: 'GovRewardTokenBurned',
    indexed: BURN_INDEXED_FIELDS,
    data: BURN_TOTAL_FIELDS,
  },
  action: {
    name: 'ActionRewardTokenBurned',
    indexed: BURN_INDEXED_FIELDS,
    data: [
      ['actionId', 'uint256'],
      ['extensionAddress', 'address'],
      ['amount', 'uint256'],
      ['scoreMultiplier', 'uint256'],
      ['score', 'uint256'],
      ['accountTotalAmount', 'uint256'],
      ['accountTotalScore', 'uint256'],
      ['communityTotalAmount', 'uint256'],
      ['communityTotalScore', 'uint256'],
    ],
  },
  airdrop: {
    name: 'AirdropClaimed',
    indexed: [['account', 'address']],
    data: [['share', 'uint256'], ['amount', 'uint256'], ['remainingShare', 'uint256']],
  },
};
const BURN_CATEGORIES = [
  { categoryKey: 'sl', label: 'SL 锁仓' },
  { categoryKey: 'st', label: 'ST 锁仓' },
  { categoryKey: 'gov', label: '治理奖励销毁' },
  { categoryKey: 'action', label: '行动奖励销毁' },
];

function burnEventSignature(eventName) {
  const spec = BURN_EVENT_SPECS[eventName];
  return `${spec.name}(${[...spec.indexed, ...spec.data].map(([, type]) => type).join(',')})`;
}

export const burnEventSchemas = Object.keys(BURN_EVENT_SPECS).map((eventName) => {
  const spec = BURN_EVENT_SPECS[eventName];
  return {
    name: spec.name,
    fields: [
      ...spec.indexed.map(([name, type]) => ({ name, type, indexed: true })),
      ...spec.data.map(([name, type]) => ({ name, type, indexed: false })),
    ],
  };
});

export function renderNumericReport(metadata, rows) {
  for (const row of rows) {
    assert.equal(
      row.contract,
      row.theory,
      `${row.metric}: theory=${row.theory} contract=${row.contract} event=${row.event}`,
    );
    assert.equal(
      row.event,
      row.theory,
      `${row.metric}: theory=${row.theory} contract=${row.contract} event=${row.event}`,
    );
  }

  return [
    '# Burn 数值集成测试报告',
    '',
    `- 集成测试 Burn: \`${metadata.burnAddress}\``,
    `- 明确配置轮次: ${metadata.startRound} - ${metadata.endRound}`,
    `- 指标数: ${rows.length}`,
    '- 数值单位: 合约原始整数（WAD = 1e18）',
    ...(metadata.entities || []).map((entity) => `- ${entity.label}: \`${entity.address}\``),
    '',
    '| 分类 | 指标 | 理论数值 | 合约数值 | 事件数值 | 结果 |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.section} | ${row.metric} | ${row.theory} | ${row.contract} | ${row.event} | PASS |`),
    '',
  ].join('\n');
}

function numericReportPath(root) {
  return resolve(root, 'state/logs/burn-numeric-report.md');
}

export function clearNumericReport(root) {
  rmSync(numericReportPath(root), { force: true });
}

export const burnInterfaceFunctions = [
  'extensionCenter',
  'scopeTokenSymbol',
  'scopeTokenAddress',
  'airdropTokenAddress',
  'startRound',
  'roundCount',
  'endRound',
  'quotaMultiplier',
  'slTokenLockWeight',
  'stTokenLockWeight',
  'govRewardBurnWeight',
  'actionRewardBurnWeight',
  'totalCommunityWeight',
  'remainingAirdropShare',
  'communities',
  'communitySymbols',
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
  'accountBurnStatsThroughRound',
  'accountBurnStats',
  'communityRoundBurnStats',
  'communityBurnStatsThroughRound',
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

function expectedEvent(eventName, values) {
  const fields = BURN_EVENT_SPECS[eventName];
  return Object.fromEntries([...fields.indexed, ...fields.data].map(([name, type]) => [
    name,
    type === 'address' ? lower(values[name]) : type === 'string' ? String(values[name]) : BigInt(values[name]),
  ]));
}

function decodeAbiFields(runner, fields, data, stage) {
  if (fields.length === 0) return {};
  const signature = `event()(${fields.map(([, type]) => type).join(',')})`;
  const output = runner.run(['abi-decode', '--json', signature, data], { stage }).stdout;
  const values = JSON.parse(output);
  assert.equal(values.length, fields.length, `${stage}: decoded field count mismatch`);
  return Object.fromEntries(fields.map(([name, type], index) => [
    name,
    type === 'address' ? lower(values[index]) : type === 'string' ? String(values[index]) : BigInt(values[index]),
  ]));
}

export function decodeBurnEvents(runner, receipt, burnAddress, eventName, stage) {
  const fields = BURN_EVENT_SPECS[eventName];
  assert.ok(fields, `${stage}: unknown Burn event ${eventName}`);
  const topic = lower(runner.run(['sig-event', burnEventSignature(eventName)], { stage: `${stage}:topic` }).stdout);
  return (receipt.raw.logs || [])
    .filter((log) => lower(log.address) === lower(burnAddress) && lower(log.topics?.[0]) === topic)
    .map((log, index) => {
      assert.equal(log.topics.length, fields.indexed.length + 1, `${stage}:${index}: indexed field count mismatch`);
      const indexedData = `0x${log.topics.slice(1).map((value) => value.replace(/^0x/, '')).join('')}`;
      return {
        ...decodeAbiFields(runner, fields.indexed, indexedData, `${stage}:${index}:indexed`),
        ...decodeAbiFields(runner, fields.data, log.data, `${stage}:${index}:data`),
      };
    });
}

function assertBurnEvents(runner, receipt, burnAddress, eventName, expected, stage) {
  assert.deepEqual(
    decodeBurnEvents(runner, receipt, burnAddress, eventName, stage),
    expected.map((values) => expectedEvent(eventName, values)),
    `${stage}: unexpected ${burnEventSignature(eventName)} event data`,
  );
}

function burnEventModel() {
  const roundTotals = new Map();
  const accountTotals = new Map();
  const communityTotals = new Map();
  const records = [];

  function read(map, key) {
    return map.get(key) || { amount: 0n, score: 0n };
  }

  return {
    record(eventName, values) {
      const token = lower(values.tokenAddress);
      const account = lower(values.account);
      const roundKey = `${account}:${token}:${values.round}:${eventName}`;
      const accountKey = `${account}:${token}:${eventName}`;
      const communityKey = `${token}:${eventName}`;
      const roundBefore = read(roundTotals, roundKey);
      const roundAmount = roundBefore.amount + values.amount;
      const roundScore = (roundAmount * values.scoreMultiplier) / WAD;
      const score = roundScore - roundBefore.score;
      const accountTotal = read(accountTotals, accountKey);
      const communityTotal = read(communityTotals, communityKey);
      const nextAccountTotal = { amount: accountTotal.amount + values.amount, score: accountTotal.score + score };
      const nextCommunityTotal = { amount: communityTotal.amount + values.amount, score: communityTotal.score + score };

      roundTotals.set(roundKey, { amount: roundAmount, score: roundScore });
      accountTotals.set(accountKey, nextAccountTotal);
      communityTotals.set(communityKey, nextCommunityTotal);
      const record = {
        ...values,
        score,
        accountTotalAmount: nextAccountTotal.amount,
        accountTotalScore: nextAccountTotal.score,
        communityTotalAmount: nextCommunityTotal.amount,
        communityTotalScore: nextCommunityTotal.score,
      };
      records.push({ eventName, ...record });
      return record;
    },
    accountTotal(account, token, eventName) {
      return read(accountTotals, `${lower(account)}:${lower(token)}:${eventName}`);
    },
    communityTotal(token, eventName) {
      return read(communityTotals, `${lower(token)}:${eventName}`);
    },
    accountThroughRound(account, token, eventName, round) {
      return sumBurnRecords(records, round, (record) => (
        record.eventName === eventName
        && lower(record.account) === lower(account)
        && lower(record.tokenAddress) === lower(token)
      ));
    },
    communityThroughRound(token, eventName, round) {
      return sumBurnRecords(records, round, (record) => (
        record.eventName === eventName && lower(record.tokenAddress) === lower(token)
      ));
    },
    accountEntries() {
      return [...accountTotals].map(([key, value]) => {
        const [account, token, eventName] = key.split(':');
        return { account, token, eventName, ...value };
      });
    },
    communityEntries() {
      return [...communityTotals].map(([key, value]) => {
        const [token, eventName] = key.split(':');
        return { token, eventName, ...value };
      });
    },
  };
}

function sumBurnRecords(records, round, matches) {
  return records.reduce(
    (total, record) => record.round <= round && matches(record)
      ? { amount: total.amount + record.amount, score: total.score + record.score }
      : total,
    { amount: 0n, score: 0n },
  );
}

function powWad(base, exponent) {
  let result = WAD;
  while (exponent > 0n) {
    if ((exponent & 1n) !== 0n) result = (result * base) / WAD;
    exponent >>= 1n;
    if (exponent > 0n) base = (base * base) / WAD;
  }
  return result;
}

function burnStats(value) {
  const values = tupleUints(value);
  assert.equal(values.length, BURN_CATEGORIES.length * 2, `Expected BurnStats, got: ${value}`);
  return Object.fromEntries(BURN_CATEGORIES.map(({ categoryKey }, index) => [categoryKey, {
    amount: values[index * 2],
    score: values[index * 2 + 1],
  }]));
}

function aggregateBurnEventStats(runner, receipt, burnAddress) {
  const accountTotals = new Map();
  const communityTotals = new Map();
  const multipliers = new Map();
  const records = [];
  const add = (map, key, event) => {
    const current = map.get(key) || { amount: 0n, score: 0n };
    map.set(key, { amount: current.amount + event.amount, score: current.score + event.score });
  };

  for (const { categoryKey } of BURN_CATEGORIES) {
    for (const event of decodeBurnEvents(runner, receipt, burnAddress, categoryKey, `report:event:${categoryKey}`)) {
      records.push({ eventName: categoryKey, ...event });
      add(accountTotals, `${event.account}:${event.tokenAddress}:${categoryKey}`, event);
      add(communityTotals, `${event.tokenAddress}:${categoryKey}`, event);
      const multiplierKey = `${event.tokenAddress}:${event.round}`;
      const previous = multipliers.get(multiplierKey);
      if (previous !== undefined) assert.equal(event.scoreMultiplier, previous, `Event multiplier changed for ${multiplierKey}`);
      multipliers.set(multiplierKey, event.scoreMultiplier);
    }
  }

  return {
    account(account, token, eventName) {
      return accountTotals.get(`${lower(account)}:${lower(token)}:${eventName}`) || { amount: 0n, score: 0n };
    },
    community(token, eventName) {
      return communityTotals.get(`${lower(token)}:${eventName}`) || { amount: 0n, score: 0n };
    },
    accountThroughRound(account, token, eventName, round) {
      return sumBurnRecords(records, round, (record) => (
        record.eventName === eventName
        && record.account === lower(account)
        && record.tokenAddress === lower(token)
      ));
    },
    communityThroughRound(token, eventName, round) {
      return sumBurnRecords(records, round, (record) => (
        record.eventName === eventName && record.tokenAddress === lower(token)
      ));
    },
    multiplier(token, round) {
      const value = multipliers.get(`${lower(token)}:${round}`);
      assert.notEqual(value, undefined, `No Burn event multiplier for ${token}:${round}`);
      return value;
    },
  };
}

function theoryAccountShare(theory, communities, categoryWeights, account) {
  const active = communities.filter(({ token }) => (
    BURN_CATEGORIES.some(({ categoryKey }) => theory.communityTotal(token, categoryKey).score > 0n)
  ));
  const activeWeight = active.reduce((sum, community) => sum + BigInt(community.weight), 0n);

  return active.reduce((total, community) => {
    const categories = BURN_CATEGORIES.filter(({ categoryKey }) => theory.communityTotal(community.token, categoryKey).score > 0n);
    const communityShare = (BigInt(community.weight) * WAD) / activeWeight;
    const activeCategoryWeight = categories.reduce((sum, { categoryKey }) => sum + BigInt(categoryWeights[categoryKey]), 0n);
    return total + categories.reduce((share, { categoryKey }) => {
      const accountScore = theory.accountTotal(account, community.token, categoryKey).score;
      const communityScore = theory.communityTotal(community.token, categoryKey).score;
      const categoryShare = (communityShare * BigInt(categoryWeights[categoryKey])) / activeCategoryWeight;
      return share + (categoryShare * accountScore) / communityScore;
    }, 0n);
  }, 0n);
}

function buildNumericReport({
  root,
  runner,
  burn,
  burnAddress,
  airdropToken,
  startRound,
  endRound,
  communities,
  categoryWeights,
  factories,
  theory,
  theoreticalCommunities,
  multiplierChecks,
  claimants,
  airdropPool,
  accountLabels,
  historyChecks,
}) {
  const logs = contractLogs(runner, burnAddress, 'report:logs');
  const eventStats = aggregateBurnEventStats(runner, logs, burnAddress);
  const communityEvents = new Map(
    decodeBurnEvents(runner, logs, burnAddress, 'community', 'report:community-events')
      .map((event) => [event.tokenAddress, event]),
  );
  const factoryEvents = decodeBurnEvents(runner, logs, burnAddress, 'factory', 'report:factory-events');
  const airdropEvents = decodeBurnEvents(runner, logs, burnAddress, 'airdrop', 'report:airdrop-events');
  const rows = [];
  const add = (section, metric, theoryValue, contractValue, eventValue) => rows.push({
    section,
    metric,
    theory: BigInt(theoryValue),
    contract: BigInt(contractValue),
    event: BigInt(eventValue),
  });

  add(
    '部署配置',
    '社区总权重',
    communities.reduce((sum, community) => sum + BigInt(community.weight), 0n),
    uint(burn.call('totalCommunityWeight()(uint256)', [], 'report:total-community-weight')),
    [...communityEvents.values()].reduce((sum, event) => sum + event.weight, 0n),
  );
  add(
    '部署配置',
    '扩展 Factory 数量',
    factories.length,
    addresses(burn.call('supportedExtensionFactories()(address[])', [], 'report:factories')).length,
    factoryEvents.length,
  );
  for (const community of theoreticalCommunities) {
    const event = communityEvents.get(lower(community.tokenAddress));
    assert.ok(event, `Missing CommunityConfigFrozen for ${community.tokenAddress}`);
    add(
      '部署配置',
      `${community.label}权重`,
      community.weight,
      uint(burn.call('communityWeight(address)(uint256)', [community.tokenAddress], `report:${community.label}:weight`)),
      event.weight,
    );
    add(
      '部署配置',
      `${community.label} scoreBase`,
      community.scoreBase,
      uint(burn.call('scoreBase(address)(uint256)', [community.tokenAddress], `report:${community.label}:score-base`)),
      event.scoreBase,
    );
  }

  for (const check of multiplierChecks) {
    add(
      '得分系数',
      `${check.label}第 ${check.round} 轮 multiplier`,
      check.theory,
      uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [check.token, check.round], `report:${check.label}:multiplier`)),
      eventStats.multiplier(check.token, check.round),
    );
  }

  for (const community of communities) {
    const contract = burnStats(burn.callJson(
      'communityBurnStats(address)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))',
      [community.token],
      `report:${community.label}:community-stats`,
    )[0]);
    for (const category of BURN_CATEGORIES) {
      const expected = theory.communityTotal(community.token, category.categoryKey);
      const emitted = eventStats.community(community.token, category.categoryKey);
      add('社区累计', `${community.label}${category.label}数量`, expected.amount, contract[category.categoryKey].amount, emitted.amount);
      add('社区累计', `${community.label}${category.label}得分`, expected.score, contract[category.categoryKey].score, emitted.score);
    }
  }

  for (const entry of theory.accountEntries()) {
    const community = communities.find(({ token }) => lower(token) === entry.token);
    const category = BURN_CATEGORIES.find(({ categoryKey }) => categoryKey === entry.eventName);
    const contract = burnStats(burn.callJson(
      'accountBurnStats(address,address)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))',
      [entry.account, entry.token],
      `report:account:${entry.account}:${entry.eventName}`,
    )[0])[entry.eventName];
    const emitted = eventStats.account(entry.account, entry.token, entry.eventName);
    const accountLabel = accountLabels.get(entry.account) || entry.account.slice(0, 8);
    add('地址累计', `${accountLabel}/${community.label}/${category.label}数量`, entry.amount, contract.amount, emitted.amount);
    add('地址累计', `${accountLabel}/${community.label}/${category.label}得分`, entry.score, contract.score, emitted.score);
  }

  const statsOutput = '(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))';
  for (const check of historyChecks) {
    const contract = burnStats(burn.callJson(
      check.account
        ? `accountBurnStatsThroughRound(address,address,uint256)${statsOutput}`
        : `communityBurnStatsThroughRound(address,uint256)${statsOutput}`,
      check.account ? [check.account, check.token, check.round] : [check.token, check.round],
      `report:history:${check.label}:${check.round}`,
    )[0]);
    for (const category of BURN_CATEGORIES) {
      const expected = check.account
        ? theory.accountThroughRound(check.account, check.token, category.categoryKey, check.round)
        : theory.communityThroughRound(check.token, category.categoryKey, check.round);
      const emitted = check.account
        ? eventStats.accountThroughRound(check.account, check.token, category.categoryKey, check.round)
        : eventStats.communityThroughRound(check.token, category.categoryKey, check.round);
      const metric = `${check.label}/第 ${check.round} 轮/${category.label}`;
      add('截至轮次累计', `${metric}数量`, expected.amount, contract[category.categoryKey].amount, emitted.amount);
      add('截至轮次累计', `${metric}得分`, expected.score, contract[category.categoryKey].score, emitted.score);
    }
  }

  assert.equal(airdropEvents.length, claimants.length, 'Unexpected AirdropClaimed event count');
  let theoreticalPool = airdropPool;
  let theoreticalRemainingShare = WAD;
  for (const [index, claimant] of claimants.entries()) {
    const share = theoryAccountShare(theory, communities, categoryWeights, claimant.account);
    const amount = (theoreticalPool * share) / theoreticalRemainingShare;
    const state = airdropState(burn.callJson(
      'accountAirdropState(address)((bool,bool,bool,uint256,uint256,uint256))',
      [claimant.account],
      `report:airdrop:${claimant.label}`,
    ));
    const event = airdropEvents[index];
    assert.equal(event.account, lower(claimant.account), `Unexpected airdrop claimant at index ${index}`);
    add('空投', `${claimant.label}份额`, share, state.share, event.share);
    add('空投', `${claimant.label}领取数量`, amount, state.claimedAmount, event.amount);
    theoreticalPool -= amount;
    theoreticalRemainingShare -= share;
  }
  add(
    '空投',
    '领取后剩余份额',
    theoreticalRemainingShare,
    uint(burn.call('remainingAirdropShare()(uint256)', [], 'report:remaining-share')),
    airdropEvents.at(-1).remainingShare,
  );
  add(
    '空投',
    '领取后剩余代币',
    theoreticalPool,
    balanceOf(runner, airdropToken, burnAddress, 'report:remaining-pool'),
    airdropPool - airdropEvents.reduce((sum, event) => sum + event.amount, 0n),
  );

  const reportPath = numericReportPath(root);
  const content = renderNumericReport({
    burnAddress,
    startRound,
    endRound,
    entities: [
      ...communities.map((community) => ({ label: community.label, address: community.token })),
      ...claimants.map((claimant) => ({ label: claimant.label, address: claimant.account })),
    ],
  }, rows);
  return { content, path: reportPath, rows };
}

function contractLogs(runner, contract, stage) {
  const filter = JSON.stringify({ address: contract, fromBlock: '0x0', toBlock: 'latest' });
  return { raw: { logs: JSON.parse(runner.rpc('eth_getLogs', [filter], { stage })) } };
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

function completeQualificationRound(graph, root, runner, core, account, params) {
  const fixture = prepareGroupActionRound({
    ...graph,
    network: { ...graph.network, secondsPerBlock: undefined },
  }, { params, root, runner });
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

export function deployIntegrationBurn(root, deployer, runner, config, build = spawnSync) {
  const artifactPath = resolve(root, '.foundry/burn/out/Burn.sol/Burn.json');
  assert.match(String(config.startRound), /^\d+$/, 'Integration Burn startRound must be explicit');
  const result = build('forge', [
    'build',
    '--out', resolve(root, '.foundry/burn/out'),
    '--cache-path', resolve(root, '.foundry/burn/cache'),
  ], { cwd: resolve(root, '../burn'), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to build integration Burn: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  const bytecode = JSON.parse(readFileSync(artifactPath, 'utf8')).bytecode?.object;
  assert.ok(/^0x[0-9a-f]+$/i.test(bytecode || ''), `Missing Burn bytecode: ${artifactPath}`);

  const communities = `[${config.communities
    .map((community) => `(${community.symbol},${community.weight})`)
    .join(',')}]`;
  const factories = `[${config.factories.join(',')}]`;
  const encoded = runner.run([
    'abi-encode',
    'constructor(address,string,address,(string,uint256)[],uint256,uint256,uint256,uint256,(uint256,uint256,uint256),address[])',
    config.extensionCenter,
    config.scopeTokenSymbol,
    config.airdropToken,
    communities,
    String(config.slTokenLockWeight),
    String(config.stTokenLockWeight),
    String(config.govRewardBurnWeight),
    String(config.actionRewardBurnWeight),
    `(${config.startRound},${config.roundCount},${config.quotaMultiplier})`,
    factories,
  ], { stage: 'burn:encode-constructor' }).stdout;
  const receipt = JSON.parse(runner.run([
    'send',
    '--private-key',
    deployer.privateKey,
    '--rpc-url',
    runner.rpcUrl,
    '--gas-price',
    '5000000000',
    '--legacy',
    '--json',
    '--create',
    `${bytecode}${encoded.slice(2)}`,
  ], { stage: 'burn:deploy-fixture', account: deployer.accountAddress }).stdout);
  assert.match(receipt.contractAddress || '', /^0x[0-9a-f]{40}$/i, 'Burn fixture deployment returned no contract address');
  return receipt.contractAddress;
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

export async function run({ accounts, deployer, graph, params, root, runner }) {
  clearNumericReport(root);
  assertBurnInterface(root);
  const coreParams = params('core', 'address.params');
  const extensionParams = params('extension', 'address.extension.center.params');
  const lpParams = params('extension-lp', 'address.extension.lp.params');
  const lpV2Params = params('extension-lp', 'address.extension.lp.v2.params');
  const groupParams = params('extension-group', 'address.extension.group.params');
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
  const scopeTokenSymbol = runner.callJson(
    core.firstToken,
    'symbol()(string)',
    [],
    { stage: 'burn:scope-symbol' },
  )[0];

  for (const [name, contract] of Object.entries({
    ...core,
    extensionCenter: extensionParams.centerAddress,
    lpFactory: lpParams.lpFactoryAddress,
    lpFactoryV2: lpV2Params.lpFactoryV2Address,
    groupActionFactory: groupParams.groupActionFactoryAddress,
    groupServiceFactory: groupParams.groupServiceFactoryAddress,
  })) {
    const code = runner.run(['code', contract, '--rpc-url', runner.rpcUrl], { stage: `code:${name}` }).stdout;
    assert.notEqual(code, '0x', `${name} has no deployed code`);
  }
  console.log('\n=== Burn integration: child-community eligibility ===');
  completeQualificationRound(graph, root, runner, core, accounts[1], params);
  completeQualificationRound(graph, root, runner, core, accounts[1], params);
  assert.ok(uint(runner.call(core.mint, 'numOfMintGovRewardByAccount(address,address)(uint256)', [core.firstToken, accounts[1].address], { stage: 'qualification:mint-count' })) >= 2n);

  console.log('\n=== Burn integration: child community and receipts ===');
  const child = launchChildCommunity(runner, core, accounts[0], accounts[1], accounts[2]);
  const childTokenSymbol = runner.callJson(
    child,
    'symbol()(string)',
    [],
    { stage: 'burn:child-symbol' },
  )[0];
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
  }, { params, root, runner });
  const groupRound = fixture.setup.voteRound;
  const lpRound = groupRound + 1n;
  const endRound = groupRound + 2n;
  assert.equal(uint(runner.call(core.vote, 'currentRound()(uint256)', [], { stage: 'lp:vote-round-before-submit' })), lpRound);
  const lpV1ActionId = actionIdAfterSubmit(runner, core, accounts[1], lpV1.extension, 'lp-v1-action');
  const lpV2ActionId = actionIdAfterSubmit(runner, core, accounts[3], lpV2.extension, 'lp-v2-action');
  voteAction(runner, core, accounts[1], lpV1ActionId, lpRound, 'lp-v1-action:vote');
  voteAction(runner, core, accounts[2], lpV2ActionId, lpRound, 'lp-v2-action:vote');

  const communities = [
    { symbol: scopeTokenSymbol, token: core.firstToken, weight: 1, label: '主社区' },
    { symbol: childTokenSymbol, token: child, weight: 2, label: '子社区' },
  ];
  const categoryWeights = { sl: 1, st: 3, gov: 5, action: 7 };
  console.log(`  burn: deploying integration contract with explicit startRound=${groupRound}`);
  const burnAddress = deployIntegrationBurn(root, deployer, runner, {
    airdropToken: core.rootParent,
    communities,
    extensionCenter: extensionParams.centerAddress,
    factories,
    slTokenLockWeight: categoryWeights.sl,
    stTokenLockWeight: categoryWeights.st,
    govRewardBurnWeight: categoryWeights.gov,
    actionRewardBurnWeight: categoryWeights.action,
    quotaMultiplier: 5,
    roundCount: 3,
    scopeTokenSymbol,
    startRound: groupRound,
  });
  console.log(`  burn: fixture deployed at ${burnAddress}`);
  const burn = burnClient(runner, burnAddress);
  const theory = burnEventModel();

  assert.equal(lower(address(burn.call('extensionCenter()(address)', [], 'burn:extension-center'))), lower(extensionParams.centerAddress));
  assert.deepEqual(burn.callJson('scopeTokenSymbol()(string)', [], 'burn:scope-symbol-view'), [scopeTokenSymbol]);
  assert.equal(lower(address(burn.call('scopeTokenAddress()(address)', [], 'burn:scope-token'))), lower(core.firstToken));
  assert.equal(lower(address(burn.call('airdropTokenAddress()(address)', [], 'burn:airdrop-token'))), lower(core.rootParent));
  assert.equal(uint(burn.call('startRound()(uint256)', [], 'burn:start-round')), groupRound);
  assert.equal(uint(burn.call('roundCount()(uint256)', [], 'burn:round-count')), 3n);
  assert.equal(uint(burn.call('endRound()(uint256)', [], 'burn:end-round')), endRound);
  assert.equal(uint(burn.call('quotaMultiplier()(uint256)', [], 'burn:quota-multiplier')), 5n);
  assert.equal(uint(burn.call('slTokenLockWeight()(uint256)', [], 'burn:sl-weight')), 1n);
  assert.equal(uint(burn.call('stTokenLockWeight()(uint256)', [], 'burn:st-weight')), 3n);
  assert.equal(uint(burn.call('govRewardBurnWeight()(uint256)', [], 'burn:gov-weight')), 5n);
  assert.equal(uint(burn.call('actionRewardBurnWeight()(uint256)', [], 'burn:action-weight')), 7n);
  assert.equal(uint(burn.call('totalCommunityWeight()(uint256)', [], 'burn:total-community-weight')), 3n);
  assert.equal(uint(burn.call('remainingAirdropShare()(uint256)', [], 'burn:remaining-share')), WAD);
  assert.deepEqual(addresses(burn.call('communities()(address[])', [], 'burn:communities')).map(lower), [core.firstToken, child].map(lower));
  assert.deepEqual(JSON.parse(burn.call('communitySymbols()(string[])', [], 'burn:community-symbols')), [scopeTokenSymbol, childTokenSymbol]);
  assert.equal(uint(burn.call('communityWeight(address)(uint256)', [core.firstToken], 'burn:first-weight')), 1n);
  assert.equal(uint(burn.call('communityWeight(address)(uint256)', [child], 'burn:child-weight')), 2n);
  assert.ok(uint(burn.call('scoreBase(address)(uint256)', [core.firstToken], 'burn:first-score-base')) >= WAD);
  assert.ok(uint(burn.call('scoreBase(address)(uint256)', [child], 'burn:child-score-base')) >= WAD);
  assert.deepEqual(addresses(burn.call('supportedExtensionFactories()(address[])', [], 'burn:factories')).map(lower), factories.map(lower));
  for (const factory of factories) assert.ok(bool(burn.call('isSupportedExtensionFactory(address)(bool)', [factory], `burn:factory:${factory}`)));
  assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [core.firstToken, groupRound], 'burn:score-multiplier')) > 0n, true);

  const deploymentLogs = contractLogs(runner, burnAddress, 'event:deployment-logs');
  const rewardRatePerThousand = uint(runner.call(core.mint, 'ROUND_REWARD_GOV_PER_THOUSAND()(uint256)', [], { stage: 'event:gov-rate' }))
    + uint(runner.call(core.mint, 'ROUND_REWARD_ACTION_PER_THOUSAND()(uint256)', [], { stage: 'event:action-rate' }));
  const theoreticalCommunities = communities.map(({ symbol, token, weight, label }) => {
    const totalSupply = uint(runner.call(token, 'totalSupply()(uint256)', [], { stage: `event:community:${token}:total-supply` }));
    const maxSupply = uint(runner.call(token, 'maxSupply()(uint256)', [], { stage: `event:community:${token}:max-supply` }));
    const deploymentRoundReward = ((maxSupply - totalSupply) * rewardRatePerThousand) / 1000n;
    return {
      tokenAddress: token,
      tokenSymbol: symbol,
      label,
      weight,
      scoreBase: WAD + (deploymentRoundReward * WAD) / totalSupply,
      totalSupply,
      deploymentRoundReward,
    };
  });
  assertBurnEvents(runner, deploymentLogs, burnAddress, 'community', theoreticalCommunities, 'event:community-config');
  assertBurnEvents(
    runner,
    deploymentLogs,
    burnAddress,
    'factory',
    factories.map((factory) => ({ factory })),
    'event:supported-factories',
  );
  const scoreBaseByToken = new Map(theoreticalCommunities.map((community) => [lower(community.tokenAddress), community.scoreBase]));
  const theoreticalMultiplier = (token, round) => powWad(scoreBaseByToken.get(lower(token)), endRound - round);
  const multiplierChecks = [];

  runner.txValue(core.rootParent, 'deposit()', WAD, [], accounts[0], { stage: 'airdrop:fund-deployer' });
  pauseMining(runner, 'burn:manual-mining');
  let numericReport;
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

    const firstMultiplier = theoreticalMultiplier(core.firstToken, groupRound);
    const childMultiplier = theoreticalMultiplier(child, groupRound);
    assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [core.firstToken, groupRound], 'event:first-multiplier')), firstMultiplier);
    assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [child, groupRound], 'event:child-multiplier')), childMultiplier);
    multiplierChecks.push(
      { label: '主社区', token: core.firstToken, round: groupRound, theory: firstMultiplier },
      { label: '子社区', token: child, round: groupRound, theory: childMultiplier },
    );
    const rewardEventChecks = [
      {
        eventName: 'gov',
        receipt: groupBurnReceipts[0],
        values: { tokenAddress: core.firstToken, account: accounts[1].address, round: groupRound, amount: 1n, scoreMultiplier: firstMultiplier },
      },
      {
        eventName: 'action',
        receipt: groupBurnReceipts[1],
        values: {
          tokenAddress: core.firstToken,
          account: baseClaimant.address,
          round: groupRound,
          actionId: fixture.setup.baseActionId,
          extensionAddress: ZERO_ADDRESS,
          amount: 1n,
          scoreMultiplier: firstMultiplier,
        },
      },
      {
        eventName: 'action',
        receipt: groupBurnReceipts[2],
        values: {
          tokenAddress: core.firstToken,
          account: fixture.roles.groupActionParticipant.address,
          round: groupRound,
          actionId: fixture.setup.groupActionId,
          extensionAddress: fixture.setup.groupActionExtension,
          amount: 1n,
          scoreMultiplier: firstMultiplier,
        },
      },
      {
        eventName: 'action',
        receipt: groupBurnReceipts[3],
        values: {
          tokenAddress: core.firstToken,
          account: fixture.roles.serviceProvider.address,
          round: groupRound,
          actionId: fixture.setup.serviceActionId,
          extensionAddress: fixture.setup.groupServiceExtension,
          amount: 1n,
          scoreMultiplier: firstMultiplier,
        },
      },
    ];
    for (const [index, check] of rewardEventChecks.entries()) {
      assertBurnEvents(
        runner,
        check.receipt,
        burnAddress,
        check.eventName,
        [theory.record(check.eventName, check.values)],
        `event:group-reward:${index}`,
      );
    }
    for (const [index, request] of lockRequests.entries()) {
      const eventName = request.signature.startsWith('lockSLToken') ? 'sl' : 'st';
      assertBurnEvents(
        runner,
        groupBurnReceipts[index + 4],
        burnAddress,
        eventName,
        [theory.record(eventName, {
          tokenAddress: request.token,
          account: request.account.address,
          round: groupRound,
          amount: request.amount,
          scoreMultiplier: lower(request.token) === lower(core.firstToken) ? firstMultiplier : childMultiplier,
        })],
        `event:receipt-lock:${index}`,
      );
    }

    const govState = onlyTuple(burn.callJson('govRewardBurnState(address,address,uint256)((uint256,uint256,bool,uint256,uint256,uint256))', [accounts[1].address, core.firstToken, groupRound], 'burn:gov-state'));
    assert.equal(govState[2], 'true');
    assert.equal(BigInt(govState[4]), 1n);
    assert.ok(actionStateIds(burn.callJson('actionRewardBurnStates(address,address,uint256)((uint256,address,(uint256,uint256,bool,uint256,uint256,uint256))[])', [fixture.roles.groupActionParticipant.address, core.firstToken, groupRound], 'burn:group-action-states')).includes(fixture.setup.groupActionId));
    const statsOutput = '(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))';
    const accountThroughStatsSignature = `accountBurnStatsThroughRound(address,address,uint256)${statsOutput}`;
    const communityThroughStatsSignature = `communityBurnStatsThroughRound(address,uint256)${statsOutput}`;
    const childRoundStats = tupleUints(burn.callJson(`accountRoundBurnStats(address,address,uint256)${statsOutput}`, [accounts[2].address, child, groupRound], 'burn:child-round-stats')[0]);
    assert.ok(childRoundStats[0] > 0n && childRoundStats[2] > 0n, 'Child SL/ST lock stats were not recorded');
    assert.deepEqual(
      tupleUints(burn.callJson(accountThroughStatsSignature, [accounts[2].address, child, groupRound], 'burn:child-stats-through-group-round')[0]),
      childRoundStats,
    );
    const communityRoundStats = tupleUints(burn.callJson(`communityRoundBurnStats(address,uint256)${statsOutput}`, [core.firstToken, groupRound], 'burn:first-community-round-stats')[0]);
    assert.ok([0, 2, 4, 6].every((index) => communityRoundStats[index] > 0n), 'First community category stats were not recorded');
    const firstCommunityThroughGroupRound = tupleUints(
      burn.callJson(communityThroughStatsSignature, [core.firstToken, groupRound], 'burn:first-community-stats-through-group-round')[0],
    );
    assert.deepEqual(firstCommunityThroughGroupRound, communityRoundStats);
    const account1ThroughGroupRound = tupleUints(
      burn.callJson(accountThroughStatsSignature, [accounts[1].address, core.firstToken, groupRound], 'burn:account1-stats-through-group-round')[0],
    );

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
    const lpMultiplier = theoreticalMultiplier(core.firstToken, lpRound);
    assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [core.firstToken, lpRound], 'event:lp-multiplier')), lpMultiplier);
    multiplierChecks.push({ label: '主社区', token: core.firstToken, round: lpRound, theory: lpMultiplier });
    assertBurnEvents(runner, lpBurnReceipts[0], burnAddress, 'action', [
      theory.record('action', {
        tokenAddress: core.firstToken,
        account: accounts[4].address,
        round: lpRound,
        actionId: lpV1ActionId,
        extensionAddress: lpV1.extension,
        amount: 1n,
        scoreMultiplier: lpMultiplier,
      }),
      theory.record('action', {
        tokenAddress: core.firstToken,
        account: accounts[4].address,
        round: lpRound,
        actionId: lpV2ActionId,
        extensionAddress: lpV2.extension,
        amount: 1n,
        scoreMultiplier: lpMultiplier,
      }),
    ], 'event:lp-v1-v2');
    const lpActionIds = actionStateIds(burn.callJson('actionRewardBurnStates(address,address,uint256)((uint256,address,(uint256,uint256,bool,uint256,uint256,uint256))[])', [accounts[4].address, core.firstToken, lpRound], 'burn:lp-action-states'));
    assert.ok(lpActionIds.includes(lpV1ActionId) && lpActionIds.includes(lpV2ActionId));

    console.log('\n=== Burn integration: end round receipt lock ===');
    advanceToRound(runner, core.verify, endRound + 1n, 'end-round:open');
    assert.ok(bool(burn.call('isRoundOpen(uint256)(bool)', [endRound], 'burn:end-round-open')));
    const endRoundSlAmount = positivePortion(balanceOf(runner, firstSl, accounts[1].address, 'end-round:sl-balance'));
    const endRoundReceipts = sendBatch(runner, [
      { address: firstSl, signature: 'approve(address,uint256)', args: [burnAddress, endRoundSlAmount], account: accounts[1], stage: 'end-round:approve-sl' },
      burn.transaction('lockSLToken(address,uint256,uint256)', [core.firstToken, endRound, endRoundSlAmount], accounts[1], 'end-round:lock-sl'),
    ], 'end-round:lock');
    const endRoundMultiplier = theoreticalMultiplier(core.firstToken, endRound);
    assert.equal(endRoundMultiplier, WAD);
    assert.equal(uint(burn.call('scoreMultiplier(address,uint256)(uint256)', [core.firstToken, endRound], 'end-round:multiplier')), endRoundMultiplier);
    multiplierChecks.push({ label: '主社区', token: core.firstToken, round: endRound, theory: endRoundMultiplier });
    assertBurnEvents(runner, endRoundReceipts[1], burnAddress, 'sl', [
      theory.record('sl', {
        tokenAddress: core.firstToken,
        account: accounts[1].address,
        round: endRound,
        amount: endRoundSlAmount,
        scoreMultiplier: endRoundMultiplier,
      }),
    ], 'event:end-round-sl');

    console.log('\n=== Burn integration: finalized shares and airdrop ===');
    advanceToRound(runner, core.verify, endRound + 2n, 'burn:finalize');
    const [account1ShareText, account1Finalized] = burn.callJson('accountShare(address)(uint256,bool)', [accounts[1].address], 'burn:account1-share');
    const [account2ShareText, account2Finalized] = burn.callJson('accountShare(address)(uint256,bool)', [accounts[2].address], 'burn:account2-share');
    const account1Share = BigInt(account1ShareText);
    const account2Share = BigInt(account2ShareText);
    assert.ok(account1Share > 0n && account2Share > 0n);
    assert.equal(account1Finalized, 'true');
    assert.equal(account2Finalized, 'true');
    assert.equal(onlyTuple(burn.callJson('accountTokenShare(address,address)((uint256,uint256,uint256,uint256,uint256,bool))', [accounts[2].address, child], 'burn:child-token-share'))[5], 'true');
    const account1TotalStats = tupleUints(
      burn.callJson(`accountBurnStats(address,address)${statsOutput}`, [accounts[1].address, core.firstToken], 'burn:account-stats')[0],
    );
    assert.ok(account1TotalStats.some((value) => value > 0n));
    const firstCommunityTotalStats = tupleUints(
      burn.callJson(`communityBurnStats(address)${statsOutput}`, [core.firstToken], 'burn:first-community-stats')[0],
    );
    assert.deepEqual(
      tupleUints(burn.callJson(accountThroughStatsSignature, [accounts[1].address, core.firstToken, groupRound], 'burn:account1-historical-stats-after-end')[0]),
      account1ThroughGroupRound,
    );
    assert.deepEqual(
      tupleUints(burn.callJson(communityThroughStatsSignature, [core.firstToken, groupRound], 'burn:first-community-historical-stats-after-end')[0]),
      firstCommunityThroughGroupRound,
    );
    assert.deepEqual(
      tupleUints(burn.callJson(accountThroughStatsSignature, [accounts[1].address, core.firstToken, endRound], 'burn:account1-stats-through-end')[0]),
      account1TotalStats,
    );
    assert.deepEqual(
      tupleUints(burn.callJson(communityThroughStatsSignature, [core.firstToken, endRound], 'burn:first-community-stats-through-end')[0]),
      firstCommunityTotalStats,
    );
    assert.ok(tupleUints(burn.callJson('communityBurnStats(address)(((uint256,uint256),(uint256,uint256),(uint256,uint256),(uint256,uint256)))', [child], 'burn:community-stats')[0]).some((value) => value > 0n));
    assert.ok(uint(burn.call('participantsCount()(uint256)', [], 'burn:participants-count')) >= 2n);
    const participants = addresses(burn.call('participants(uint256,uint256)(address[])', [0, 20], 'burn:participants')).map(lower);
    assert.ok(participants.includes(lower(accounts[1].address)) && participants.includes(lower(accounts[2].address)));
    assert.ok(bool(burn.call('isParticipant(address)(bool)', [accounts[2].address], 'burn:is-participant')));

    const expiredWrite = burn.transaction('lockSLToken(address,uint256,uint256)', [core.firstToken, endRound, 1], accounts[1], 'burn:write-after-end');
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
    const claimed1 = balanceOf(runner, core.rootParent, accounts[1].address, 'airdrop:account1-after') - before1;
    const claimed2 = balanceOf(runner, core.rootParent, accounts[2].address, 'airdrop:account2-after') - before2;
    const remainingPool = balanceOf(runner, core.rootParent, burnAddress, 'airdrop:pool-after-claims');
    assert.ok(BigInt(claimReceipts[0].raw.transactionIndex) < BigInt(claimReceipts[1].raw.transactionIndex), 'airdrop claims mined out of submission order');
    assertBurnEvents(runner, claimReceipts[0], burnAddress, 'airdrop', [{
      account: accounts[1].address,
      share: account1Share,
      amount: claimed1,
      remainingShare: WAD - account1Share,
    }], 'event:airdrop-account1');
    assertBurnEvents(runner, claimReceipts[1], burnAddress, 'airdrop', [{
      account: accounts[2].address,
      share: account2Share,
      amount: claimed2,
      remainingShare: WAD - account1Share - account2Share,
    }], 'event:airdrop-account2');
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

    numericReport = buildNumericReport({
      root,
      runner,
      burn,
      burnAddress,
      airdropToken: core.rootParent,
      startRound: groupRound,
      endRound,
      communities,
      categoryWeights,
      factories,
      theory,
      theoreticalCommunities,
      multiplierChecks,
      claimants: [
        { account: accounts[1].address, label: accounts[1].label },
        { account: accounts[2].address, label: accounts[2].label },
      ],
      airdropPool,
      accountLabels: new Map(accounts.map((account) => [lower(account.address), account.label])),
      historyChecks: [
        { label: `${accounts[1].label}/主社区`, account: accounts[1].address, token: core.firstToken, round: groupRound },
        { label: '主社区', token: core.firstToken, round: groupRound },
        { label: `${accounts[1].label}/主社区`, account: accounts[1].address, token: core.firstToken, round: endRound },
        { label: '主社区', token: core.firstToken, round: endRound },
      ],
    });
    assert.equal(
      numericReport.rows.filter(({ section }) => section === '截至轮次累计').length,
      4 * BURN_CATEGORIES.length * 2,
      'Historical cumulative numeric rows are incomplete',
    );
  } finally {
    resumeMining(runner, graph.network.secondsPerBlock, 'burn:restore-mining');
  }

  assertBurnCoverage(burn);
  console.log(`  burn: covered ${burn.covered.size} IBurn functions, 2 communities, 5 action types, ${factories.length} factories`);
  return {
    outputs: { 'address.burn.params': { burnAddress } },
    onSuccess() {
      mkdirSync(resolve(root, 'state/logs'), { recursive: true });
      writeFileSync(numericReport.path, numericReport.content);
      console.log(`  burn: numeric report passed ${numericReport.rows.length} metrics -> ${numericReport.path}`);
    },
  };
}
