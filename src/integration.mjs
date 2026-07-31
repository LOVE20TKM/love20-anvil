import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { anvilAccounts, CastRunner } from './anvil.mjs';
import {
  getNode,
  preflight,
  readStateNodeParams,
  repoRoot,
  validateNodeOutputFiles,
  validateStateNodeOutputs,
  writeStateNodeOutputs,
} from './lib.mjs';

function rpcValue(output) {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

export function integrationTargets(graph) {
  return graph.nodes.filter((node) => node.integrationTest).map((node) => node.id);
}

export function integrationNode(graph, target) {
  const node = getNode(graph, target);
  if (!node.integrationTest) {
    throw new Error(`No integration test configured for ${target}`);
  }
  return node;
}

export async function runIntegrationTest(graph, deployer, target, options = {}) {
  const root = options.root || repoRoot;
  const node = integrationNode(graph, target);
  const runner = options.runner || new CastRunner({ rpcUrl: graph.network.rpcUrl, root });

  if (options.preflight !== false) {
    preflight(graph, deployer, { requireRpc: true, root });
  }
  if (!node.integrationOwnsDeployment) validateStateNodeOutputs(graph, node, root);

  const snapshot = options.revertState
    ? rpcValue(runner.rpc('evm_snapshot', [], { stage: 'integration:snapshot' }))
    : undefined;
  let result;
  let testError;
  try {
    const moduleUrl = pathToFileURL(resolve(root, node.integrationTest));
    const scenario = await import(`${moduleUrl.href}?run=${Date.now()}`);
    if (typeof scenario.run !== 'function') {
      throw new Error(`${node.integrationTest} must export run(context)`);
    }

    result = await scenario.run({
      accounts: anvilAccounts,
      deployer,
      graph,
      node,
      params: (nodeId, file) => readStateNodeParams(graph, nodeId, file, root),
      root,
      runner,
    });
  } catch (error) {
    testError = error;
  } finally {
    if (snapshot !== undefined) {
      try {
        const reverted = rpcValue(runner.rpc('evm_revert', [snapshot], { stage: 'integration:revert' }));
        if (reverted !== true) throw new Error(`evm_revert returned ${reverted}`);
      } catch (revertError) {
        if (testError) {
          testError.message += `\nFailed to revert Anvil snapshot: ${revertError.message}`;
        } else {
          testError = revertError;
        }
      }
    }
  }

  if (testError) throw testError;
  if (node.integrationOwnsDeployment) {
    if (snapshot === undefined) {
      writeStateNodeOutputs(graph, node.id, result?.outputs, root);
    } else {
      validateNodeOutputFiles(node, result?.outputs);
    }
  }
  await result?.onSuccess?.();
}
