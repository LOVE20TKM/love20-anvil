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
  withPreservedExternalRepositories,
  writeState,
} from './lib.mjs';
import {
  applyEnvFile,
  writeEnvFile,
} from './env.mjs';
import {
  seedGroupChat,
} from './group-chat-seed.mjs';
import {
  integrationTargets,
  runIntegrationTest,
} from './integration.mjs';

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
  node src/cli.mjs integration TARGET [--revert-state]
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
  npm run integration -- burn
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
  if (args.command === 'seed' || args.command === 'integration') {
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
    } else if (arg === '--revert-state') {
      args.revertState = true;
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
    const statePath = await withPreservedExternalRepositories(
      graph,
      () => deployGraph(graph, deployer, args),
      repoRoot,
    );
    console.log(`\nAddresses written to ${statePath}`);
    return;
  }

  if (args.command === 'env') {
    const { envPath, statePath } = await withPreservedExternalRepositories(graph, () => {
      ensureAnvilFiles(graph, deployer, repoRoot);
      return {
        envPath: writeEnvFile(graph, repoRoot),
        statePath: writeState(graph, deployer, repoRoot),
      };
    }, repoRoot);
    console.log(`Generated ${envPath}`);
    console.log(`Addresses written to ${statePath}`);
    if (args.apply) {
      const targetPath = applyEnvFile(repoRoot);
      console.log(`Applied ${envPath} to ${targetPath}`);
    }
    return;
  }

  if (args.command === 'check') {
    const statePath = await withPreservedExternalRepositories(
      graph,
      () => checkGraph(graph, deployer, {
        root: repoRoot,
        runRepoChecks: !args.noRepoChecks,
      }),
      repoRoot,
    );
    console.log(`\nAll checks passed. Addresses written to ${statePath}`);
    return;
  }

  if (args.command === 'integration') {
    const targets = integrationTargets(graph);
    if (!args.target) {
      throw new Error(`integration requires a target. Available: ${targets.join(', ') || '(none)'}`);
    }
    await runIntegrationTest(graph, deployer, args.target, {
      revertState: args.revertState,
      root: repoRoot,
    });
    console.log(`\nIntegration test passed: ${args.target}${args.revertState ? ' (state reverted)' : ' (state kept)'}`);
    return;
  }

  if (args.command === 'seed') {
    if (!args.target) {
      throw new Error('seed requires a target. Supported target: group-chat');
    }
    if (args.target !== 'group-chat') {
      throw new Error(`Unknown seed target: ${args.target}`);
    }
    const statePath = await withPreservedExternalRepositories(graph, async () => {
      ensureAnvilFiles(graph, deployer, repoRoot);
      preflight(graph, deployer, { requireRpc: true, root: repoRoot });
      return seedGroupChat(graph, deployer, { root: repoRoot });
    }, repoRoot);
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
