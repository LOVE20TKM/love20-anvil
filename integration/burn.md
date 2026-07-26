# Burn 集成测试

对应场景：[`burn.mjs`](burn.mjs)

## 运行

启动 fresh Anvil 并部署到 Burn：

```bash
npm run anvil:start
npm run deploy -- --to burn
npm run integration -- burn
```

测试默认通过 Anvil 快照隔离状态，成功或失败后都会回滚。排错时使用 `npm run integration -- burn --keep-state` 保留现场。

## 前置状态

- 使用 Anvil 默认账户完成两轮真实治理流程。
- 创建首个 LOVE20 社区及一个直接子社区。
- 为多个账户建立 SL、ST、治理奖励和行动奖励状态。
- 校验部署图产出的 Burn 已配置 LP V1、LP V2、链群行动、链群服务四个 Factory。
- 通过 Burn 仓库的 `one_click_deploy.sh` 部署双社区实例并执行仓库部署检查，空投代币使用真实 ERC20。

## 覆盖范围

- 运行时覆盖 `IBurn.sol` 全部 33 个外部函数，接口新增或遗漏会使测试失败。
- 覆盖两个社区和多个参与地址。
- 覆盖 SL、ST、治理奖励和行动奖励销毁。
- 覆盖基础行动、LP V1、LP V2、链群行动、链群服务五类行动来源。
- 覆盖 LP 扩展的 Factory 创建、行动提交、投票、注册、加入、验证、领取奖励和销毁。
- 校验基础行动和四类扩展在 ExtensionCenter 中的 Factory 映射。
- 校验 `SLTokenLocked`、`STTokenLocked`、`GovRewardTokenBurned`、`ActionRewardTokenBurned`、`AirdropClaimed` 事件。
- 所有结构化返回通过 Cast JSON 输出解析，避免终端科学计数注释影响断言。

## 失败与原子性

- Burn 周期结束前领取空投必须以 `ShareNotFinalized()` 失败。
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
burn: covered 33 IBurn functions, 2 communities, 5 action types, 4 factories
Integration test passed: burn (state reverted)
```
