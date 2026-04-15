# Holdo.AI Meme Trader — 变更日志

> 记录每次功能新增、Bug 修复、优化改进。最新记录在最前面。

---

## [2026-04-14] 新功能：CA 战绩排行榜

**类型**: 新功能  
**版本**: v1.8.0  
**模块**: `backend/routers/analytics.py`, `frontend/src/components/AnalyticsPanel.jsx`

### 功能
在分析面板 P&L 曲线下方新增"CA 战绩排行榜"卡片：
- **时段筛选**：凌晨 / 上午 / 下午 / 晚上 / 今日 / 昨日 / 本周 / 本月 / 季度 / 年度 / 全部（北京时间感知）
- **多维排序**：总盈亏 / 胜率 / 最大收益 / 交易次数
- **表格展示**：排名（金银铜图标）、代币（链 badge + symbol）、叙事数据（社区/喊单人 MD5 hash + 热度 + 市值）、出局原因图标、总P&L、胜率进度条、最高/最低收益
- **展开详情行**：点击行展开每笔交易明细（时间/P&L/原因/链上 TX 链接）+ 完整叙事数据
- **正确的链浏览器**：BSC→bscscan, ETH→etherscan, SOL→solscan, BASE→basescan

---

## [2026-04-14] 修复：买入前增加钱包余额检查，余额不足不再发交易

**类型**: Bug 修复  
**版本**: v1.7.7  
**模块**: `backend/services/ave_client.py → _buy_evm()`

### 问题
钱包 USDT 余额不足时（如余额 0.02U，买入需要 0.1U），系统仍发出 TX，链上 revert，浪费 Gas 并产生假买入记录。

### 修复
`_buy_evm` Step 0 新增链上余额预检：用 `eth_call(balanceOf)` 查 inToken 实际余额，若 `余额 < 买入金额 × 95%`，直接抛 "钱包余额不足: 需要 XU，当前仅 YU（请充值）"，不再发交易。余额检查失败（RPC 超时等）时跳过检查继续执行（降级处理）。

---



**类型**: Bug 修复  
**版本**: v1.7.6  
**模块**: `backend/services/ave_client.py → _broadcast_evm_tx_direct()`

### 问题
直接广播模式（`broadcast_mode=direct`）下，`eth_sendRawTransaction` 返回 txHash 后立即返回"买入成功"，不检查链上 receipt。若 TX revert（`status=0x0`），系统仍记录为成功持仓（`token_amount=0`），后续触发 `zero_balance` 立即关仓，假买入假亏损。

### 根本原因
`_broadcast_evm_tx_direct` 只广播不等待，无 AVE 的模拟预检保护。

### 修复
广播后轮询 `eth_getTransactionReceipt`，最多 60 秒（BSC 出块 ~3s，最多轮询 20 次）：
- `status=0x1`：确认成功，返回 txHash
- `status=0x0`：抛 ValueError，买入失败，nonce 回退，不创建持仓
- 超时未收到 receipt：警告后继续（网络拥堵降级处理）

---



**类型**: Bug 修复  
**版本**: v1.7.5  
**模块**: `backend/services/ave_client.py`, `backend/services/position_monitor.py`

### 问题
v1.7.4 用 ATA 推导地址查余额，对 Token-2022 代币（pump.fun 新代币）无效：
- `getTokenAccountBalance(ATA地址)` 返回 `"could not find account"`
- fallback 用 DB 估算值仍报 `Insufficient token balance`

### 根本原因
pump.fun 新代币使用 **Token-2022 程序**（`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`），
其 token account 地址与标准 SPL ATA（`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`）推导结果**完全不同**。

### 修复
1. **`sell()`**：改用 `getTokenAccountsByOwner(wallet, {mint: ca})` 直接查钱包下该 mint 的所有 token accounts，无论 SPL 还是 Token-2022 都能找到真实余额
2. **`_get_chain_token_balance()`**：新增 SOL 链支持，同样用 `getTokenAccountsByOwner` 检测链上归零，rug 后自动关仓

---

## [2026-04-13] 修复：SOL 卖出 Insufficient token balance

**类型**: Bug 修复  
**版本**: v1.7.4  
**模块**: `backend/services/ave_client.py`

### 问题
SOL 链买入成功后触发止盈卖出，AVE 报 `status=3024 Insufficient token balance`。

### 根本原因
卖出时用 `token_amount * 1e6` 作为 `in_amount_raw`，这是 DB 里存的估算值（来自买入时 AVE 的 `estimateOut`），与链上 SPL token 账户实际余额有偏差，导致 AVE 验证失败。

### 修复
SOL 卖出前先查链上 ATA（Associated Token Account）真实余额：
1. 用 `solders` 计算 ATA 地址（`find_program_address`）
2. 调 Solana mainnet RPC `getTokenAccountBalance` 获取原始整数余额
3. 余额有效则用链上值，否则 fallback 到 DB 估算值

---



**类型**: Bug 修复  
**版本**: v1.7.3  
**模块**: `backend/services/ave_client.py`

### 问题
SOL 链买入时 `_sign_solana_tx` 报 `io error: unexpected end of file`，买入一直失败。

### 根本原因
AVE `createSolanaTx` 返回的 `txContent` 是非标准格式：
```
[0x80 版本标记][MessageV0 bytes]
```
而 solders 的 `VersionedTransaction.from_bytes()` 期望标准格式：
```
[compact-u16 签名数][签名内容][版本][消息]
```
`0x80` 被解析为 compact-u16 的第一字节（低7位=0，继续读下一字节），`0x01` 合并后得到 128，solders 认为有 128 个签名（需要 8192 字节），但实际只有 621 字节，导致 `unexpected end of file`。

### 修复
`_sign_solana_tx` 检测首字节是否为 `0x80`：
- 是：跳过首字节，用 `from_bytes_versioned(raw[1:])` 解析 MessageV0，再构造 `VersionedTransaction(msg, [kp])` 签名
- 否：fallback 到标准 `VersionedTransaction.from_bytes(raw)`

已通过实际 SOL 交易验证，`sendSignedSolanaTx` 返回真实 txHash。

---

## [2026-04-13] 修复：Approve Nonce Too Low 自动重试（重启后漂移修复）

**类型**: Bug 修复  
**版本**: v1.7.2  
**模块**: `backend/services/ave_client.py`

### 问题
后端重启后 `_nonce_local` 被清空，若上一笔 pending tx 已上链，`eth_getTransactionCount pending` 仍可能返回旧值，导致 approve 拿到过期 nonce，报错 `nonce too low: next nonce 846, tx nonce 845`，卖出失败。

### 修复
1. **`_alloc_nonce`**：同时查 `latest` + `pending` nonce，取 max，避免重启后漂移
2. **`_ensure_erc20_approved`**：approve 发送失败且 error 含 `nonce too low` 时，立即查 `latest` nonce 修正 `_nonce_local`，重新签名重试一次，不再直接报错

---

## [2026-04-13] 修复：各链买入金额统一按 U 配置，自动换算主链币

**类型**: Bug 修复  
**版本**: v1.7.1  
**模块**: `backend/services/ave_client.py`, `frontend/src/components/ConfigPanel.jsx`

### 问题
SOL 链买入时直接把配置的 U 数当成 SOL 数量，导致严重偏差：配置 0.1U → 实际花 0.1 SOL ≈ 15U。

### 修复
统一填 USDT 金额，各链自动换算：
- **BSC/ETH**：用 USDT 买，直接使用配置金额
- **BASE/XLAYER**：用 USDC 买，USDC≈1:1 USDT，直接使用配置金额
- **SOL**：买入前实时查询 SOL/USDC 价格（AVE 接口，60s 缓存），换算：`sol数量 = 配置U / SOL实时价格`

fallback 升级金额同样走换算逻辑。配置页说明文字同步更新。

---

## [2026-04-13] 新增功能：上云部署 — 管理员鉴权 + 演示钱包 + 双层配置

**类型**: 新增功能  
**版本**: v1.7.0  
**模块**: `backend/routers/admin.py`(新增), `backend/routers/config.py`, `backend/routers/wallet.py`, `backend/config.py`, `frontend/src/components/AdminPanel.jsx`(新增), `frontend/src/App.jsx`, `frontend/src/components/ConfigPanel.jsx`

### 功能说明
为上云公开部署设计的安全体系：管理员登录 + 敏感配置加密 + 演示钱包一键切换。

### 功能详情

**管理员认证（纯 stdlib JWT）**：
- `POST /api/admin/login` 验证密码，返回 HMAC-SHA256 JWT token（24h 有效）
- 前端 Header 显示 🔒/🔐 按钮，token 持久化到 localStorage
- `ADMIN_PASSWORD` 环境变量控制，空=开发模式（跳过鉴权）

**双层配置安全**：
- `GET /api/config`：敏感字段（AVE Trade/Data API Key）返回 `"__set__"` 占位符
- 普通用户看不到实际 Key 值，配置页显示 🔐 已加密锁定
- `GET /api/admin/config`：管理员专用，返回完整明文值
- `PUT /api/admin/config`：管理员更新任意配置项

**演示钱包管理**：
- `POST /api/admin/wallet/save_demo`：将当前钱包保存为演示快照（存 DB）
- `POST /api/admin/wallet/restore_demo`：从 DB 快照或 `DEMO_WALLET_MNEMONIC` 环境变量恢复
- `POST /api/wallet/use_demo`：任何用户可一键切换到演示钱包（无需管理员）
- `wallet_mode: demo|custom` 状态跟踪，删除自定义钱包后自动恢复演示钱包

**前端组件**：
- `AdminPanel.jsx`：管理员控制台（演示钱包管理 + 敏感 Key 编辑）
- `LoginModal`：管理员密码弹窗
- `DemoWalletSwitcher`：钱包页下方的模式切换器（用户可见）
- ConfigPanel 锁定显示：当后端返回 `"__set__"` 时显示加密图标而非输入框

### 新增环境变量
```env
ADMIN_PASSWORD=your_admin_password
JWT_SECRET=random_string_change_me
WALLET_MASTER_PASSWORD=encryption_password
DEMO_WALLET_MNEMONIC=word1 word2 ... word12  # 可选
AI_BUILTIN_KEY=sk-xxx                         # 可选
```

---

## [2026-04-13] 新增功能：CA 战绩排行榜

**类型**: 新增功能  
**版本**: v1.6.0  
**模块**: `backend/routers/analytics.py`, `frontend/src/components/AnalyticsPanel.jsx`, `frontend/src/api.js`

### 功能说明
仪表盘 P&L 曲线下方新增"CA 战绩排行榜"区域，聚合展示买过的所有 CA 的交易战绩。

### 功能详情

**时段筛选**（北京时间感知）：
- 时段行：凌晨(00-06) / 上午(06-12) / 下午(12-18) / 晚上(18-24) / 今日 / 昨日
- 跨度行：本周 / 本月 / 季度 / 年度 / 全部

**排序维度**：总盈亏 / 胜率 / 最高收益 / 交易次数

**表格列**：
- `#`：排名，前三名显示 🥇🥈🥉 图标
- `代币`：链徽章 + symbol/name + CA 前8位
- `叙事`：社区MD5(蓝) + 喊单人MD5(橙) + 全网热度 + 市值
- `出局原因`：止盈/止损/超时 彩色徽章
- `总P&L`：金额(U) + 笔数，颜色区分盈亏
- `胜率`：进度条 + 百分比 + 胜/总
- `最高/最低`：最大涨跌幅

**展开行**（点击行展开）：
- 叙事完整数据：喊单人/社区WS胜率、市值、持仓人数、本群/全网热度、当前倍数、风险评分
- 每笔交易明细：时间、P&L(U)、涨跌幅%、出局原因、Tx链接

**视觉**：盈利行绿色背景微光，亏损行红色背景微光

### 技术实现
- 后端 `_ca_leaderboard_range(period)` 函数，UTC+8 计算各时段范围
- `GET /api/analytics/ca_leaderboard?period=&sort_by=&limit=` 端点
- 按 ca+chain 分组聚合 Trade 表，关联 CaFeed 最新记录取叙事数据
- 前端 `getCaLeaderboard(period, sort_by)` API 函数
- `CaLeaderboardCard` 组件：状态管理 + 展开行逻辑

---



**类型**: 新增功能  
**模块**: `backend/routers/positions.py`, `frontend/src/components/PositionsTable.jsx`

### 功能说明
Bot持仓表"买入价"列后新增 3 列喊单信息（共呈现6项数据）：

- **喊单人/社区**：喊单社区（蓝色MD5短码）+ 喊单人（橙色MD5短码），两行显示
- **WS胜率**：社区WS胜率 + 喊单人WS胜率，颜色区分（≥60%绿/40-60%黄/<40%红）
- **本地胜率**：系统本地实际胜率（基于SenderStats实际交易结果，无记录显示"—"）

### 技术实现
- 后端 positions API 的 callers 数组新增 `sw`（sender_win_rate）、`gw`（sender_group_win_rate）、`sl`（本地胜率）字段
- 批量查 SenderStats 表，计算 win/(win+loss)×100%
- 前端 `CallerBadges` 组件重构为 `CallerInfo`，支持三种 field：`id`/`wr`/`local`
- 原"喊单"单列删除，功能整合到新增的 3 列中

---

## [2026-04-13] Bug 修复：3025+DEX fallback 均失败时日志只显示"合约模拟失败"

**类型**: Bug 修复  
**模块**: `backend/services/ave_client.py`, `backend/services/trade_engine.py`

### 问题描述
3025 触发 DEX fallback 后，若 fallback 也失败，日志只显示原始 3025 "合约模拟失败"，DEX 失败原因被丢弃。

### 修复内容
- DEX fallback 失败时，把两个错误合并抛出：`AVE 3025 + DEX fallback 均失败: {dex_err}`
- `_classify_sell_error` 新增识别 `"3025" + "DEX fallback"` → "合约模拟失败 + DEX 也失败（代币貔貅/限制卖出）"

---

## [2026-04-13] 新增功能：交易广播模式配置（直接广播可降低 Gas 90%）

**类型**: 新增功能  
**模块**: `backend/services/ave_client.py`, `backend/routers/config.py`, `frontend/src/components/ConfigPanel.jsx`

### 背景
AVE `sendSignedEvmTx` 接口的模拟限制要求 gasPrice ≥ 1 Gwei，而 BSC 实际网络最低约 0.07 Gwei，导致我们系统每笔 Gas 约 0.2-0.3U，手动在 AVE App 交易（不经过模拟接口）只需 0.02-0.03U。

### 功能说明
新增配置项 `broadcast_mode`，在配置页"Gas 费优化"区域切换：

- **AVE 广播**（默认）：`createEvmTx` → 本地签名 → `sendSignedEvmTx`（AVE 服务器模拟验证）。gasPrice ≥ 1 Gwei，有 MEV 保护，可识别 3025 貔貅错误。每笔约 0.2-0.3U。
- **直接广播**：`createEvmTx` 获取路由 calldata → 本地签名 → `eth_sendRawTransaction` 直接广播。gasPrice 跟随实时网络（BSC 约 0.07 Gwei），每笔约 **0.02-0.03U，省约 90%**。无 AVE 模拟预检，貔貅代币会直接 revert。

### 技术实现
- `_broadcast_evm_tx_direct()` 新增方法，直接 RPC 广播
- `_sign_evm_tx()` / `_fetch_nonce_and_gas()` 增加 `direct_broadcast` 参数
- `MIN_GAS_PRICE_DIRECT` 字典（BSC 最低 0.05 Gwei）
- `_get_gas_cfg()` 读取 `broadcast_mode` 配置
- 买入和卖出均支持两种模式分支

---

## [2026-04-13] Bug 修复：喊单信号流/CA流水时间显示 UTC 而非北京时间

**类型**: Bug 修复  
**模块**: `backend/routers/analytics.py`

### 问题描述
喊单新号流和 CA 流水的时间显示 10:27，实际北京时间 18:27，差 8 小时。

### 根本原因
`analytics.py` 里所有 `datetime.isoformat()` 调用都**没有加 `"Z"` 后缀**。
浏览器收到 `2026-04-13T10:27:00` 时，无法判断时区，直接当作本地时间处理，导致 `timeZone: 'Asia/Shanghai'` 的转换完全无效。
对比：`positions.py` 和 `trades.py` 已有 `+ "Z"`，所以持仓/历史交易时间显示正确。

### 修复内容
`analytics.py` 中 7 处 `.isoformat()` 全部改为 `.isoformat() + "Z"`：
- `received_at`（信号流/CA流水，2处）
- `close_time`（P&L 曲线）
- `timestamp`（价格曲线快照）
- `open_time`（持仓详情，2处）
- `last_seen`（发币人统计）

---



**类型**: Bug 修复  
**模块**: `backend/services/ave_client.py`, `backend/services/trade_engine.py`, `backend/services/position_monitor.py`

### 问题描述
BSC 钱包 BNB 余额不足时，AVE API 返回 `status=3024 msg='Not enough BNB to cover gas fees. Add at least 0.01 BNB'`，但前端日志显示"卖出失败（未知原因）— 构造卖出交易失败"，掩盖了真实原因。

### 修复内容
1. **`_create_evm_tx`**：返回空 data 时，将 AVE 的 status+msg 一并抛出（`raise ValueError(f"createEvmTx failed: status=3024 msg=...")`），不再丢失错误详情
2. **`_classify_sell_error`**：新增 Gas 不足专项识别（检测 "BNB"+"gas" 关键词），映射为"主币余额不足，无法支付 Gas（请充值 BNB）"
3. **`position_monitor`**：Gas 不足与 3025 一样属于不可自愈错误，累计 5 次即放弃（不再等 20 次）

---

## [2026-04-13] Bug 修复：3025 错误立即触发 DEX fallback，不再等 5 批次

**类型**: Bug 修复  
**模块**: `backend/services/ave_client.py` → `_sell_evm()`

### 问题描述
3025 (AVE Router 合约模拟失败) 属于路由合约 bug，与卖出数量无关，任何批次大小（100%/50%/25%/10%/5%）都会失败。但原代码需要等 5 批次全部失败后才触发 PancakeSwap DEX fallback，导致每次 sell() 调用浪费 5 次 AVE API 请求。

### 修复内容
- 第 1 次 3025 失败即立即触发 `_sell_via_dex_direct()` fallback，不再做无意义的批量重试
- 批量重试逻辑（分 50%/25%/10%/5%）保留，但仅用于非 3025 的其他失败（如滑点超限等）

---

## [2026-04-13] 优化：全站时间显示统一为北京时间

**类型**: 优化  
**模块**: `frontend/src/App.jsx`, `frontend/src/components/LiveLog.jsx`, `frontend/src/components/AnalyticsPanel.jsx`, `frontend/src/components/TradeHistory.jsx`, `frontend/src/components/ConfigPanel.jsx`, `frontend/src/components/WalletPortfolio.jsx`

### 修改内容
全面排查所有时间显示代码，共修复 **8 处**字符串切片（`.slice()` 无时区转换）问题。所有 `toLocaleTimeString` / `toLocaleString` 调用统一加 `timeZone: 'Asia/Shanghai'`，确保不论浏览器所在时区，均显示北京时间（UTC+8）。

涉及位置：实时日志时间戳、喊单信号流 `received_at`、P&L 曲线聚合键、价格曲线时间戳、历史交易关闭时间、Gas 记录 hover 时间、钱包余额更新时间。

---

## [2026-04-13] 新增功能：买入/卖出卡片显示交易路由

**类型**: 新增功能  
**模块**: `frontend/src/App.jsx`, `backend/services/trade_engine.py`, `backend/services/ave_client.py`, `backend/services/position_monitor.py`

### 功能说明
首页实时日志的买入卡片和卖出卡片底部新增路由标签，显示本次交易使用的路由协议。

### 详细内容
- **买入卡片**：固定显示 `⚡ AVE Trade`（蓝色标签）
- **卖出卡片**：正常走 AVE Router 显示 `⚡ AVE Trade`（蓝色），触发 DEX fallback 时显示 `⚡ PancakeSwap Direct`（黄色）
- 后端 `broadcaster.emit("buy", {...})` 增加 `route: "AVE Trade"` 字段
- `_sell_evm()` 返回 dict 增加 `route` 字段（`"AVE Trade"` 或 `"PancakeSwap Direct"`）
- `broadcaster.emit("sell", {...})` 透传 `route` 字段

---

## [2026-04-13] Bug 修复：AVE Router 内层合约 bug 导致卖出失败 (3025)

**类型**: Bug 修复 · 优化  
**模块**: `backend/services/ave_client.py`

### 问题描述
部分 BSC 代币卖出时持续报错 `status=3025 (simulate failed)`，即使滑点设置为 50% 也无法成功。日志只显示"合约模拟失败"，无具体原因。

### 根本原因
深度调查发现问题链条如下：
```
用户钱包 → approve AVE Router(0xd36b6d) ✓
AVE Router → 调用内层路由(0x2315fa)
内层路由 → token.transferFrom(wallet→inner) ✓  (wallet 已 approve inner)
内层路由 → PancakeSwap.swap(inner→pair) ✗
           ↑ inner_b(0x2315fa) 对 PancakeSwap 的 allowance = 0
           ↑ TransferHelper: transferFrom failed → AVE 3025
```
**AVE Bot API 内层路由合约 `0x2315faf6...` 自身从未 approve PancakeSwap**，属于 AVE 合约的 bug。

### 修复内容
1. **DEX 直接卖出 fallback** (`_sell_via_dex_direct`)  
   AVE 所有批次均 3025 失败时，自动构造 PancakeSwap `swapExactTokensForETHSupportingFeeOnTransferTokens` 交易直接广播，绕过 AVE Router 整条调用链。

2. **calldata 内层 spender 补充 approve** (`_approve_calldata_spenders`)  
   从 `createEvmTx` 返回的 calldata 中解析所有合约地址，对未被 approve 的内层合约补充授权，减少未来遇到类似问题的概率。

---

## [2026-04-13] Bug 修复：卖出批量重试 nonce 重复问题

**类型**: Bug 修复  
**模块**: `backend/services/ave_client.py` → `_sell_evm()`

### 问题描述
卖出失败时系统尝试 5 次批量比例（100%/50%/25%/10%/5%），但所有 5 次使用的是同一个 nonce，导致重试无实际意义。

### 根本原因
`3025 simulate failed` 意味着 tx 从未广播上链，链上 nonce 不变。每次重试重新 `alloc_nonce` 仍会得到相同的 nonce 值。

### 修复内容
- 整个 batch 重试循环只在开始时分配一次 nonce
- 3025 失败时不再重新 alloc，直接复用同一 nonce（tx 未上链，nonce 未消耗）
- 只有在最终所有批次均失败时才回退 `_nonce_local[chain_id] = alloc_nonce - 1`

---

## [2026-04-13] 优化：链上余额为零时立即报错，不再无效重试

**类型**: 优化 · Bug 修复  
**模块**: `backend/services/ave_client.py` → `sell()`, `backend/services/trade_engine.py`, `backend/services/position_monitor.py`

### 问题描述
当持仓代币链上余额为 0 时，系统仍用 DB 记录的 `token_amount` 构造卖出交易，导致 5 次无效的 AVE API 调用和 3025 错误。

### 修复内容
1. **多节点 RPC 确认**：BSC 查询使用 4 个备用节点（dataseed1/2、publicnode、meowrpc），任意一个节点返回非零余额即使用，只有所有节点一致确认余额为 0 才判定为真实零余额
2. **余额为零直接抛出明确错误**：`"链上代币余额为零（N个RPC节点一致确认 balanceOf=0）"`，不再走批量重试
3. **错误分类优化** (`_classify_sell_error`)：增加"链上余额为零"专项分类，最高优先级匹配
4. **日志截断从 100 → 180 字符**：确保完整错误信息显示在实时日志中

---

## [2026-04-13] 优化：3025 错误快速放弃阈值

**类型**: 优化  
**模块**: `backend/services/position_monitor.py`

### 修复内容
新增 `SELL_ABANDON_SIMULATE_FAIL = 5`：合约模拟失败（3025）属于不可自愈错误，累计 5 次即放弃关仓，不再等 20 次（普通错误仍保持 20 次阈值）。

---

## [2026-04-13] 新增功能：AI 对话助手

**类型**: 新增功能  
**模块**: `backend/routers/ai_chat.py` (新建), `frontend/src/components/AiChat.jsx` (新建)

### 功能说明
在实时日志下方新增 AI 对话面板，支持与系统进行自然语言交互。

### 详细内容
- **多 AI 提供商支持**：OpenAI、Claude (Anthropic)、DeepSeek、Google Gemini、自定义 OpenAI 兼容接口
- **系统上下文注入**：自动注入当前持仓、交易统计、配置信息供 AI 参考
- **设置面板**：可配置 provider、model、API Key、Base URL、max_tokens、temperature
- **Markdown 渲染**：支持加粗、代码、换行的简单 Markdown

---

## [2026-04-13] 新增功能：交易统计时段筛选器

**类型**: 新增功能  
**模块**: `backend/routers/trades.py`, `frontend/src/App.jsx`

### 功能说明
4 个统计卡片（总交易次数、总盈亏、胜/负、Gas消耗）新增时段选择器：小时 / 天 / 周 / 月 / 年 / 全部。

### 详细内容
- 后端 `GET /api/trades/stats?period=` 增加时段过滤参数
- 前端 `PeriodBadge` 组件，各时段有独立颜色标识
- 统计卡片新增扩展指标：avg_win、avg_loss、max_win、max_loss、profit_factor、best_streak、worst_streak

---

## [2026-04-13] 新增功能：丰富统计卡片内容

**类型**: 新增功能  
**模块**: `frontend/src/App.jsx`

### 功能说明
- **胜/负卡片**：增加胜率进度条、平均盈/亏、最大盈/亏、盈利因子、连胜/连败
- **当前持仓卡片**：增加各持仓迷你盈亏柱、链分布统计
- **Gas消耗卡片**：增加 Gas 折线图、Gas 效率对比

---

## [2026-04-13] 新增功能：头部实时资产展示

**类型**: 新增功能  
**模块**: `frontend/src/App.jsx` → `HeaderStats`

### 功能说明
顶部 header 直接内联展示各链主币余额和 USDT 余额，15 秒自动刷新，带数字动效。支持链：SOL、BSC、ETH、XLAYER。

---

## [2026-04-13] 新增功能：交易音效提示

**类型**: 新增功能  
**模块**: `frontend/src/App.jsx`

### 功能说明
三种提示音效（新 MEME 信号 / 买入 / 卖出），Web Audio API 合成无需音频文件，右上角一键静音（localStorage 持久化）。

---

## [历史] 系统初始化

**类型**: 初始化  
**模块**: 全部

### 系统架构
- **后端**: FastAPI + SQLAlchemy (SQLite) + WebSocket 实时推送
- **前端**: React + Vite + Tailwind CSS
- **交易引擎**: AVE Bot API (EVM链钱包) + 自管私钥签名
- **支持链**: BSC / ETH / SOL / XLAYER
- **核心功能**: MEME 代币信号监听 → 自动买入 → 持仓监控 → 止盈/止损/超时自动卖出
