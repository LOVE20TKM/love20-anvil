#!/usr/bin/env node

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

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function usage() {
  console.log(`love20-anvil

Commands:
  node src/cli.mjs deploy [--from NODE] [--to NODE] [--only NODE] [--skip NODE[,NODE]] [--force]
  node src/cli.mjs env [--apply]
  node src/cli.mjs check [--no-repo-checks]

Examples:
  npm run deploy
  npm run deploy -- --to group-chat
  npm run deploy -- --from group-chat
  npm run deploy -- --only group-chat
  npm run deploy -- --skip batch-transfer
  npm run env
  npm run env:apply
  npm run check`);
}

function parseArgs(argv) {
  if (argv[0] === '-h' || argv[0] === '--help') {
    return { help: true, skip: [] };
  }

  const args = {
    command: argv[0],
    skip: [],
  };

  for (let index = 1; index < argv.length; index += 1) {
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
    } else if (arg === '--force') {
      args.force = true;
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
    preflight(graph, deployer, { requireRpc: true, root: repoRoot });
    const statePath = checkGraph(graph, deployer, {
      root: repoRoot,
      runRepoChecks: !args.noRepoChecks,
    });
    console.log(`\nAll checks passed. Addresses written to ${statePath}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
