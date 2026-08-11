# Burn 集成测试

对应场景：[`burn.mjs`](burn.mjs)

## 运行

启动 fresh Anvil 并部署 Burn 的上游依赖；Burn 由集成场景在前置状态完成后自行部署：

```bash
npm run anvil:start
npm run deploy -- --to extension-group
npm run integration -- burn
```

测试成功或失败后默认保留 Anvil 现场。再次运行前需重启 fresh Anvil 并重新部署；需要隔离运行并在结束后回滚时使用 `npm run integration -- burn --revert-state`。

每次运行开始时会先删除旧报告和旧快照产物；仅当本轮全部校验、地址写回或链状态回滚成功后，才生成 [`state/logs/burn-numeric-report.md`](../state/logs/burn-numeric-report.md)、[`state/logs/airdrop-numeric-report.md`](../state/logs/airdrop-numeric-report.md)，并把一键脚本的原始 `airdrop-snapshot.json`、`airdrop.params` 及供前端读取的 `airdrop-deployment.json` 保存到 `state/artifacts/burn/`。部署清单绑定目标链和 Airdrop 地址及来源链、来源区块、Burn、Root、总份额，不混入普通 Burn 部署状态。两份报告分别对应本轮唯一的 Burn 和 Airdrop 实例；数值表逐项并列展示独立理论值、链上合约状态或余额、事件值，任意三方不一致都会直接使集成测试失败。

## 前置状态

- 使用 Anvil 默认账户完成两轮真实治理流程。
- 创建首个 LOVE20 社区及一个直接子社区。
- 为多个账户建立 SL、ST、治理奖励和行动奖励状态。
- 子社区完成发射、测试行动完成投票后，集成脚本取该明确治理轮次作为 `startRound`；Burn 开放和结束边界直接按 `Vote.currentRound() - 3` 推进。每次都从当前 `../burn` 源码执行增量编译，并使用隔离产物部署双社区实例，避免复用陈旧字节码。
- Burn 构造参数使用社区 symbol，由 Launch 解析并校验对应代币；部署后同时核对 symbol、解析后的地址、`startRound/roundCount/endRound`，以及 LP V1、LP V2、链群行动、链群服务四个 Factory；空投代币使用真实 ERC20。

## 覆盖范围

- 运行时覆盖 `IBurn.sol` 全部 41 个外部函数，接口新增或遗漏会使测试失败。
- 覆盖两个社区和多个参与地址。
- 覆盖 SL、治理奖励和行动奖励销毁；ST 权重为 `0`，锁定必须以 `CategoryDisabled()` 失败。
- 覆盖基础行动、LP V1、LP V2、链群行动、链群服务五类行动来源。
- 覆盖 LP 扩展的 Factory 创建、行动提交、投票、注册、加入、验证、领取奖励和销毁。
- 校验基础行动和四类扩展在 ExtensionCenter 中的 Factory 映射。
- 校验 `CommunityConfigFrozen`、`SupportedExtensionFactoryFrozen`、`SLTokenLocked`、`GovRewardTokenBurned`、`ActionRewardTokenBurned`、`AirdropClaimed` 事件；禁用的 ST 类别不得产生锁定事件。
- 通过 ABI 结构化解码校验每个 indexed topic 和 data 字段，不只检查 `topic0` 或事件数量。
- 校验操作数量、得分系数、操作得分、地址与社区全周期累计数量和累计得分。
- 连续覆盖三个销毁轮次，以真实事件校验开始、中间、最后一轮的 `scoreBase²`、`scoreBase¹`、`1` 三档得分系数。
- 直接推进 Vote 轮次并校验 `Vote.currentRound() - 3` 对应的 Burn 轮次开放、过期和最终结算。
- 校验构造期社区权重、`1:0:5:7` 四类资产权重、`scoreBase`、部署时供应量、单轮激励以及全部受支持 Factory。
- 校验双地址空投事件中的份额、实际领取量、领取顺序和领取后的剩余份额。
- 所有结构化返回通过 Cast JSON 输出解析，避免终端科学计数注释影响断言。
- 数值报告覆盖部署权重与 `scoreBase`、各社区和地址的四类全周期累计数量/得分、首轮与末轮的截至轮次累计数量/得分、轮次 multiplier、双地址空投份额、领取数量及剩余份额/余额。

## 失败与原子性

- Burn 周期结束前领取空投必须以 `ShareNotFinalized()` 失败。
- ST 类别权重为 `0` 时，锁定必须以 `CategoryDisabled()` 失败。
- Burn 周期结束后的写操作必须以 `RoundNotOpen(uint256,uint256)` 失败。
- 同一地址二次领取空投必须以 `AirdropAlreadyClaimed()` 失败。
- 非快照地址代提交领取必须以 `UnauthorizedClaimer()` 失败。
- 行动奖励批量销毁中后续项目超过 quota 时，整批交易必须以 `BurnQuotaExceeded(uint256,uint256)` 回滚。
- 回滚前后 LOVE20 总供应量和账户周期销毁统计保持不变。

## 空投验收

- 两个不同地址实际调用 `claimAirdrop()` 并收到空投代币。
- 领取前后分别校验两个地址的 `accountAirdropState()`，包括 share、可领取金额、领取状态和实际领取金额。
- 校验全局 `remainingAirdropShare()`。
- 校验初始空投池等于两个地址领取增量与 Burn 剩余余额之和。

集成场景只在 Burn 全部销毁轮次结束后，把本轮 Burn 地址临时写入隔离的 Anvil 网络目录，调用 Burn 仓库真实的 `one_click_deploy_airdrop.sh anvil anvil`。该命令内部生成或复用快照并部署唯一的 Airdrop；集成测试根据命令实际写出的 `airdrop-deployment.json` 定位版本目录，读取并校验 JSON、参数、地址和原始部署清单，再用独立 JS 实现从本轮 `participants()` 和最终 `accountShare()` 复算 Root、总份额及每个 proof，验证：

- 来源链 ID、来源区块、来源 Burn、Root 和 `totalShare` 五个 immutable getter。
- 真实一键脚本的 JSON、部署参数和独立 JS 重建结果一致；集成结束后恢复 Burn 仓库原有网络文件。
- 快照 proof 可实际领取，包含一个空池 `NoClaimableAmount()` 和错误 proof 回滚。
- 同一份额分别领取两种 ERC20，领取一种代币不消耗另一种代币的资格。
- 追加同种代币后按该代币剩余份额重新计算，只有快照地址本人可以提交领取。
- 同种代币重复领取以 `AirdropAlreadyClaimed()` 失败。
- 独立 Airdrop 数值报告校验快照总份额、每次领取数量和领取后剩余份额，以及两种代币最终累计领取份额和合约池余额。

## 通过标准

命令退出码为 0，并输出：

```text
burn: covered 41 IBurn functions, 2 communities, 5 action types, 4 factories
airdrop: covered 11 IAirdrop functions, <N> snapshot accounts, 2 token pools
airdrop: numeric report passed 11 metrics -> <repo>/state/logs/airdrop-numeric-report.md
Integration test passed: burn (state kept)
```
