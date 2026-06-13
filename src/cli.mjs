#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  checkGraph,
  deployGraph,
  ensureAnvilFiles,
  loadDeployer,
  loadGraph,
  parseOptionList,
  preflight,
  repoRoot,
  selectNodes,
  writeState,
} from './lib.mjs';
import {
  applyEnvFile,
  writeEnvFile,
} from './env.mjs';
import {
  seedGroupChat,
} from './group-chat-seed.mjs';

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function usage() {
  console.log(`love20-anvil

命令：
  node src/cli.mjs deploy [--from NODE] [--to NODE] [--only NODE] [--skip NODE[,NODE]]
  node src/cli.mjs env [--apply]
  node src/cli.mjs check [--no-repo-checks]
  node src/cli.mjs seed group-chat

示例：
  npm run deploy
  npm run deploy -- --to group-chat
  npm run deploy -- --from group-chat
  npm run deploy -- --only group-chat
  npm run deploy -- --skip batch-transfer
  npm run env
  npm run env:apply
  npm run check
  npm run seed:group-chat`);
}

export function parseArgs(argv) {
  if (argv[0] === '-h' || argv[0] === '--help') {
    return { help: true, skip: [] };
  }

  const args = {
    command: argv[0],
    skip: [],
  };

  let optionStart = 1;
  if (args.command === 'seed') {
    args.target = argv[1]?.startsWith('-') ? undefined : argv[1];
    optionStart = args.target ? 2 : 1;
  }

  for (let index = optionStart; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from') {
      args.from = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--to') {
      args.to = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--only') {
      args.only = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--skip') {
      args.skip.push(...parseOptionList(readOptionValue(argv, index, arg)));
      index += 1;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--no-repo-checks') {
      args.noRepoChecks = true;
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.help) {
    usage();
    return;
  }

  const graph = loadGraph(repoRoot);
  const deployer = loadDeployer(repoRoot);

  if (args.command === 'deploy') {
    const selected = selectNodes(graph, args).map((node) => node.id);
    console.log(`Deploy nodes: ${selected.join(' -> ') || '(none)'}`);
    const statePath = deployGraph(graph, deployer, args);
    console.log(`\nAddresses written to ${statePath}`);
    return;
  }

  if (args.command === 'env') {
    ensureAnvilFiles(graph, deployer, repoRoot);
    const envPath = writeEnvFile(graph, repoRoot);
    const statePath = writeState(graph, deployer, repoRoot);
    console.log(`Generated ${envPath}`);
    console.log(`Addresses written to ${statePath}`);
    if (args.apply) {
      const targetPath = applyEnvFile(repoRoot);
      console.log(`Applied ${envPath} to ${targetPath}`);
    }
    return;
  }

  if (args.command === 'check') {
    const statePath = checkGraph(graph, deployer, {
      root: repoRoot,
      runRepoChecks: !args.noRepoChecks,
    });
    console.log(`\nAll checks passed. Addresses written to ${statePath}`);
    return;
  }

  if (args.command === 'seed') {
    if (!args.target) {
      throw new Error('seed requires a target. Supported target: group-chat');
    }
    if (args.target !== 'group-chat') {
      throw new Error(`Unknown seed target: ${args.target}`);
    }
    ensureAnvilFiles(graph, deployer, repoRoot);
    preflight(graph, deployer, { requireRpc: true, root: repoRoot });
    const statePath = await seedGroupChat(graph, deployer, { root: repoRoot });
    console.log(`\nGroupChat seed state written to ${statePath}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  });
}
