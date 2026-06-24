import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  getNode,
  isAddress,
  paramsPathForNode,
  readNodeParams,
  readParamsFile,
  repoRoot,
  zeroAddress,
} from './lib.mjs';

function addLine(lines, key, value = '') {
  lines.push(`${key}=${value ?? ''}`);
}

function addSection(lines, title) {
  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  lines.push(`# ${title}`);
}

function envFoundryOutPath(nodeId) {
  return `../love20-anvil/.foundry/${nodeId}/out/`;
}

function requireParam(params, key, label) {
  const value = params[key];
  if (!value) throw new Error(`Missing ${label}:${key}`);
  return value;
}

function optionalAddress(params, key) {
  return isAddress(params[key]) ? params[key] : zeroAddress;
}

function requiredAddress(params, key, label) {
  const value = requireParam(params, key, label);
  if (!isAddress(value)) throw new Error(`${label}:${key} is not an address: ${value}`);
  return value;
}

export function buildEnvContent(graph, root = repoRoot) {
  const core = readNodeParams(graph, 'core', 'address.params', root);
  const love20 = readParamsFile(paramsPathForNode(getNode(graph, 'core'), 'LOVE20.params', root));
  const weth = readParamsFile(paramsPathForNode(getNode(graph, 'core'), 'WETH.params', root));
  const periphery = readNodeParams(graph, 'periphery', 'address.params', root);
  const group = readNodeParams(graph, 'group', 'address.group.params', root);
  const groupDefaults = readNodeParams(graph, 'group-defaults', 'address.group.defaults.params', root);
  const groupDelegate = readNodeParams(graph, 'group-delegate', 'address.group.delegate.params', root);
  const extension = readNodeParams(graph, 'extension', 'address.extension.center.params', root);
  const extensionLp = readNodeParams(graph, 'extension-lp', 'address.extension.lp.params', root);
  const extensionLpV2 = readNodeParams(graph, 'extension-lp', 'address.extension.lp.v2.params', root);
  const extensionGroup = readNodeParams(graph, 'extension-group', 'address.extension.group.params', root);
  const groupChat = readNodeParams(graph, 'group-chat', 'address.group.chat.params', root);
  const batchTransfer = readNodeParams(graph, 'batch-transfer', 'address.batch-transfer.params', root);

  const lines = ['# 由 love20-anvil 生成。重新生成请运行 npm run env。', ''];

  addSection(lines, '应用');
  addLine(lines, 'NEXT_PUBLIC_APP_VERSION', 'anvil');

  addSection(lines, '链');
  addLine(lines, 'NEXT_PUBLIC_CHAIN', 'anvil');
  addLine(lines, 'NEXT_PUBLIC_CHAIN_ID', graph.network.chainId);
  addLine(lines, 'NEXT_PUBLIC_CHAIN_NAME', 'Anvil');
  addLine(lines, 'NEXT_PUBLIC_ANVIL_RPC_URL', graph.network.rpcUrl);
  addLine(lines, 'NEXT_PUBLIC_THINKIUM_RPC_URL', graph.network.rpcUrl);
  addLine(lines, 'NEXT_PUBLIC_NATIVE_TOKEN_SYMBOL', 'ETH');
  addLine(lines, 'NEXT_PUBLIC_FIRST_PARENT_TOKEN_SYMBOL', weth.WETH_SYMBOL || 'ETH20');
  addLine(lines, 'NEXT_PUBLIC_TOKEN_DECIMALS', '18');
  addLine(lines, 'NEXT_PUBLIC_BLOCK_TIME_MS', String(Number(graph.network.secondsPerBlock) * 1000));
  addLine(lines, 'NEXT_PUBLIC_TOKEN_PREFIX', 'Test');
  addLine(lines, 'NEXT_PUBLIC_BASE_PATH', '');

  addSection(lines, 'USDT');
  addLine(lines, 'NEXT_PUBLIC_USDT_SYMBOL', '');
  addLine(lines, 'NEXT_PUBLIC_USDT_ADDRESS', '');

  addSection(lines, 'ABI');
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_CORE_ABI_PATH', envFoundryOutPath('core'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_PERIPHERAL_ABI_PATH', envFoundryOutPath('periphery'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_GROUP_ABI_PATH', envFoundryOutPath('group'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_GROUP_CHAT_ABI_PATH', envFoundryOutPath('group-chat'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_EXTENSIONS_CENTER_ABI_PATH', envFoundryOutPath('extension'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_EXTENSIONS_LP_ABI_PATH', envFoundryOutPath('extension-lp'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_EXTENSIONS_GROUP_ABI_PATH', envFoundryOutPath('extension-group'));
  addLine(lines, 'NEXT_PUBLIC_FOUNDRY_BATCH_TRANSFER_ABI_PATH', envFoundryOutPath('batch-transfer'));

  addSection(lines, 'Sentry');
  addLine(lines, 'NEXT_PUBLIC_SENTRY_DSN', '');

  addSection(lines, 'LOVE20 参数');
  for (const [key, value] of Object.entries(love20)) {
    addLine(lines, `NEXT_PUBLIC_${key}`, value);
  }

  addSection(lines, 'Core 地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_ROOT_PARENT_TOKEN', requiredAddress(core, 'rootParentTokenAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_UNISWAP_V2_FACTORY', requiredAddress(core, 'uniswapV2FactoryAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_TOKEN_FACTORY', requiredAddress(core, 'tokenFactoryAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_LAUNCH', requiredAddress(core, 'launchAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_STAKE', requiredAddress(core, 'stakeAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_SUBMIT', requiredAddress(core, 'submitAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_VOTE', requiredAddress(core, 'voteAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_JOIN', requiredAddress(core, 'joinAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_RANDOM', requiredAddress(core, 'randomAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_VERIFY', requiredAddress(core, 'verifyAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_MINT', requiredAddress(core, 'mintAddress', 'core/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_FIRST_TOKEN', requiredAddress(core, 'firstTokenAddress', 'core/address.params'));

  addSection(lines, 'Periphery 地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_PERIPHERAL_TOKENVIEWER', requiredAddress(periphery, 'tokenViewerAddress', 'periphery/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_PERIPHERAL_ROUNDVIEWER', requiredAddress(periphery, 'roundViewerAddress', 'periphery/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_PERIPHERAL_MINTVIEWER', requiredAddress(periphery, 'mintViewerAddress', 'periphery/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_PERIPHERAL_HUB', requiredAddress(periphery, 'love20HubAddress', 'periphery/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_UNISWAP_V2_ROUTER', requiredAddress(periphery, 'uniswapV2Router02Address', 'periphery/address.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_UNISWAP_V2_ZAP', requiredAddress(periphery, 'uniswapV2ZapAddress', 'periphery/address.params'));

  addSection(lines, 'Group 地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP', requiredAddress(group, 'groupAddress', 'group/address.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_DEFAULTS', requiredAddress(groupDefaults, 'groupDefaultsAddress', 'group/address.group.defaults.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_DELEGATE', requiredAddress(groupDelegate, 'groupDelegateAddress', 'group/address.group.delegate.params'));

  addSection(lines, 'Group Chat 地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT', requiredAddress(groupChat, 'groupChatAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_ADMIN', requiredAddress(groupChat, 'groupAdminAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_BAN_LIST', requiredAddress(groupChat, 'groupBanListAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_ADMIN_BAN_SOURCE', requiredAddress(groupChat, 'adminBanSourceAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_GOV_VOTED_BAN_SOURCE', requiredAddress(groupChat, 'govVotedBanSourceAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_MEMBER', requiredAddress(groupChat, 'groupMemberAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_MEMBER_SCOPE', requiredAddress(groupChat, 'groupMemberScopeAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_JOIN_SCOPE_SOURCE', requiredAddress(groupChat, 'groupJoinScopeSourceAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_TOKEN_MAIN_MANAGER', requiredAddress(groupChat, 'tokenMainManagerAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_TOKEN_GOV_MANAGER', requiredAddress(groupChat, 'tokenGovManagerAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_TOKEN_ACTION_GOV_MANAGER', requiredAddress(groupChat, 'tokenActionGovManagerAddress', 'group-chat/address.group.chat.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_GROUP_CHAT_TOKEN_ACTION_MAIN_MANAGER', requiredAddress(groupChat, 'tokenActionMainManagerAddress', 'group-chat/address.group.chat.params'));

  addSection(lines, 'Extension 地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_CENTER', requiredAddress(extension, 'centerAddress', 'extension/address.extension.center.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_LP_FACTORY', requiredAddress(extensionLp, 'lpFactoryAddress', 'extension-lp/address.extension.lp.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_LP_FACTORY_V2', requiredAddress(extensionLpV2, 'lpFactoryV2Address', 'extension-lp/address.extension.lp.v2.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_MANAGER', requiredAddress(extensionGroup, 'groupManagerAddress', 'extension-group/address.extension.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_JOIN', requiredAddress(extensionGroup, 'groupJoinAddress', 'extension-group/address.extension.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_VERIFY', requiredAddress(extensionGroup, 'groupVerifyAddress', 'extension-group/address.extension.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_ACTION_FACTORY', requiredAddress(extensionGroup, 'groupActionFactoryAddress', 'extension-group/address.extension.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_RECIPIENTS', requiredAddress(extensionGroup, 'groupRecipientsAddress', 'extension-group/address.extension.group.params'));
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_EXTENSION_GROUP_SERVICE_FACTORY', requiredAddress(extensionGroup, 'groupServiceFactoryAddress', 'extension-group/address.extension.group.params'));

  addSection(lines, '可选应用地址');
  addLine(lines, 'NEXT_PUBLIC_CONTRACT_ADDRESS_BATCH_TRANSFER', optionalAddress(batchTransfer, 'batchTransferAddress'));

  return `${lines.join('\n')}\n`;
}

export function writeEnvFile(graph, root = repoRoot) {
  const content = buildEnvContent(graph, root);
  const envPath = resolve(root, '../interface-test/.env.anvil');
  writeFileSync(envPath, content);
  return envPath;
}

export function applyEnvFile(root = repoRoot) {
  const sourcePath = resolve(root, '../interface-test/.env.anvil');
  const targetPath = resolve(root, '../interface-test/.env.local');
  if (!existsSync(sourcePath)) throw new Error(`Missing ${sourcePath}; run npm run env first.`);

  const source = readFileSync(sourcePath, 'utf8');
  if (existsSync(targetPath)) {
    const current = readFileSync(targetPath, 'utf8');
    if (current !== source) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(`${targetPath}.bak.${stamp}`, current);
    }
  }

  writeFileSync(targetPath, source);
  return targetPath;
}
