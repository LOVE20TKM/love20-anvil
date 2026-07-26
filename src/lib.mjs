import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, '..');
export const workspaceRoot = resolve(repoRoot, '..');
export const zeroAddress = '0x0000000000000000000000000000000000000000';
export const defaultKeystorePassword = 'anvil';

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function loadGraph(root = repoRoot) {
  return loadJson(join(root, 'config/deploy.graph.json'));
}

export function loadDeployer(root = repoRoot) {
  return loadJson(join(root, 'config/deployer.json'));
}

export function stripInlineComment(value) {
  let quote = null;
  let escaped = false;
  let output = '';

  for (const char of value) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote) {
      output += char;
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      output += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      output += char;
      continue;
    }

    if (char === '#' && !quote) {
      break;
    }

    output += char;
  }

  return output.trim();
}

export function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseParams(content) {
  const params = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = rawLine.indexOf('=');
    if (eqIndex < 1) continue;

    const key = rawLine.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    params[key] = unquote(stripInlineComment(rawLine.slice(eqIndex + 1)));
  }

  return params;
}

export function readParamsFile(absPath) {
  if (!existsSync(absPath)) return {};
  return parseParams(readFileSync(absPath, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setParamInContent(content, key, value) {
  const lines = content ? content.split(/\r?\n/) : [];
  const matcher = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=).*$`);
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.trim().startsWith('#')) return line;
    const match = line.match(matcher);
    if (!match) return line;
    replaced = true;
    return `${match[1]}${value}`;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${value}`);
  }

  return nextLines.join('\n').replace(/\n*$/, '\n');
}

export function formatParams(params) {
  return `${Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

export function writeParamsFile(absPath, params, { merge = true } = {}) {
  mkdirSync(dirname(absPath), { recursive: true });
  const current = merge && existsSync(absPath) ? readFileSync(absPath, 'utf8') : '';
  let next = merge ? current : formatParams(params);

  if (merge) {
    for (const [key, value] of Object.entries(params)) {
      next = setParamInContent(next, key, value);
    }
  }

  if (!existsSync(absPath) || readFileSync(absPath, 'utf8') !== next) {
    writeFileSync(absPath, next);
  }
}

export function isAddress(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function isNonZeroAddress(value) {
  return isAddress(value) && value.toLowerCase() !== zeroAddress.toLowerCase();
}

export function getNode(graph, id) {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown deploy node: ${id}`);
  return node;
}

export function selectNodes(graph, options = {}) {
  const scopedOptions = ['only', 'from', 'to'].filter((key) => options[key]);
  if (scopedOptions.length > 1) {
    throw new Error('Use only one of --only, --from, or --to.');
  }

  const skip = new Set(options.skip || []);
  for (const id of skip) {
    getNode(graph, id);
  }

  if (options.only) {
    getNode(graph, options.only);
    return graph.nodes.filter((node) => node.id === options.only && !skip.has(node.id));
  }

  let nodes = graph.nodes;
  if (options.from) {
    const index = graph.nodes.findIndex((node) => node.id === options.from);
    if (index < 0) throw new Error(`Unknown --from node: ${options.from}`);
    nodes = graph.nodes.slice(index);
  }
  if (options.to) {
    const index = graph.nodes.findIndex((node) => node.id === options.to);
    if (index < 0) throw new Error(`Unknown --to node: ${options.to}`);
    nodes = graph.nodes.slice(0, index + 1);
  }

  return nodes.filter((node) => !skip.has(node.id));
}

export function repoPathForNode(node, root = repoRoot) {
  return resolve(root, node.repo);
}

export function networkDirForNode(node, root = repoRoot) {
  return join(repoPathForNode(node, root), 'script/network/anvil');
}

export function paramsPathForNode(node, paramsFile, root = repoRoot) {
  return join(networkDirForNode(node, root), paramsFile);
}

function externalMutableDirectories(graph, root) {
  const repositories = [...new Set(graph.nodes.map((node) => repoPathForNode(node, root)))];
  return repositories.flatMap((repository) => [
    join(repository, 'script/network/anvil'),
    join(repository, 'out'),
    join(repository, 'cache'),
    join(repository, 'broadcast'),
  ]);
}

function snapshotExternalDirectories(graph, root) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'love20-anvil-workspace-'));
  const directories = externalMutableDirectories(graph, root);

  try {
    const entries = directories.map((path, index) => {
      const snapshotPath = join(tempRoot, String(index));
      const existed = existsSync(path);
      if (existed) cpSync(path, snapshotPath, { recursive: true, preserveTimestamps: true });
      return { existed, path, snapshotPath };
    });
    return { entries, tempRoot };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function restoreExternalDirectories(snapshot) {
  const errors = [];
  for (const entry of snapshot.entries) {
    try {
      rmSync(entry.path, { recursive: true, force: true });
      if (!entry.existed) continue;
      mkdirSync(dirname(entry.path), { recursive: true });
      cpSync(entry.snapshotPath, entry.path, { recursive: true, preserveTimestamps: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Failed to restore external repository files; backup kept at ${snapshot.tempRoot}`,
    );
  }
  rmSync(snapshot.tempRoot, { recursive: true, force: true });
}

export function hydrateAnvilFilesFromState(graph, root = repoRoot) {
  const statePath = join(root, 'state/addresses.json');
  if (!existsSync(statePath)) return [];

  const state = loadJson(statePath);
  const hydrated = [];
  for (const node of graph.nodes) {
    const files = state.nodes?.[node.id]?.files || {};
    for (const output of node.outputFiles || []) {
      const params = files[output.path];
      if (!params) continue;
      const path = paramsPathForNode(node, output.path, root);
      writeParamsFile(path, params, { merge: false });
      hydrated.push(path);
    }
  }
  return hydrated;
}

export async function withPreservedExternalRepositories(graph, operation, root = repoRoot) {
  const snapshot = snapshotExternalDirectories(graph, root);
  let restored = false;
  let result;
  let operationError;
  const restore = () => {
    if (restored) return;
    restoreExternalDirectories(snapshot);
    restored = true;
  };
  const handleSignal = (signal, exitCode) => {
    try {
      restore();
      process.exit(exitCode);
    } catch (error) {
      console.error(`Failed to restore external repositories after ${signal}: ${error.message}`);
      process.exit(1);
    }
  };
  const signalHandlers = new Map([
    ['SIGINT', () => handleSignal('SIGINT', 130)],
    ['SIGTERM', () => handleSignal('SIGTERM', 143)],
  ]);
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  try {
    hydrateAnvilFilesFromState(graph, root);
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  try {
    restore();
  } catch (restoreError) {
    if (operationError) {
      throw new AggregateError([operationError, restoreError], 'Command and Anvil file restoration both failed');
    }
    throw restoreError;
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }

  if (operationError) throw operationError;
  return result;
}

function accountFileMatchesDeployer(accountFile, deployer) {
  const params = readParamsFile(accountFile);
  return (
    params.KEYSTORE_ACCOUNT === deployer.keystoreAccount
    && lower(params.ACCOUNT_ADDRESS) === lower(deployer.accountAddress)
  );
}

export function ensureAccountFile(node, deployer, root = repoRoot) {
  const accountFile = join(networkDirForNode(node, root), '.account');
  if (node.usesDefaultKeystore && existsSync(accountFile) && accountFileMatchesDeployer(accountFile, deployer)) {
    return;
  }

  const content = [
    `PRIVATE_KEY=${deployer.privateKey}`,
    '#ETHERSCAN_API_KEY=0x # anvil 不需要 etherscan',
    '',
    `KEYSTORE_ACCOUNT=${deployer.keystoreAccount}`,
    `ACCOUNT_ADDRESS=${deployer.accountAddress}`,
    '',
  ].join('\n');

  mkdirSync(dirname(accountFile), { recursive: true });
  if (!existsSync(accountFile) || readFileSync(accountFile, 'utf8') !== content) {
    writeFileSync(accountFile, content);
  }
}

export function ensureNetworkParams(node, graph, root = repoRoot) {
  if (node.preserveNetworkParams) return;

  const networkParams = {
    CHAIN_ID: graph.network.chainId,
    SECONDS_PER_BLOCK: graph.network.secondsPerBlock,
    RPC_URL: graph.network.rpcUrl,
  };
  writeParamsFile(join(networkDirForNode(node, root), 'network.params'), networkParams);
}

export function ensureEmptyOutputFiles(node, root = repoRoot) {
  for (const output of node.outputFiles || []) {
    const absPath = paramsPathForNode(node, output.path, root);
    mkdirSync(dirname(absPath), { recursive: true });
    if (!existsSync(absPath)) writeFileSync(absPath, '');
  }
}

export function ensureAnvilFiles(graph, deployer, root = repoRoot) {
  for (const node of graph.nodes) {
    const repoPath = repoPathForNode(node, root);
    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found for ${node.id}: ${repoPath}`);
    }
    mkdirSync(networkDirForNode(node, root), { recursive: true });
    ensureAccountFile(node, deployer, root);
    ensureNetworkParams(node, graph, root);
    ensureEmptyOutputFiles(node, root);
  }
}

export function readNodeParams(graph, nodeId, paramsFile, root = repoRoot) {
  return readParamsFile(paramsPathForNode(getNode(graph, nodeId), paramsFile, root));
}

function copyParamsFile(sourcePath, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  if (sourcePath === targetPath) return;
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing upstream params file: ${sourcePath}`);
  }
  copyFileSync(sourcePath, targetPath);
}

export function prepareNodeInputs(graph, node, root = repoRoot) {
  for (const sync of node.sync || []) {
    const sourceNode = getNode(graph, sync.from);
    copyParamsFile(
      paramsPathForNode(sourceNode, sync.source, root),
      paramsPathForNode(node, sync.target, root),
    );
  }

  for (const prefill of node.prefill || []) {
    const values = { ...(prefill.values || {}) };

    for (const [targetKey, source] of Object.entries(prefill.valuesFrom || {})) {
      const params = readNodeParams(graph, source.from, source.source, root);
      const value = params[source.key];
      if (!value) {
        throw new Error(
          `Missing upstream value ${source.from}/${source.source}:${source.key} for ${node.id}/${prefill.target}:${targetKey}`,
        );
      }
      values[targetKey] = value;
    }

    for (const [targetKey, sources] of Object.entries(prefill.valuesFromList || {})) {
      values[targetKey] = sources.map((source) => {
        const params = readNodeParams(graph, source.from, source.source, root);
        const value = params[source.key];
        if (!value) {
          throw new Error(
            `Missing upstream value ${source.from}/${source.source}:${source.key} for ${node.id}/${prefill.target}:${targetKey}`,
          );
        }
        return value;
      }).join(',');
    }

    writeParamsFile(paramsPathForNode(node, prefill.target, root), values);
  }
}

function validateRequiredNodeOutputs(node, readOutput, label = '') {
  const errors = [];
  for (const output of node.outputFiles || []) {
    const params = readOutput(output);
    const outputLabel = `${label}${output.path}`;
    if (params === undefined) {
      errors.push(`${node.id}: missing ${outputLabel}`);
      continue;
    }
    for (const key of output.requiredKeys || []) {
      if (!params[key]) {
        errors.push(`${node.id}: missing ${outputLabel}:${key}`);
      } else if (!isNonZeroAddress(params[key])) {
        errors.push(`${node.id}: ${outputLabel}:${key} is not a non-zero address: ${params[key]}`);
      }
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function validateNodeOutputs(graph, node, root = repoRoot) {
  validateRequiredNodeOutputs(node, (output) => {
    const path = paramsPathForNode(node, output.path, root);
    return existsSync(path) ? readParamsFile(path) : undefined;
  });
}

export function readStateNodeParams(graph, nodeId, paramsFile, root = repoRoot) {
  getNode(graph, nodeId);
  const statePath = join(root, 'state/addresses.json');
  if (!existsSync(statePath)) {
    throw new Error(`Missing deployment state: ${statePath}; run npm run deploy first.`);
  }
  const state = loadJson(statePath);
  return state.nodes?.[nodeId]?.files?.[paramsFile] || {};
}

export function validateStateNodeOutputs(graph, node, root = repoRoot) {
  validateRequiredNodeOutputs(
    node,
    (output) => readStateNodeParams(graph, node.id, output.path, root),
    'state ',
  );
}

export function validateAllOutputs(graph, root = repoRoot) {
  for (const node of graph.nodes) {
    validateNodeOutputs(graph, node, root);
  }
}

export function resetNodesForDeploy(graph, options = {}) {
  return selectNodes(graph, options);
}

function nodeDependsOn(node, upstreamId) {
  if ((node.sync || []).some((sync) => sync.from === upstreamId)) return true;

  for (const prefill of node.prefill || []) {
    if (Object.values(prefill.valuesFrom || {}).some((source) => source.from === upstreamId)) {
      return true;
    }
    if (Object.values(prefill.valuesFromList || {}).flat().some((source) => source.from === upstreamId)) {
      return true;
    }
  }

  return false;
}

export function invalidatedNodesForDeploy(graph, options = {}) {
  const selected = resetNodesForDeploy(graph, options);
  if (selected.length === 0) return [];

  const skippedIds = new Set(options.skip || []);
  const invalidatedIds = new Set(selected.map((node) => node.id));
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (skippedIds.has(node.id)) continue;
      if (invalidatedIds.has(node.id)) continue;
      if (![...invalidatedIds].some((id) => nodeDependsOn(node, id))) continue;
      invalidatedIds.add(node.id);
      changed = true;
    }
  }

  return graph.nodes.filter((node) => invalidatedIds.has(node.id) && !skippedIds.has(node.id));
}

export function clearNodeOutputFiles(node, root = repoRoot) {
  const cleared = [];

  for (const output of node.outputFiles || []) {
    const absPath = paramsPathForNode(node, output.path, root);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, '');
    cleared.push(absPath);
  }

  return cleared;
}

export function clearDeployState(root = repoRoot) {
  const statePath = join(root, 'state/addresses.json');
  rmSync(statePath, { force: true });
  return statePath;
}

export function clearGroupChatSeedState(root = repoRoot) {
  const statePath = join(root, 'state/group-chat-seed.json');
  rmSync(statePath, { force: true });
  return statePath;
}

export function deployAffectsGroupChatSeed(nodes) {
  const dependencyIds = new Set([
    'core',
    'group',
    'group-defaults',
    'group-delegate',
    'extension',
    'extension-group',
    'group-chat',
  ]);
  return nodes.some((node) => dependencyIds.has(node.id));
}

export function resetAnvilDeployOutputs(graph, options = {}, root = repoRoot) {
  const nodes = resetNodesForDeploy(graph, options);
  const invalidatedNodes = invalidatedNodesForDeploy(graph, options);
  const cleared = {
    outputFiles: [],
    foundryArtifacts: [],
    stateFiles: [clearDeployState(root)],
  };

  for (const node of invalidatedNodes) {
    cleared.outputFiles.push(...clearNodeOutputFiles(node, root));
    cleared.foundryArtifacts.push(...clearAnvilFoundryArtifacts(node, root));
  }

  if (deployAffectsGroupChatSeed(nodes)) {
    cleared.stateFiles.push(clearGroupChatSeedState(root));
  }

  return cleared;
}

export function collectAddresses(graph, root = repoRoot) {
  const nodes = {};

  for (const node of graph.nodes) {
    const files = {};
    for (const output of node.outputFiles || []) {
      const absPath = paramsPathForNode(node, output.path, root);
      if (existsSync(absPath)) {
        files[output.path] = readParamsFile(absPath);
      }
    }
    nodes[node.id] = {
      repo: node.repo,
      files,
    };
  }

  return nodes;
}

export function writeState(graph, deployer, root = repoRoot) {
  const state = {
    generatedAt: new Date().toISOString(),
    network: graph.network,
    deployer: {
      accountAddress: deployer.accountAddress,
      keystoreAccount: deployer.keystoreAccount,
    },
    nodes: collectAddresses(graph, root),
  };
  const statePath = join(root, 'state/addresses.json');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return statePath;
}

export function runCommand(command, cwd, env = {}, { input } = {}) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'signal'}): ${command}`);
  }
}

function runCapture(command, cwd = repoRoot, env = {}) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function anvilKeystoreHome(root = repoRoot) {
  return join(root, '.home');
}

function deployerKeystorePassword(deployer) {
  return deployer.keystorePassword || defaultKeystorePassword;
}

function anvilKeystoreEnv(deployer, root = repoRoot) {
  return {
    HOME: anvilKeystoreHome(root),
    CAST_UNSAFE_PASSWORD: deployerKeystorePassword(deployer),
  };
}

function realHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function linkDirectory(sourcePath, targetPath) {
  if (!sourcePath || !existsSync(sourcePath)) return false;

  if (existsSync(targetPath)) {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) return true;
    rmSync(targetPath, { recursive: true, force: true });
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  symlinkSync(sourcePath, targetPath, 'dir');
  return true;
}

export function ensureSharedToolCaches(home = anvilKeystoreHome()) {
  const sourceHome = realHomeDir();
  if (!sourceHome || resolve(sourceHome) === resolve(home)) return [];

  const linked = [];
  const svmSource = join(sourceHome, 'Library', 'Application Support', 'svm');

  const candidates = [
    [join(sourceHome, '.solc-select'), join(home, '.solc-select')],
    [svmSource, join(home, 'Library', 'Application Support', 'svm')],
    [existsSync(join(sourceHome, '.svm')) ? join(sourceHome, '.svm') : svmSource, join(home, '.svm')],
  ];

  for (const [sourcePath, targetPath] of candidates) {
    if (linkDirectory(sourcePath, targetPath)) linked.push(targetPath);
  }

  return linked;
}

function parsePrivateKeyFromDecryptOutput(output) {
  const match = output.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : '';
}

export function ensureAnvilKeystore(deployer, root = repoRoot) {
  const password = deployerKeystorePassword(deployer);
  if (!password) throw new Error('Missing deployer.keystorePassword');
  if (!deployer.keystoreAccount) throw new Error('Missing deployer.keystoreAccount');
  if (!deployer.privateKey) throw new Error('Missing deployer.privateKey');

  const home = anvilKeystoreHome(root);
  const keystorePath = join(home, '.foundry', 'keystores', deployer.keystoreAccount);
  ensureSharedToolCaches(home);
  mkdirSync(dirname(keystorePath), { recursive: true });

  const env = anvilKeystoreEnv(deployer, root);
  const decrypt = runCapture(
    `cast wallet decrypt-keystore "${deployer.keystoreAccount}" --unsafe-password "${password}"`,
    root,
    env,
  );

  if (decrypt.ok) {
    const existingPrivateKey = parsePrivateKeyFromDecryptOutput(decrypt.stdout);
    if (lower(existingPrivateKey) !== lower(deployer.privateKey)) {
      throw new Error(
        `Anvil keystore ${keystorePath} does not match config/deployer.json privateKey`,
      );
    }
    return keystorePath;
  }

  if (existsSync(keystorePath)) {
    throw new Error(
      `Existing anvil keystore cannot be decrypted with config/deployer.json keystorePassword: ${keystorePath}`,
    );
  }

  const imported = spawnSync(
    'cast',
    [
      'wallet',
      'import',
      deployer.keystoreAccount,
      '--private-key',
      deployer.privateKey,
      '--unsafe-password',
      password,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (imported.status !== 0) {
    throw new Error(
      `Failed to create anvil keystore (${imported.status ?? 'signal'}): ${imported.stderr.trim() || imported.stdout.trim()}`,
    );
  }

  return keystorePath;
}

function nodeCommandOptions(node, deployer, root) {
  if (!node.usesDefaultKeystore) return { env: {}, input: undefined };

  ensureAnvilKeystore(deployer, root);
  const password = deployerKeystorePassword(deployer);
  return {
    env: anvilKeystoreEnv(deployer, root),
    input: `${password}\n`,
  };
}

function nodeCommandEnv(node, deployer, root) {
  if (!node.usesDefaultKeystore) return {};
  ensureAnvilKeystore(deployer, root);
  return anvilKeystoreEnv(deployer, root);
}

function anvilFoundryEnv(node, root) {
  return {
    ANVIL_FOUNDRY_OUT: join(root, '.foundry', node.id, 'out'),
    ANVIL_FOUNDRY_CACHE: join(root, '.foundry', node.id, 'cache'),
  };
}

export function clearAnvilFoundryArtifacts(node, root = repoRoot) {
  const env = anvilFoundryEnv(node, root);
  const paths = [env.ANVIL_FOUNDRY_OUT, env.ANVIL_FOUNDRY_CACHE];

  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }

  return paths;
}

export function syncMirroredFoundryArtifacts(node, root = repoRoot) {
  if (!node.mirrorFoundryArtifacts) return [];

  const copied = [];
  for (const dirName of ['out']) {
    const sourcePath = join(repoPathForNode(node, root), dirName);
    const targetPath = join(root, '.foundry', node.id, dirName);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing Foundry ${dirName} directory for ${node.id}: ${sourcePath}`);
    }

    rmSync(targetPath, { recursive: true, force: true });
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
    copied.push(targetPath);
  }

  return copied;
}

export function commandExists(command) {
  return runCapture(`command -v ${command}`).ok;
}

export function preflight(graph, deployer, { requireRpc = false, root = repoRoot } = {}) {
  const missingTools = ['forge', 'cast'].filter((tool) => !commandExists(tool));
  if (missingTools.length > 0) {
    throw new Error(`Missing Foundry tool(s): ${missingTools.join(', ')}`);
  }

  for (const node of graph.nodes) {
    const repoPath = repoPathForNode(node, root);
    if (!existsSync(repoPath)) throw new Error(`Repository not found for ${node.id}: ${repoPath}`);
  }

  if (!requireRpc) return;

  const chainId = runCapture(`cast chain-id --rpc-url ${graph.network.rpcUrl}`).stdout;
  if (!chainId) throw new Error(`Anvil RPC is not reachable: ${graph.network.rpcUrl}`);
  if (chainId !== graph.network.chainId) {
    throw new Error(`Anvil chain id mismatch. Expected ${graph.network.chainId}, got ${chainId}`);
  }

  const balanceText = runCapture(`cast balance ${deployer.accountAddress} --rpc-url ${graph.network.rpcUrl}`).stdout;
  if (!balanceText) throw new Error(`Failed to read deployer balance: ${deployer.accountAddress}`);
  const balance = BigInt(balanceText.split(/\s+/)[0]);
  if (balance <= 0n) throw new Error(`Deployer has no balance on anvil: ${deployer.accountAddress}`);
}

export function deployGraph(graph, deployer, options = {}) {
  const root = options.root || repoRoot;

  preflight(graph, deployer, { requireRpc: true, root });
  ensureAnvilFiles(graph, deployer, root);

  const nodes = selectNodes(graph, options);
  resetAnvilDeployOutputs(graph, options, root);
  for (const node of nodes) {
    console.log(`\n=== Deploy ${node.id} ===`);
    deployNode(graph, deployer, node, { root });
    writeState(graph, deployer, root);
  }

  return writeState(graph, deployer, root);
}

export function deployNode(graph, deployer, node, { root = repoRoot, prepareInputs = true } = {}) {
  if (prepareInputs) prepareNodeInputs(graph, node, root);
  const env = {
    network: 'anvil',
    ACCOUNT_ADDRESS: deployer.accountAddress,
    KEYSTORE_ACCOUNT: deployer.keystoreAccount,
    KEYSTORE_PASSWORD_ACCOUNT: deployer.keystoreAccount,
    KEYSTORE_PASSWORD: '',
    PRIVATE_KEY: deployer.privateKey,
    ...nodeCommandEnv(node, deployer, root),
    ...anvilFoundryEnv(node, root),
  };
  if (node.preDeployCommand) {
    runCommand(node.preDeployCommand, repoPathForNode(node, root), env);
  }
  const commandOptions = nodeCommandOptions(node, deployer, root);
  runCommand(node.deployCommand, repoPathForNode(node, root), {
    ...env,
    ...commandOptions.env,
  }, { input: commandOptions.input });
  syncMirroredFoundryArtifacts(node, root);
  validateNodeOutputs(graph, node, root);
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function pushConsistencyIssue(issues, label, expected, actual) {
  if (lower(expected) !== lower(actual)) {
    issues.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

export function checkCrossRepoConsistency(graph, deployer, root = repoRoot) {
  const issues = [];

  for (const node of graph.nodes) {
    const account = readParamsFile(join(networkDirForNode(node, root), '.account'));
    pushConsistencyIssue(issues, `${node.id} ACCOUNT_ADDRESS`, deployer.accountAddress, account.ACCOUNT_ADDRESS);
    pushConsistencyIssue(issues, `${node.id} PRIVATE_KEY`, deployer.privateKey, account.PRIVATE_KEY);
  }

  const core = readNodeParams(graph, 'core', 'address.params', root);
  const peripheryCore = readNodeParams(graph, 'periphery', 'address.core.params', root);
  for (const key of Object.keys(core)) {
    if (isAddress(core[key]) && peripheryCore[key]) {
      pushConsistencyIssue(issues, `periphery/address.core.params ${key}`, core[key], peripheryCore[key]);
    }
  }

  const groupParams = readParamsFile(paramsPathForNode(getNode(graph, 'group'), 'group.params', root));
  pushConsistencyIssue(issues, 'group/group.params LOVE20_TOKEN_ADDRESS', core.firstTokenAddress, groupParams.LOVE20_TOKEN_ADDRESS);

  const extension = readNodeParams(graph, 'extension', 'address.extension.center.params', root);
  const extensionLpCenter = readNodeParams(graph, 'extension-lp', 'address.extension.center.params', root);
  const extensionGroupCenter = readNodeParams(graph, 'extension-group', 'address.extension.center.params', root);
  pushConsistencyIssue(issues, 'extension-lp centerAddress', extension.centerAddress, extensionLpCenter.centerAddress);
  pushConsistencyIssue(issues, 'extension-group centerAddress', extension.centerAddress, extensionGroupCenter.centerAddress);

  const burnConfig = readParamsFile(paramsPathForNode(getNode(graph, 'burn'), 'burn.params', root));
  pushConsistencyIssue(issues, 'burn EXTENSION_CENTER', extension.centerAddress, burnConfig.EXTENSION_CENTER);
  pushConsistencyIssue(issues, 'burn SCOPE_TOKEN', core.firstTokenAddress, burnConfig.SCOPE_TOKEN);
  pushConsistencyIssue(issues, 'burn COMMUNITY_TOKENS', core.firstTokenAddress, burnConfig.COMMUNITY_TOKENS);
  pushConsistencyIssue(issues, 'burn AIRDROP_TOKEN', core.rootParentTokenAddress, burnConfig.AIRDROP_TOKEN);

  const group = readNodeParams(graph, 'group', 'address.group.params', root);
  const extensionGroupGroup = readNodeParams(graph, 'extension-group', 'address.group.params', root);
  pushConsistencyIssue(issues, 'extension-group groupAddress', group.groupAddress, extensionGroupGroup.groupAddress);

  const groupChatGroup = readNodeParams(graph, 'group-chat', 'address.group.params', root);
  const groupChatDefaults = readNodeParams(graph, 'group-chat', 'address.group.defaults.params', root);
  const groupChatDelegate = readNodeParams(graph, 'group-chat', 'address.group.delegate.params', root);
  const groupChatConfig = readParamsFile(paramsPathForNode(getNode(graph, 'group-chat'), 'group.chat.params', root));
  const groupDefaults = readNodeParams(graph, 'group-defaults', 'address.group.defaults.params', root);
  const groupDelegate = readNodeParams(graph, 'group-delegate', 'address.group.delegate.params', root);
  const extensionGroup = readNodeParams(graph, 'extension-group', 'address.extension.group.params', root);
  pushConsistencyIssue(issues, 'group-chat groupAddress', group.groupAddress, groupChatGroup.groupAddress);
  pushConsistencyIssue(issues, 'group-chat groupDefaultsAddress', groupDefaults.groupDefaultsAddress, groupChatDefaults.groupDefaultsAddress);
  pushConsistencyIssue(issues, 'group-chat groupDelegateAddress', groupDelegate.groupDelegateAddress, groupChatDelegate.groupDelegateAddress);
  pushConsistencyIssue(issues, 'group-chat extensionCenterAddress', extension.centerAddress, groupChatConfig.extensionCenterAddress);
  pushConsistencyIssue(issues, 'group-chat groupJoinAddress', extensionGroup.groupJoinAddress, groupChatConfig.groupJoinAddress);

  return issues;
}

export function listOutputAddresses(graph, root = repoRoot) {
  const addresses = [];
  for (const node of graph.nodes) {
    for (const output of node.outputFiles || []) {
      const params = readParamsFile(paramsPathForNode(node, output.path, root));
      for (const [key, value] of Object.entries(params)) {
        if (isNonZeroAddress(value)) {
          addresses.push({ node: node.id, file: output.path, key, address: value });
        }
      }
    }
  }
  return addresses;
}

export function checkCodeExists(graph, root = repoRoot) {
  const issues = [];

  for (const item of listOutputAddresses(graph, root)) {
    const result = runCapture(`cast code ${item.address} --rpc-url ${graph.network.rpcUrl}`, root);
    if (!result.ok || !result.stdout || result.stdout === '0x') {
      issues.push(`${item.node}/${item.file}:${item.key} has no code at ${item.address}`);
    }
  }

  return issues;
}

export function runNodeCheckCommands(graph, deployer, root = repoRoot) {
  ensureAnvilFiles(graph, deployer, root);
  for (const node of graph.nodes) {
    if (!node.checkCommand) continue;
    console.log(`\n=== Check ${node.id} ===`);
    prepareNodeInputs(graph, node, root);
    const commandOptions = nodeCommandOptions(node, deployer, root);
    runCommand(node.checkCommand, repoPathForNode(node, root), {
      network: 'anvil',
      ACCOUNT_ADDRESS: deployer.accountAddress,
      KEYSTORE_ACCOUNT: deployer.keystoreAccount,
      KEYSTORE_PASSWORD_ACCOUNT: deployer.keystoreAccount,
      KEYSTORE_PASSWORD: '',
      PRIVATE_KEY: deployer.privateKey,
      ...commandOptions.env,
      ...anvilFoundryEnv(node, root),
    }, { input: commandOptions.input });
    syncMirroredFoundryArtifacts(node, root);
  }
}

function prepareGraphInputs(graph, root = repoRoot) {
  for (const node of graph.nodes) {
    prepareNodeInputs(graph, node, root);
  }
}

export function checkGraph(graph, deployer, { root = repoRoot, runRepoChecks = true } = {}) {
  preflight(graph, deployer, { requireRpc: true, root });
  ensureAnvilFiles(graph, deployer, root);
  prepareGraphInputs(graph, root);
  validateAllOutputs(graph, root);

  const codeIssues = checkCodeExists(graph, root);
  if (codeIssues.length > 0) {
    throw new Error(codeIssues.join('\n'));
  }

  if (runRepoChecks) runNodeCheckCommands(graph, deployer, root);

  const issues = [
    ...checkCrossRepoConsistency(graph, deployer, root),
  ];

  if (issues.length > 0) {
    throw new Error(issues.join('\n'));
  }

  return writeState(graph, deployer, root);
}

export function parseOptionList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
