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

每次运行开始时会先删除旧报告；仅当本轮全部校验、地址写回或链状态回滚成功后，才生成 [`state/logs/burn-numeric-report.md`](../state/logs/burn-numeric-report.md)。报告中的 Burn 就是集成场景在完成治理和子社区前置状态后部署的唯一被测实例；数值表逐项并列展示独立理论模型、该 Burn 公共查询接口和该 Burn 事件重建结果，任意三方数值不一致都会直接使集成测试失败。

## 前置状态

- 使用 Anvil 默认账户完成两轮真实治理流程。
- 创建首个 LOVE20 社区及一个直接子社区。
- 为多个账户建立 SL、ST、治理奖励和行动奖励状态。
- 子社区完成发射、测试行动完成投票后，集成脚本取该明确治理轮次作为 `startRound`；每次都从当前 `../burn` 源码执行增量编译，并使用隔离产物部署双社区实例，避免复用陈旧字节码。
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
- 校验构造期社区权重、`1:0:5:7` 四类资产权重、`scoreBase`、部署时供应量、单轮激励以及全部受支持 Factory。
- 校验双地址空投事件中的份额、实际领取量、领取顺序和领取后的剩余份额。
- 所有结构化返回通过 Cast JSON 输出解析，避免终端科学计数注释影响断言。
- 数值报告覆盖部署权重与 `scoreBase`、各社区和地址的四类全周期累计数量/得分、首轮与末轮的截至轮次累计数量/得分、轮次 multiplier、双地址空投份额、领取数量及剩余份额/余额。

## 失败与原子性

- Burn 周期结束前领取空投必须以 `ShareNotFinalized()` 失败。
- ST 类别权重为 `0` 时，锁定必须以 `CategoryDisabled()` 失败。
- Burn 周期结束后的写操作必须以 `RoundNotOpen(uint256,uint256)` 失败。
- 同一地址二次领取空投必须以 `AirdropAlreadyClaimed()` 失败。
- 行动奖励批量销毁中后续项目超过 quota 时，整批交易必须以 `BurnQuotaExceeded(uint256,uint256)` 回滚。
- 回滚前后 LOVE20 总供应量和账户周期销毁统计保持不变。

## 空投验收

- 两个不同地址实际调用 `claimAirdrop()` 并收到空投代币。
- 领取前后分别校验两个地址的 `accountAirdropState()`，包括 share、可领取金额、领取状态和实际领取金额。
- 校验全局 `remainingAirdropShare()`。
- 校验初始空投池等于两个地址领取增量与 Burn 剩余余额之和。

## 通过标准

命令退出码为 0，并输出：

```text
burn: covered 41 IBurn functions, 2 communities, 5 action types, 4 factories
Integration test passed: burn (state kept)
```
