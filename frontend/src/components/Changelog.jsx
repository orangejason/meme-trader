import { useState, useEffect } from 'react'
import { clsx } from 'clsx'

// 变更日志数据（与 CHANGELOG.md 保持同步，每次改动同时更新这里）
const CHANGELOG = [
  {
    date: '2026-04-14',
    version: 'v1.8.0',
    entries: [
      {
        type: 'feature',
        title: 'CA 战绩排行榜',
        module: 'AnalyticsPanel.jsx + analytics.py /ca_leaderboard',
        detail: `分析面板 P&L 曲线下方新增"CA 战绩排行榜"：
- 时段筛选：凌晨/上午/下午/晚上/今日/昨日/本周/本月/季度/年度/全部（北京时间）
- 多维排序：总盈亏 / 胜率 / 最大收益 / 交易次数
- 表格：金银铜排名图标、链badge、叙事数据（MD5匿名社区/喊单人、热度、市值）、出局原因、胜率进度条
- 点击行展开每笔交易明细 + 完整叙事数据 + 链上 TX 链接（自动匹配链浏览器）`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-14',
    version: 'v1.7.7',
    entries: [
      {
        type: 'fix',
        title: '买入前余额检查，不足时直接报错不发交易',
        module: 'ave_client.py → _buy_evm() Step 0',
        detail: `钱包 USDT 余额不足（如 0.02U，买入需 0.1U）时，系统仍发 TX → 链上 revert → 假买入记录 + Gas 浪费。
修复：_buy_evm 最前面用 eth_call(balanceOf) 查链上实际余额，若 余额 < 买入金额×95% 直接抛错"钱包余额不足，请充值"，不再发交易。余额查询失败时降级跳过检查。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-14',
    version: 'v1.7.6',
    entries: [
      {
        type: 'fix',
        title: '直接广播 TX revert 后误报"买入成功"',
        module: 'ave_client.py → _broadcast_evm_tx_direct()',
        detail: `直接广播模式（broadcast_mode=direct）下，eth_sendRawTransaction 返回 txHash 即返回成功，不检查链上结果。TX revert（status=0x0）时仍创建持仓（token_amount=0），触发 zero_balance 立即关仓，产生假亏损记录。
修复：广播后轮询 eth_getTransactionReceipt，最多 60 秒：
status=0x1 → 确认成功；status=0x0 → 抛异常不创建持仓；超时 → 警告后继续。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.7.5',
    entries: [
      {
        type: 'fix',
        title: 'SOL 卖出用 getTokenAccountsByOwner 替代 ATA 推导',
        module: 'ave_client.py → sell(), position_monitor.py → _get_chain_token_balance()',
        detail: `SOL 链 pump.fun 新代币使用 Token-2022 程序（TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb），
其 token account 地址不等于标准 SPL ATA 推导结果，导致 ATA 查询返回 "could not find account"，
fallback 用 DB 估算值后 AVE 仍报 Insufficient token balance。
修复：sell() 改用 getTokenAccountsByOwner 直接查钱包下该 mint 的所有 token accounts，
无论 Token 程序是标准 SPL 还是 Token-2022 都能找到真实余额。
同步修复：position_monitor _get_chain_token_balance 新增 SOL 链支持，
用同样方式检测链上归零（rug 后自动关仓），不再只对 EVM 链做零余额检测。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.7.4',
    entries: [
      {
        type: 'fix',
        title: 'SOL 卖出 Insufficient token balance 修复（ATA 方式，已被 v1.7.5 替代）',
        module: 'ave_client.py → sell()',
        detail: `SOL 买入成功后止盈卖出报 "Insufficient token balance"。
原因：卖出用 DB 里的估算值 token_amount×1e6 作为 in_amount_raw，与链上 SPL 余额有偏差。
修复：卖出前调 Solana RPC getTokenAccountBalance 查 ATA 真实余额，用链上实际数字，fallback 才用 DB 估算值。`,
        impact: 'high',
      },
      {
        type: 'fix',
        title: 'SOL 链买入签名失败根治（io error: unexpected end of file）',
        module: 'ave_client.py → _sign_solana_tx()',
        detail: `AVE createSolanaTx 返回非标准格式 [0x80版本标记][MessageV0 bytes]，
solders VersionedTransaction.from_bytes() 把 0x80 解析为 compact-u16 签名数=128，
需读 128×64=8192 字节但实际只有 621 字节，触发 end of file。
修复：对完整 raw 字节签名（含 0x80），构建 [0x01][sig64][raw]，已通过真实 SOL 交易验证。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.7.2',
    entries: [
      {
        type: 'fix',
        title: 'Approve Nonce Too Low 自动重试（重启后漂移修复）',
        module: 'ave_client.py',
        detail: `后端重启后 _nonce_local 被清空，若上一笔 pending tx 已上链，approve 会拿到过期 nonce 导致 "nonce too low" 失败。
两处修复：
1. _alloc_nonce：同时查 latest + pending nonce，取 max，避免重启后漂移
2. _ensure_erc20_approved：approve 发送失败且含 "nonce too low" 时，立即查 latest nonce 修正本地状态，重新签名重试一次，不再直接报错`,
        impact: 'high',
      },
      {
        type: 'fix',
        title: '各链买入金额统一按 U 配置，自动换算主链币',
        module: 'ave_client.py, ConfigPanel.jsx',
        detail: `原逻辑：SOL链买入直接把配置的 U 数当 SOL 数量（严重偏差，0.1U → 0.1 SOL≈15U）。
修复后：统一填 USDT 金额，各链自动换算：
  - BSC/ETH：用 USDT 买，直接使用配置金额
  - BASE/XLAYER：用 USDC 买，USDC≈1:1 USDT，直接使用配置金额
  - SOL：实时查询 SOL 价格（AVE接口，60s缓存），换算：sol数量 = 配置U / SOL价格
配置页买入金额说明文字同步更新，fallback 升级金额同样走换算逻辑。`,
        impact: 'high',
      },
      {
        type: 'feat',
        title: '上云部署 — 管理员鉴权 + 演示钱包 + 双层配置',
        module: 'admin.py(新), config.py, wallet.py, AdminPanel.jsx(新), App.jsx, ConfigPanel.jsx',
        detail: `管理员登录（HMAC-SHA256 JWT，纯stdlib）：Header 🔒/🔐 按钮，token 持久化 localStorage，ADMIN_PASSWORD 环境变量控制。
双层配置安全：普通接口敏感字段返回 "__set__" 占位符，管理员专用接口返回明文；ConfigPanel 锁定显示。
演示钱包管理：save_demo/restore_demo（管理员API） + use_demo（用户API）；wallet_mode: demo|custom 状态跟踪；删除自定义钱包自动恢复演示钱包。
新增 ADMIN_PASSWORD / JWT_SECRET / WALLET_MASTER_PASSWORD / DEMO_WALLET_MNEMONIC 环境变量。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.6.2',
    entries: [
      {
        type: 'feat',
        title: 'AI接口配置统一到配置页 + 内置共享Key',
        module: 'ai_chat.py, ConfigPanel.jsx, AiChat.jsx, database.py',
        detail: `配置页新增「AI 助手接口」分区（API配置卡片下方）：
内置共享Key（CometAPI转发）默认开启，每日限额显示进度条（绿/黄/红）。
内置Key关闭或超限后，自动降级到用户自己的Key（Provider+模型+Key+BaseURL+高级参数）。
新增 CometAPI provider（gpt-4o/gpt-4o-mini/claude/deepseek/gemini等）。
后端：AI_BUILTIN_KEY/AI_BUILTIN_URL/AI_BUILTIN_MODEL 环境变量控制内置Key。
每日计数内存维护，超限时错误信息明确提示剩余次数。
AiChat.jsx 设置面板精简：仅保留启用开关+用量展示+高级参数，Key配置引导到配置页。`,
        impact: 'high',
      },
    ],
  },
  {
    entries: [
      {
        type: 'feat',
        title: 'AI助手融入社区信号流',
        module: 'ai_chat.py, AiChat.jsx',
        detail: `AI 助手系统上下文新增「近2小时社区信号摘要」：
各社区推送量排行、最热CA（按全网热度qwfc）、高热度但未买入的遗漏CA（附过滤原因）。
AI 可直接回答：今日哪个社区最活跃、某CA为什么没买、热度分布规律。

前端欢迎语重写，列出5项能力（社区热度/持仓分析/发币人战绩/胜率统计/风险识别）。
输入框 placeholder 改为具体引导语。
新增快捷问题 chips（初始状态显示）：今日社区热度/当前持仓分析/近期胜率/遗漏CA/策略建议，点击直接发送。`,
        impact: 'medium',
      },
    ],
  },
  {
    entries: [
      {
        type: 'feat',
        title: 'CA战绩排行榜',
        module: 'analytics.py, AnalyticsPanel.jsx, api.js',
        detail: `仪表盘 P&L曲线下方新增 CA战绩排行榜。
时段筛选：凌晨/上午/下午/晚上/今日/昨日/本周/本月/季度/年度/全部（北京时间感知）。
多维度排序：总盈亏/胜率/最高收益/交易次数。
表格列：排名（🥇🥈🥉）、代币+链、喊单人/社区、出局原因徽章、总P&L、胜率进度条、最高/最低幅度。
展开行：每笔交易时间/P&L/原因/Tx链接 + 叙事完整数据（市值/持仓人数/热度/风险评分）。
盈利行绿色微光，亏损行红色微光。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.5.4',
    entries: [
      {
        type: 'feat',
        title: 'Bot持仓表新增喊单人/社区/胜率列',
        module: 'positions.py, PositionsTable.jsx',
        detail: `买入价后新增3列：
喊单人/社区：蓝色社区MD5短码 + 橙色喊单人MD5短码（两行）。
WS胜率：社区WS胜率 + 喊单人WS胜率，颜色：≥60%绿/40-60%黄/<40%红。
本地胜率：系统实际交易结果统计的真实胜率（无记录显示—）。
后端新增批量查 SenderStats，前端 CallerBadges 重构为 CallerInfo。`,
        impact: 'medium',
      },
      {
        type: 'fix',
        title: '3025+DEX fallback 均失败时日志原因被丢弃',
        module: 'ave_client.py, trade_engine.py',
        detail: `3025 触发 DEX fallback，fallback 也失败时，原来 raise 原始 3025 错误，DEX 失败原因丢失。
修复：合并两个错误 "AVE 3025 + DEX fallback 均失败: {dex_err}"。
_classify_sell_error 新增识别该组合 → "合约模拟失败 + DEX 也失败（代币貔貅/限制卖出）"。`,
        impact: 'medium',
      },
      {
        type: 'fix',
        title: '直接广播配置保存后重置回AVE广播',
        module: 'database.py',
        detail: `切换直接广播后点保存，切换tab再回来就变回AVE广播。
根本原因：database.py init_db defaults 缺少 broadcast_mode，DB 里没有该 key，每次 ConfigPanel 重新 mount 时 getConfig() 返回的 data 里没有 broadcast_mode，state 重置为前端硬编码默认值 "ave"，再保存就覆盖了用户的选择。
修复：init_db defaults 加入 broadcast_mode: "ave"，重启后自动写入 DB，之后切换+保存正常持久化。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.5.2',
    entries: [
      {
        type: 'feat',
        title: '交易广播模式配置（直接广播可降低 Gas 90%）',
        module: 'ave_client.py, config.py, ConfigPanel.jsx',
        detail: `新增配置项"广播模式"：
AVE 广播（默认）：经 AVE sendSignedEvmTx 模拟验证，gasPrice 强制 ≥1 Gwei，每笔约 0.2-0.3U。
直接广播：用 AVE createEvmTx 获取路由 calldata，跳过 AVE 模拟，直接 eth_sendRawTransaction 广播，gasPrice 跟随实时网络（BSC约0.07 Gwei），每笔约 0.02-0.03U，省约 90%。
配置页 Gas 费优化区域切换，立即生效。`,
        impact: 'high',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.5.1',
    entries: [
      {
        type: 'fix',
        title: 'Gas 不足错误显示"未知原因"',
        module: 'ave_client.py, trade_engine.py, position_monitor.py',
        detail: `AVE 返回 status=3024 "Not enough BNB to cover gas fees" 时，前端显示"未知原因"。
修复：_create_evm_tx 抛出含 status+msg 的完整异常；_classify_sell_error 识别 BNB+gas 关键词，显示"主币余额不足，无法支付 Gas（请充值 BNB）"；Gas 不足列为不可自愈错误，5 次即放弃。`,
        impact: 'high',
      },
      {
        type: 'fix',
        title: '3025 错误立即触发 DEX fallback，不再等 5 批次',
        module: 'ave_client.py → _sell_evm()',
        detail: `3025 (AVE Router 合约模拟失败) 与卖出数量无关，5 个批次都会失败。
原代码：等 5 批次全部 3025 才触发 PancakeSwap DEX fallback，每次白白浪费 5 次 AVE API 调用。
修复：第 1 次 3025 立即触发 DEX 直接卖出，批量重试仅保留给滑点等其他类型失败。`,
        impact: 'high',
      },
      {
        type: 'perf',
        title: '全站时间显示统一为北京时间',
        module: 'App.jsx, LiveLog.jsx, AnalyticsPanel.jsx, TradeHistory.jsx, ConfigPanel.jsx, WalletPortfolio.jsx',
        detail: `全面排查所有时间显示代码，共修复 8 处字符串切片（.slice() 无时区转换）问题。
所有 toLocaleTimeString / toLocaleString 统一加 timeZone: 'Asia/Shanghai'。
涉及：实时日志、喊单信号流、P&L曲线、价格曲线、历史交易、Gas记录、钱包更新时间。`,
        impact: 'low',
      },
      {
        type: 'feat',
        title: '买入/卖出卡片显示交易路由',
        module: 'App.jsx, trade_engine.py, ave_client.py, position_monitor.py',
        detail: `首页实时日志的买入/卖出卡片底部新增路由标签。
买入：固定显示 ⚡ AVE Trade（蓝色）。
卖出：正常走 AVE Router 显示 AVE Trade，触发 DEX fallback 时显示 PancakeSwap Direct（黄色）。
后端 broadcaster.emit 增加 route 字段，前端卡片读取并渲染。`,
        impact: 'low',
      },
    ],
  },
  {
    date: '2026-04-13',
    version: 'v1.5.0',
    entries: [
      {
        type: 'fix',
        title: 'AVE Router 内层合约 bug 导致卖出失败 (3025)',
        module: 'ave_client.py',
        detail: `根本原因：AVE Bot API 内层路由合约 0x2315fa 自身从未 approve PancakeSwap，导致任何走该路径的代币卖出时合约模拟失败。
修复：AVE 所有批次 3025 失败时，自动 fallback 到直接构造 PancakeSwap swapExactTokensForETHSupportingFeeOnTransferTokens 交易广播，完全绕过 AVE Router 调用链。
同时新增 calldata 解析逻辑，对内层合约地址补充 approve。`,
        impact: 'high',
      },
      {
        type: 'fix',
        title: '卖出批量重试 nonce 重复问题',
        module: 'ave_client.py → _sell_evm()',
        detail: `3025 simulate 失败意味着 tx 从未上链，链上 nonce 不变。原代码每次重试重新 alloc_nonce 仍得到相同值，导致5次批量重试均用同一 nonce 毫无意义。
修复：整个 batch 循环只分配一次 nonce，3025 失败时直接复用，最终失败才回退。`,
        impact: 'high',
      },
      {
        type: 'fix',
        title: '链上余额为零时立即报错，不再无效重试',
        module: 'ave_client.py, trade_engine.py, position_monitor.py',
        detail: `当代币链上余额为0时，原代码仍用DB数量构造交易，导致5次无效AVE API调用。
修复：多节点RPC确认（BSC 4个备用节点），所有节点一致返回0时立即抛出明确错误，跳过批量重试。
同时优化错误分类和日志截断（100→180字符）。`,
        impact: 'medium',
      },
      {
        type: 'fix',
        title: '3025 错误快速放弃阈值',
        module: 'position_monitor.py',
        detail: `合约模拟失败（3025）属于不可自愈错误（代币限制/貔貅），原需累计20次才放弃。
修复：新增 SELL_ABANDON_SIMULATE_FAIL=5，3025 错误累计5次即放弃关仓。`,
        impact: 'medium',
      },
      {
        type: 'feat',
        title: 'AI 对话助手',
        module: 'routers/ai_chat.py, AiChat.jsx',
        detail: `实时日志下方新增 AI 对话面板。
支持：OpenAI / Claude / DeepSeek / Google Gemini / 自定义接口。
自动注入当前持仓、交易统计、配置信息作为系统上下文。`,
        impact: 'medium',
      },
      {
        type: 'feat',
        title: '交易统计时段筛选器',
        module: 'trades.py, App.jsx',
        detail: `4个统计卡片新增时段选择：小时/天/周/月/年/全。
后端增加 period 过滤参数，前端 PeriodBadge 组件各时段独立颜色。
新增统计字段：avg_win/loss、max_win/loss、profit_factor、连胜/连败。`,
        impact: 'medium',
      },
      {
        type: 'feat',
        title: '统计卡片内容丰富',
        module: 'App.jsx',
        detail: '胜/负卡片增加胜率进度条、盈利因子、连胜连败。持仓卡片增加迷你盈亏柱、链分布。Gas卡片增加折线图、效率对比。',
        impact: 'low',
      },
      {
        type: 'feat',
        title: '头部实时资产展示',
        module: 'App.jsx → HeaderStats',
        detail: '顶部 header 直接展示各链（SOL/BSC/ETH/XLAYER）主币和 USDT 余额，15秒自动刷新，数字动效。',
        impact: 'low',
      },
      {
        type: 'feat',
        title: '交易音效提示',
        module: 'App.jsx',
        detail: '三种提示音（新信号/买入/卖出），Web Audio API 合成无需音频文件，右上角一键静音，localStorage 持久化。',
        impact: 'low',
      },
    ],
  },
]

const TYPE_CFG = {
  fix:  { label: 'Bug 修复', color: 'text-red-400',    bg: 'bg-red-900/20 border-red-800/40' },
  feat: { label: '新功能',   color: 'text-accent-blue', bg: 'bg-blue-900/20 border-blue-800/40' },
  perf: { label: '性能优化', color: 'text-yellow-400',  bg: 'bg-yellow-900/20 border-yellow-800/40' },
  chore:{ label: '维护',     color: 'text-gray-400',    bg: 'bg-dark-700/40 border-dark-500' },
}

const IMPACT_CFG = {
  high:   { label: '高影响', dot: 'bg-red-400' },
  medium: { label: '中影响', dot: 'bg-yellow-400' },
  low:    { label: '低影响', dot: 'bg-green-400' },
}

function EntryCard({ entry }) {
  const [open, setOpen] = useState(false)
  const t = TYPE_CFG[entry.type] || TYPE_CFG.chore
  const imp = IMPACT_CFG[entry.impact] || IMPACT_CFG.low

  return (
    <div className={clsx('border rounded-lg overflow-hidden', t.bg)}>
      <button
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded border', t.color, t.bg)}>
            {t.label}
          </span>
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', imp.dot)} title={imp.label} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-200 leading-snug">{entry.title}</div>
          <div className="text-[10px] text-gray-600 font-mono mt-0.5">{entry.module}</div>
        </div>
        <span className={clsx('text-gray-600 text-xs transition-transform shrink-0 mt-0.5', open ? 'rotate-180' : '')}>▼</span>
      </button>
      {open && entry.detail && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5">
          <p className="text-[11px] text-gray-400 leading-relaxed whitespace-pre-line">{entry.detail}</p>
        </div>
      )}
    </div>
  )
}

export default function Changelog() {
  const [filter, setFilter] = useState('all')

  const filters = [
    { key: 'all',   label: '全部' },
    { key: 'fix',   label: 'Bug 修复' },
    { key: 'feat',  label: '新功能' },
    { key: 'perf',  label: '性能' },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      {/* 顶部说明 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">变更日志</h2>
          <p className="text-xs text-gray-500 mt-0.5">记录每次功能新增、Bug 修复、优化改进</p>
        </div>
        {/* 筛选 */}
        <div className="flex gap-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={clsx(
                'px-2.5 py-1 text-[11px] rounded border transition-colors',
                filter === f.key
                  ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10'
                  : 'border-dark-500 text-gray-500 hover:text-gray-300'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 版本列表 */}
      {CHANGELOG.map(release => {
        const filtered = filter === 'all'
          ? release.entries
          : release.entries.filter(e => e.type === filter)
        if (!filtered.length) return null
        return (
          <div key={release.version}>
            {/* 版本标题 */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-accent-blue bg-accent-blue/10 border border-accent-blue/30 px-2 py-0.5 rounded">
                {release.version}
              </span>
              <span className="text-xs text-gray-500">{release.date}</span>
              <div className="flex-1 h-px bg-dark-600" />
              <span className="text-[10px] text-gray-600">{filtered.length} 项变更</span>
            </div>
            {/* 条目 */}
            <div className="space-y-1.5">
              {filtered.map((entry, i) => (
                <EntryCard key={i} entry={entry} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
