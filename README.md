# love20-anvil

用于 LOVE20 集成测试的本地 Anvil 部署与测试编排器。

这个仓库不复制各合约仓库里的 Solidity 部署逻辑。它从相反的前提出发：本地 Anvil 部署也调用各仓库自己的部署脚本。这样一次本地部署成功，也等于回归验证了未来 `public_test` 和 `public` 部署会依赖的同一条代码路径。

## 范围

V1 只编排已经具备 public-test 风格部署路径的仓库和合约：

```text
core -> periphery -> extension -> extension-lp -> group -> group-defaults -> group-delegate -> extension-group -> burn -> group-chat -> batch-transfer
```

旧版 `chat` 仓库不在默认部署图里。

## 命令

启动本地链：

```bash
npm run anvil:start
```

部署完整部署图：

```bash
npm run deploy
```

部署到某个节点为止，包括该节点依赖：

```bash
npm run deploy -- --to group-chat
```

从某个节点开始向后部署：

```bash
npm run deploy -- --from group-chat
```

只部署某个节点，并复用已有上游 Anvil 地址文件：

```bash
npm run deploy -- --only group-chat
```

跳过某个节点：

```bash
npm run deploy -- --skip batch-transfer
```

生成前端环境变量文件：

```bash
npm run env
```

生成并应用到 `../interface-test/.env.local`：

```bash
npm run env:apply
```

运行各仓库检查和集中跨仓库检查：

```bash
npm run check
```

运行某个代码库的真实链集成测试：

```bash
npm run deploy -- --to <node>
npm run integration -- <node>
```

集成测试直接调用部署在 Anvil 上的合约。运行器会在测试前创建 `evm_snapshot`，并在成功或失败后回滚，保证场景可重复运行。排错时可以保留测试后的链状态：

```bash
npm run integration -- <node> --keep-state
```

每个场景的前置条件、覆盖范围和验收标准由同名文档维护：

- [Burn 集成测试](integration/burn.md)

初始化已部署的 `group-chat` 测试环境：

```bash
npm run deploy -- --to group-chat
npm run seed:group-chat
```

初始化命令会直接使用 Anvil 默认 10 个私钥，并把执行结果写入 `state/group-chat-seed.json` 方便排错。它会创建 first token 余额、治理质押、基础行动和链群行动、typed manager 群聊、链群服务者群聊，以及覆盖正常发言、范围拒绝、禁言拒绝路径的样本消息。

这里的 `seed` 是“给已部署本地链播入一组确定性测试状态”的意思。`deploy` 写入合约代码；`seed` 写入测试需要的账号状态、余额、质押、行动、群、聊天权限、禁言和样本消息。

`seed:group-chat` 面向 fresh Anvil 流程：启动新的 Anvil，部署到 `group-chat`，再执行 seed。`state/group-chat-seed.json` 不是恢复点，也不会让脚本跳过执行；如果需要重新测试，请重启 Anvil 后重新部署和 seed。

初始化脚本使用的 Anvil 默认账号：

| 账号 | 角色 | 地址 | 私钥 |
| --- | --- | --- | --- |
| account0 | 部署者 / 启动账号 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| account1 | 公平发射 / 治理 / 投票 / 发言账号 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| account2 | 公平发射 / 治理 / 投票 / 发言账号 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| account3 | 公平发射 / 治理 / 投票 / 发言账号 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| account4 | 公平发射 / 治理 / 投票 / 发言账号 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |
| account5 | 公平发射 / 治理 / 投票 / 发言账号 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |
| account6 | 公平发射 / 治理 / 投票 / 发言账号 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` |
| account7 | 链群服务者 | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` | `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356` |
| account8 | 链群行动参与者 | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` | `0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97` |
| account9 | 负向样本账号 | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | `0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6` |

这些私钥是公开的 Foundry/Anvil 默认私钥，只能用于本地开发链。

## 部署账号

所有节点使用同一个 Anvil 部署账号：

```text
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

私钥是第一个 Anvil 默认私钥，保存在 `config/deployer.json`。编排器会根据这份配置写入各仓库的 `script/network/anvil/.account`。它只会修改 `anvil` 网络目录，不会更新 `public_test` 或 `public` 网络文件。

`core` 仓库继续使用它原有的 Foundry `--account` 部署路径。为了不改 `core`，编排器会在 `love20-anvil/.home/.foundry/keystores` 下创建隔离的 Foundry keystore，把真实用户 `HOME` 里的编译缓存链接进来，然后用这个私有 `HOME` 执行 core 命令，并把配置里的 `keystorePassword` 输入给原有密码提示。core 部署前也会先执行 `forge clean`，避免旧生成产物指向已经删除的源码文件。由于 core 不接受 Anvil 专用的 Foundry 输出环境变量，core 部署和检查命令结束后，会把它的 `out/` 产物镜像回 `love20-anvil/.foundry/core/out`。

## 输出

- 各仓库的 Anvil 地址由原部署脚本写入各自的 `script/network/anvil/address*.params`。
- 编排器会把这些输出汇总到 `state/addresses.json`。
- Anvil 运行使用的 Foundry 产物会隔离或镜像到 `.foundry/<node>/out`。
- 前端配置会生成到 `../interface-test/.env.anvil`，其中 ABI 路径指向这些隔离的 Anvil 产物。
- `npm run env:apply` 替换 `../interface-test/.env.local` 前会先备份原文件。

每次 `npm run deploy` 都会先清空本次部署会使其失效的 Anvil 部署输出文件和 `.foundry/<node>/out`、`.foundry/<node>/cache`，再调用原仓库部署脚本。清空的原因不是为了改变最终地址文件，而是为了让失败更早暴露：如果脚本没有重新写出必需地址，部署后的校验会看到空输出，而不是误读上一次 Anvil 留下的旧地址。

`--from`、`--to`、`--only`、`--skip` 会共同决定本次执行部署的节点；清理范围是本次会执行的节点，以及通过 `sync` 或 `prefill.valuesFrom` 依赖这些节点的下游节点。原因是下游地址通常绑定上游依赖，一旦上游重部署，下游旧地址即使链上仍有 code，也不再代表当前部署图。无依赖节点和显式跳过的节点会保留原地址文件。每次部署会删除并重写 `state/addresses.json`。如果本次选中节点会影响 `group-chat` seed 的输入，包括 `core`、`group`、`group-defaults`、`group-delegate`、`extension`、`extension-group`、`group-chat`，编排器还会删除 `state/group-chat-seed.json`，避免部署地址变化后复用旧 seed 状态。

## 添加合约

在拥有该合约的最窄层添加部署：

1. 新增或更新合约仓库自己的部署脚本，通常位于 `script/deploy`。
2. 让该脚本把部署地址写入 `script/network/anvil/address*.params`。
3. 如果下游节点需要这个地址，在 `config/deploy.graph.json` 里添加 `sync` 或 `prefill`。
4. 把地址 key 加到该节点的 `outputFiles.requiredKeys`。
5. 如果前端需要这个地址，在 `src/env.mjs` 里添加环境变量绑定。
6. 先运行 `npm run deploy -- --to <node>` 验证该节点及其依赖；需要全图校验或生成完整前端环境时，再补齐后续节点并运行 `npm run check`、`npm run env`。

## 添加集成测试

1. 在 `integration/<node>.mjs` 导出 `run(context)`。
2. 在 `integration/<node>.md` 记录前置条件、覆盖范围、失败路径和验收标准。
3. 在部署图对应节点配置 `"integrationTest": "integration/<node>.mjs"`。
4. 场景通过 `context.params(nodeId, file)` 读取本次部署地址，通过 `context.runner.call/send/rpc` 操作真实 Anvil 合约。
5. 运行 `npm run integration -- <node>`。链快照和回滚由运行器统一处理，场景不用自行清理状态。

## 设计规则

- 部署 DAG 固定在 `config/deploy.graph.json`。
- 编排器会预检查 Foundry 工具、RPC chain id、部署账号余额和仓库路径。
- 每次部署前，上游地址文件会复制到下游 Anvil 网络目录。
- 每次部署都会重新执行选中节点，不再提供 `--force` 或 `FORCE_REDEPLOY` 分支。
- 每次部署后，会验证必需地址 key 是否存在。
- `npm run check` 优先使用各仓库已有的检查脚本，然后追加跨仓库地址一致性检查和链上代码存在性检查。
