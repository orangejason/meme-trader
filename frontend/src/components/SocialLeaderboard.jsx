import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import FollowModal from './FollowModal'
import CallerDetailPage from './CallerDetailPage'

const API_URL = '/api/analytics/leaderboard_proxy'
const HISTORY_URL = '/api/analytics/leaderboard_history'

const CHAIN_CFG = {
  bsc:     { label: 'BSC',  color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  solana:  { label: 'SOL',  color: 'text-purple-400 bg-purple-900/20 border-purple-700/30' },
  eth:     { label: 'ETH',  color: 'text-blue-400 bg-blue-900/20 border-blue-700/30' },
  base:    { label: 'BASE', color: 'text-sky-400 bg-sky-900/20 border-sky-700/30' },
  unknown: { label: '?',    color: 'text-gray-500 bg-dark-700/20 border-dark-500' },
}

// 简单字符串 hash → 数字
function strHash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return Math.abs(h)
}

// 5×5 像素风 Identicon（类 GitHub）
function Identicon({ seed, size = 36 }) {
  const grid = useMemo(() => {
    const h = strHash(seed || '?')
    // 用 hash 派生颜色（HSL，饱和度/亮度固定范围保证可见）
    const hue = h % 360
    const sat = 55 + (h >> 8) % 30   // 55–84
    const lit = 45 + (h >> 16) % 20  // 45–64
    const color = `hsl(${hue},${sat}%,${lit}%)`
    const bg = `hsl(${hue},15%,14%)`
    // 5×5 格子，左右镜像（只用左侧3列 hash 决定是否填充）
    const cells = []
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const bit = (h >> (row * 3 + col)) & 1
        cells.push({ row, col, filled: bit === 1 })
        if (col < 2) cells.push({ row, col: 4 - col, filled: bit === 1 })
      }
    }
    return { cells, color, bg }
  }, [seed])

  const cell = size / 5
  return (
    <svg width={size} height={size} style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}>
      <rect width={size} height={size} fill={grid.bg} />
      {grid.cells.map((c, i) => c.filled && (
        <rect key={i}
          x={c.col * cell} y={c.row * cell}
          width={cell} height={cell}
          fill={grid.color} />
      ))}
    </svg>
  )
}

// 7日收益率曲线 SVG
function Sparkline({ points }) {
  // points: [{date, avg_mult}, ...]，最多7个
  if (!points || points.length < 2) {
    return <span className="text-gray-600 text-xs">—</span>
  }
  const vals = points.map(p => p.avg_mult * 100)  // avg_mult 本身就是收益率倍数（如1.69=169%）
  const min = Math.min(...vals, 0)
  const max = Math.max(...vals, 0)
  const range = max - min || 1
  const W = 64, H = 28, pad = 3
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v - min) / range) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last = vals[vals.length - 1]
  const first = vals[0]
  const up = last >= first
  // 零基准线 y 坐标
  const zeroY = H - pad - ((0 - min) / range) * (H - pad * 2)
  return (
    <svg width={W} height={H} className="overflow-visible">
      <line x1={pad} y1={zeroY.toFixed(1)} x2={W - pad} y2={zeroY.toFixed(1)}
        stroke="#374151" strokeWidth="0.5" strokeDasharray="2,2" />
      <polyline points={pts} fill="none"
        stroke={up ? '#4ade80' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(pad + (vals.length - 1) / (vals.length - 1) * (W - pad * 2)).toFixed(1)}
        cy={pts.split(' ').pop().split(',')[1]}
        r="2" fill={up ? '#4ade80' : '#f87171'} />
    </svg>
  )
}

// 7日收益率单元格
function SevenDayReturn({ history }) {
  if (!history || history.length === 0) {
    return <span className="text-gray-600 text-xs">暂无</span>
  }
  // 用最近7条（可能不满7条）
  const recent = history.slice(-7)
  // avg_mult = total_multiplier/ca_count，本身就是百分比收益率（如1.69=169%）
  // 7日收益率取各日均值
  const avgPct = recent.reduce((acc, d) => acc + d.avg_mult * 100, 0) / recent.length
  const color = avgPct >= 100 ? 'text-yellow-300' : avgPct >= 30 ? 'text-green-400' : avgPct >= 0 ? 'text-green-600' : 'text-red-400'
  return (
    <div className="text-center">
      <div className={clsx('text-base font-bold tabular-nums font-mono', color)}>
        {avgPct >= 0 ? '+' : ''}{avgPct.toFixed(1)}%
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{recent.length}日均值</div>
    </div>
  )
}

function parseRate(s) {
  if (!s) return 0
  return parseFloat(String(s).replace('%', '')) || 0
}

function getGrade(wr, calls) {
  if (wr >= 70 && calls >= 20) return 'S'
  if (wr >= 60) return 'A'
  if (wr >= 45) return 'B'
  return 'C'
}

const GRADE_COLOR = {
  S: 'text-yellow-300 bg-yellow-900/30 border-yellow-600/40',
  A: 'text-green-300 bg-green-900/30 border-green-600/40',
  B: 'text-blue-300  bg-blue-900/30  border-blue-600/40',
  C: 'text-gray-400  bg-dark-700/30  border-dark-500',
}

// 胜率进度条
function WinRateBar({ rate, today }) {
  const color = rate >= 60 ? 'bg-green-500' : rate >= 45 ? 'bg-yellow-500' : 'bg-red-500'
  const todayColor = today >= 60 ? 'text-green-400' : today >= 45 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="flex flex-col gap-1 min-w-[80px]">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full', color)} style={{ width: `${Math.min(rate, 100)}%` }} />
        </div>
        <span className={clsx('text-sm font-bold tabular-nums', rate >= 60 ? 'text-green-400' : rate >= 45 ? 'text-yellow-400' : 'text-red-400')}>
          {rate.toFixed(0)}%
        </span>
      </div>
      <div className="text-xs text-gray-500">
        今日 <span className={clsx('font-mono font-medium', todayColor)}>{today.toFixed(0)}%</span>
      </div>
    </div>
  )
}

// 最近代币 chips（含单币涨幅）
function RecentTokens({ records }) {
  if (!records?.length) return <span className="text-gray-600 text-sm">—</span>
  const seen = new Set()
  const unique = records.filter(r => {
    const k = r.token
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 4)

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {unique.map((r, i) => {
        const mult = r.multiplier ?? 0
        const pct = mult * 100
        const pctColor = pct >= 100 ? 'text-yellow-300' : pct >= 20 ? 'text-green-400' : pct >= 0 ? 'text-green-600' : 'text-red-400'
        return (
          <div key={i} className="flex items-center gap-1 bg-dark-700/40 rounded px-1.5 py-0.5">
            <span className="text-xs text-gray-300 font-mono max-w-[56px] truncate">{r.symbol || r.token?.slice(0, 6)}</span>
            <span className={clsx('text-xs font-bold font-mono', pctColor)}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}

// 展开面板
function ExpandedPanel({ item }) {
  const todayWr = parseRate(item.today_win_rate)

  return (
    <div className="px-5 py-4 bg-dark-800/70 border-t border-dark-700/40 space-y-4">
      {/* 今日喊单代币列表 */}
      {item.records?.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">今日喊单代币（{item.records.length} 条）</div>
          <div className="flex flex-wrap gap-2">
            {item.records.map((r, i) => {
              const chain = CHAIN_CFG[(r.chain || '').toLowerCase()] || CHAIN_CFG.unknown
              return (
                <div key={i} className="flex items-center gap-1.5 bg-dark-700/60 border border-dark-600 rounded px-2 py-1">
                  <span className={clsx('text-xs font-bold px-1.5 rounded border', chain.color)}>{chain.label}</span>
                  <span className="text-xs text-gray-300 font-mono max-w-[80px] truncate" title={r.token}>{r.symbol || r.token?.slice(0, 8)}</span>
                  <span className="text-xs text-gray-600 font-mono">{r.token?.slice(-4)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 统计对比 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-dark-700/40 rounded-lg px-3 py-2.5">
          <div className="text-xs text-gray-500 mb-2 font-medium">今日表现</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <span className="text-gray-400">喊单 <span className="text-gray-200 font-medium">{item.ca_count}</span></span>
            <span className="text-gray-400">涨幅达标 <span className="text-green-400 font-medium">{item.rise_count}</span></span>
            <span className="text-gray-400">盈利 <span className="text-green-400 font-medium">{item.win_count}</span></span>
            <span className="text-gray-400">今日胜率 <span className={clsx('font-medium', todayWr >= 60 ? 'text-green-400' : todayWr >= 45 ? 'text-yellow-400' : 'text-red-400')}>{item.today_win_rate}</span></span>
          </div>
        </div>
        <div className="bg-dark-700/40 rounded-lg px-3 py-2.5">
          <div className="text-xs text-gray-500 mb-2 font-medium">历史战绩</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <span className="text-gray-400">总喊单 <span className="text-gray-200 font-medium">{item.total_ca_count}</span></span>
            <span className="text-gray-400">盈利 <span className="text-green-400 font-medium">{item.total_win_count}</span></span>
            <span className="text-gray-400">胜率 <span className="text-accent-blue font-medium">{item.win_rate}</span></span>
            <span className="text-gray-400">总倍数 <span className="text-yellow-300 font-medium">{item.total_multiplier?.toFixed(2)}x</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PersonRow({ item, expanded, onToggle, history, onFollowClick, onDetailClick, isFollowing }) {
  const totalWr = parseRate(item.win_rate)
  const todayWr = parseRate(item.today_win_rate)
  const g = getGrade(totalWr, item.total_ca_count)
  const todayMult = item.total_multiplier || 0
  const sevenMult = item.total_multiplier_7d || 0
  const avgTodayPct = item.ca_count > 0 ? (todayMult / item.ca_count) * 100 : null

  const rank = item.rank
  const rankNode = rank <= 3
    ? <span className="text-lg">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
    : <span className="text-sm text-gray-500 tabular-nums font-medium">{rank}</span>

  // ── 移动端卡片布局 ────────────────────────────────────────────
  const pctColor = avgTodayPct === null ? 'text-gray-600'
    : avgTodayPct >= 50 ? 'text-yellow-300' : avgTodayPct >= 20 ? 'text-green-400'
    : avgTodayPct >= 0 ? 'text-green-600' : 'text-red-400'
  const wrColor    = totalWr >= 60 ? 'text-green-400' : totalWr >= 45 ? 'text-yellow-400' : 'text-red-400'
  const wrBarColor = totalWr >= 60 ? 'bg-green-500'   : totalWr >= 45 ? 'bg-yellow-500'   : 'bg-red-500'

  const MobileCard = () => (
    <div
      className={clsx('border-b border-dark-700/50 px-3 py-3', expanded ? 'bg-dark-700/30' : 'active:bg-white/[0.025]')}
      onClick={() => onDetailClick(item)}
    >
      <div className="flex items-center gap-2.5">
        {/* 排名 */}
        <div className="w-5 text-center shrink-0 text-sm text-gray-500 tabular-nums">
          {rank <= 3 ? <span className="text-base">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span> : rank}
        </div>

        {/* 头像 */}
        <Identicon seed={item.qy_wxid} size={36} />

        {/* 中间主信息 */}
        <div className="flex-1 min-w-0">
          {/* 名字 + 等级 */}
          <div className="flex items-center gap-1 mb-1.5">
            <span className={clsx('text-[10px] font-bold px-1 py-px rounded border leading-none shrink-0', GRADE_COLOR[g])}>{g}</span>
            <span className="text-sm font-semibold text-gray-100 truncate">{item.name || '匿名'}</span>
          </div>
          {/* 胜率进度条 */}
          <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 bg-dark-600 rounded-full overflow-hidden shrink-0">
              <div className={clsx('h-full rounded-full', wrBarColor)} style={{ width: `${Math.min(totalWr, 100)}%` }} />
            </div>
            <span className={clsx('text-xs font-bold tabular-nums shrink-0', wrColor)}>{totalWr.toFixed(0)}%</span>
            <span className="text-[11px] text-gray-500 shrink-0">今{todayWr.toFixed(0)}%</span>
          </div>
        </div>

        {/* 右侧：收益率 + 喊单数 + 按钮（垂直堆叠） */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* 今日收益率 */}
          <span className={clsx('text-base font-bold tabular-nums font-mono leading-none', pctColor)}>
            {avgTodayPct !== null ? `${avgTodayPct >= 0 ? '+' : ''}${avgTodayPct.toFixed(1)}%` : '—'}
          </span>
          {/* 喊单数 */}
          <span className="text-[11px] text-gray-500 leading-none">
            {item.ca_count}单 涨{item.rise_count}/赢{item.win_count}
          </span>
          {/* 跟单按钮 */}
          <div onClick={e => e.stopPropagation()}>
            {isFollowing ? (
              <button onClick={() => onFollowClick(item)}
                className={clsx('text-[11px] px-2 py-0.5 rounded border font-medium',
                  isFollowing.enabled
                    ? 'border-green-600/50 text-green-400 bg-green-900/20'
                    : 'border-gray-600/40 text-gray-500'
                )}>
                {isFollowing.enabled ? '✓跟单' : '⏸暂停'}
              </button>
            ) : (
              <button onClick={() => onFollowClick(item)}
                className="text-[11px] px-2 py-0.5 rounded border border-accent-blue/40 text-accent-blue bg-accent-blue/10 font-medium">
                +跟单
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && <div className="mt-2 -mx-3"><ExpandedPanel item={item} /></div>}
    </div>
  )

  // ── 桌面端表格行 ──────────────────────────────────────────────
  return (
    <>
      {/* 移动端卡片 */}
      <tr className="md:hidden">
        <td colSpan={14} className="p-0">
          <MobileCard />
        </td>
      </tr>

      {/* 桌面端表格行 */}
      <tr className={clsx('hidden md:table-row border-b border-dark-700/40 transition-colors cursor-pointer', expanded ? 'bg-dark-700/30' : 'hover:bg-white/[0.025]')} onClick={() => onDetailClick(item)}>
        <td className="pl-4 pr-2 py-4 w-12 text-center">{rankNode}</td>
        <td className="px-3 py-4 min-w-[150px]">
          <div className="flex items-center gap-2.5">
            <Identicon seed={item.qy_wxid} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={clsx('text-xs font-bold px-1.5 py-0.5 rounded border', GRADE_COLOR[g])}>{g}</span>
                <span className="text-sm text-gray-200 font-medium truncate max-w-[110px]" title={item.name}>
                  {item.name || <span className="text-gray-500">匿名</span>}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">历史 {item.total_ca_count} 单</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-4 w-28 text-center">
          {avgTodayPct === null ? <span className="text-gray-600 text-sm">—</span> : (() => {
            const color = avgTodayPct >= 50 ? 'text-yellow-300' : avgTodayPct >= 20 ? 'text-green-400' : avgTodayPct >= 0 ? 'text-green-600' : 'text-red-400'
            return (
              <div>
                <div className={clsx('text-base font-bold tabular-nums font-mono', color)}>{avgTodayPct >= 0 ? '+' : ''}{avgTodayPct.toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mt-0.5">均 {item.ca_count} 单</div>
              </div>
            )
          })()}
        </td>
        <td className="px-3 py-4 w-28 text-center hidden lg:table-cell">
          {sevenMult > 0 ? (() => {
            const color = sevenMult >= 50 ? 'text-yellow-300' : sevenMult >= 20 ? 'text-green-400' : 'text-green-600'
            return (
              <div>
                <div className={clsx('text-base font-bold tabular-nums font-mono', color)}>+{sevenMult.toFixed(1)}x</div>
                <div className="text-xs text-gray-500 mt-0.5">7日累计</div>
              </div>
            )
          })() : <SevenDayReturn history={history} />}
        </td>
        <td className="px-3 py-4 w-20 hidden lg:table-cell"><Sparkline points={history} /></td>
        <td className="px-3 py-4 w-28 text-center">
          <div className="text-base font-bold tabular-nums text-gray-200">{item.ca_count}</div>
          <div className="text-xs text-gray-500 mt-0.5">涨 <span className="text-green-400 font-medium">{item.rise_count}</span> / 赢 <span className="text-green-400 font-medium">{item.win_count}</span></div>
        </td>
        <td className="px-3 py-4 w-24 text-center hidden sm:table-cell">
          <div className="text-base font-bold tabular-nums text-gray-300">{item.total_ca_count}</div>
          <div className="text-xs text-gray-500 mt-0.5">赢 <span className="font-medium">{item.total_win_count}</span></div>
        </td>
        <td className="px-3 py-4 w-32"><WinRateBar rate={totalWr} today={todayWr} /></td>
        <td className="px-3 py-4 w-24 text-center">
          {(() => {
            const color = todayMult >= 10 ? 'text-yellow-300' : todayMult >= 5 ? 'text-green-400' : todayMult >= 2 ? 'text-blue-400' : 'text-gray-500'
            return (
              <div>
                <span className={clsx('text-base font-bold tabular-nums font-mono', color)}>{todayMult >= 0.01 ? `${todayMult.toFixed(2)}x` : '—'}</span>
                <div className="text-xs text-gray-500 mt-0.5">今日累计</div>
              </div>
            )
          })()}
        </td>
        <td className="px-3 py-4 hidden md:table-cell"><RecentTokens records={item.records} /></td>
        <td className="px-3 py-4 w-28 text-center hidden sm:table-cell">
          {(() => {
            const times = (item.records || []).map(r => r.call_time).filter(Boolean)
            if (!times.length) return <span className="text-gray-600 text-sm">—</span>
            const latest = new Date(Math.max(...times.map(t => new Date(t).getTime())))
            const diff = Date.now() - latest.getTime()
            const mins = Math.floor(diff / 60000)
            const hours = Math.floor(mins / 60)
            let ago = mins < 1 ? '刚刚' : mins < 60 ? `${mins}分前` : hours < 24 ? `${hours}小时前` : `${Math.floor(hours/24)}天前`
            const timeStr = latest.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
            return <div><div className="text-sm font-medium text-gray-300 tabular-nums">{timeStr}</div><div className="text-xs text-gray-500 mt-0.5">{ago}</div></div>
          })()}
        </td>
        <td className="px-2 py-4 w-36" onClick={e => e.stopPropagation()}>
          {(() => {
            const fs = item.follow_stats
            if (!fs) return <span className="text-gray-700 text-xs">—</span>
            const pnl = fs.total_pnl_usdt
            const pnlColor = pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-500'
            return (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-accent-blue font-medium">🔗 {fs.follow_count}次</span>
                  {fs.win_rate != null && <span className={clsx('text-xs font-medium', fs.win_rate >= 60 ? 'text-green-400' : fs.win_rate >= 40 ? 'text-yellow-400' : 'text-red-400')}>胜{fs.win_rate.toFixed(0)}%</span>}
                  {fs.open_count > 0 && <span className="text-xs text-yellow-400/80">持{fs.open_count}</span>}
                </div>
                <div className={clsx('text-xs font-mono font-medium', pnlColor)}>{pnl > 0 ? '+' : ''}{pnl.toFixed(2)}U</div>
              </div>
            )
          })()}
        </td>
        <td className="px-2 py-4 w-20 text-center" onClick={e => e.stopPropagation()}>
          {isFollowing ? (
            <button onClick={() => onFollowClick(item)} className={clsx('text-xs px-2.5 py-1.5 rounded border transition-colors whitespace-nowrap font-medium', isFollowing.enabled ? 'border-green-600/50 text-green-400 bg-green-900/20 hover:bg-green-900/40' : 'border-gray-600/50 text-gray-500 bg-dark-700/20 hover:bg-dark-700/40')}>
              {isFollowing.enabled ? '✓ 跟单中' : '⏸ 已暂停'}
            </button>
          ) : (
            <button onClick={() => onFollowClick(item)} className="text-xs px-2.5 py-1.5 rounded border border-accent-blue/40 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20 hover:border-accent-blue/70 transition-colors whitespace-nowrap font-medium">
              + 跟单
            </button>
          )}
        </td>
        <td className="pr-3 py-4 w-6 text-center" onClick={e => { e.stopPropagation(); onToggle() }}>
          <span className={clsx('text-gray-500 text-xs transition-transform inline-block', expanded && 'rotate-180')}>▼</span>
        </td>
      </tr>

      {expanded && (
        <tr className="hidden md:table-row border-b border-dark-700/40">
          <td colSpan={13}><ExpandedPanel item={item} /></td>
        </tr>
      )}
    </>
  )
}

export default function SocialLeaderboard() {
  const [data, setData]           = useState([])
  const [history, setHistory]     = useState({})
  const [followMap, setFollowMap] = useState({})  // wxid → follow config
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [threshold, setThreshold] = useState(0.2)
  const [expanded, setExpanded]   = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [detailCaller, setDetailCaller] = useState(null)
  const [followTarget, setFollowTarget] = useState(null)
  const [sortKey, setSortKey] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')
  const [batchFollowEnabled, setBatchFollowEnabled] = useState(false)
  const [batchFollowing, setBatchFollowing] = useState(false)
  const [batchResult, setBatchResult] = useState(null)  // {added, skipped} | null
  const [batchConfigOpen, setBatchConfigOpen] = useState(false)
  const [batchDefaults, setBatchDefaults] = useState({
    buy_amount: '0.1',
    take_profit: '50',
    stop_loss: '30',
    max_hold_min: '60',
  })

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'last_call' ? 'desc' : 'desc') // 时间默认最新在前，其余默认降序
    }
  }

  const sortedData = [...data].sort((a, b) => {
    let av, bv
    switch (sortKey) {
      case 'rank':         av = a.rank; bv = b.rank; break
      case 'today_pct':    av = a.ca_count > 0 ? a.total_multiplier / a.ca_count : 0; bv = b.ca_count > 0 ? b.total_multiplier / b.ca_count : 0; break
      case 'seven_mult':   av = a.total_multiplier_7d || 0; bv = b.total_multiplier_7d || 0; break
      case 'ca_count':     av = a.ca_count; bv = b.ca_count; break
      case 'total_ca':     av = a.total_ca_count; bv = b.total_ca_count; break
      case 'win_rate':     av = parseFloat(a.win_rate) || 0; bv = parseFloat(b.win_rate) || 0; break
      case 'today_wr':     av = parseFloat(a.today_win_rate) || 0; bv = parseFloat(b.today_win_rate) || 0; break
      case 'total_mult':   av = a.total_multiplier || 0; bv = b.total_multiplier || 0; break
      case 'last_call': {
        const getLatest = (item) => {
          const times = (item.records || []).map(r => r.call_time).filter(Boolean)
          return times.length ? Math.max(...times.map(t => new Date(t).getTime())) : 0
        }
        av = getLatest(a); bv = getLatest(b); break
      }
      default: av = a.rank; bv = b.rank
    }
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}?rise_threshold=${threshold}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      if (json.status !== 'success') throw new Error('API error')
      setData(json.data || [])
      setLastUpdate(Date.now())
      setError(null)
      // 同步拉历史 + 跟单列表
      const [hr, fr] = await Promise.all([
        fetch(HISTORY_URL),
        fetch('/api/analytics/follow_traders'),
      ])
      if (hr.ok) setHistory(await hr.json())
      if (fr.ok) {
        const follows = await fr.json()
        const map = {}
        follows.forEach(f => { map[f.wxid] = f })
        setFollowMap(map)
      }
      // 读取配置（一键跟单开关）
      try {
        const cfgR = await fetch('/api/config')
        if (cfgR.ok) {
          const cfg = await cfgR.json()
          setBatchFollowEnabled(cfg.leaderboard_batch_follow_enabled === 'true')
        }
      } catch (_) {}
    } catch (e) {
      setError('数据加载失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [threshold])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])
  useEffect(() => {
    const t = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchData])

  const handleBatchFollow = async (defaults) => {
    if (!data.length || batchFollowing) return
    setBatchConfigOpen(false)
    setBatchFollowing(true)
    setBatchResult(null)
    try {
      const traders = data
        .filter(item => item.qy_wxid)
        .map(item => ({ wxid: item.qy_wxid, name: item.name || '' }))
      const r = await fetch('/api/analytics/follow_traders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traders, defaults }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const result = await r.json()
      setBatchResult({ added: result.added, updated: result.updated })
      // 刷新跟单列表
      const fr = await fetch('/api/analytics/follow_traders')
      if (fr.ok) {
        const follows = await fr.json()
        const map = {}
        follows.forEach(f => { map[f.wxid] = f })
        setFollowMap(map)
      }
    } catch (e) {
      setBatchResult({ error: e.message })
    } finally {
      setBatchFollowing(false)
    }
  }

  const THRESHOLD_OPTS = [
    { key: 0.1,  label: '≥10%' },
    { key: 0.2,  label: '≥20%' },
    { key: 0.5,  label: '≥50%' },
    { key: 1.0,  label: '≥100%' },
    { key: 2.0,  label: '≥200%' },
  ]

  return (
    <div className="space-y-3">
      {/* 详情页覆盖 */}
      {detailCaller && (
        <CallerDetailPage
          item={detailCaller}
          history={history[detailCaller.qy_wxid] || []}
          onBack={() => setDetailCaller(null)}
          onFollowClick={() => { setFollowTarget(detailCaller) }}
        />
      )}

      {/* 跟单弹窗 */}
      {followTarget && (
        <FollowModal
          item={followTarget}
          onClose={() => setFollowTarget(null)}
          onSaved={() => { setFollowTarget(null); fetchData() }}
        />
      )}

      {/* 一键跟单配置弹窗 */}
      {batchConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-sm mx-4 shadow-2xl">
            <div className="px-5 py-4 border-b border-dark-600">
              <h3 className="text-sm font-semibold text-gray-200">⚡ 一键跟单参数</h3>
              <p className="text-xs text-gray-500 mt-0.5">将对榜单上 {data.filter(d => d.qy_wxid).length} 位喊单人设置跟单，已有配置的跳过</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">跟单金额 (USDT)</label>
                <input
                  type="number" min="0.01" step="0.01"
                  value={batchDefaults.buy_amount}
                  onChange={e => setBatchDefaults(p => ({ ...p, buy_amount: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">止盈 (%)</label>
                  <input
                    type="number" min="1" step="1"
                    value={batchDefaults.take_profit}
                    onChange={e => setBatchDefaults(p => ({ ...p, take_profit: e.target.value }))}
                    className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">止损 (%)</label>
                  <input
                    type="number" min="1" step="1"
                    value={batchDefaults.stop_loss}
                    onChange={e => setBatchDefaults(p => ({ ...p, stop_loss: e.target.value }))}
                    className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">最长持仓时间 (分钟)</label>
                <input
                  type="number" min="1" step="1"
                  value={batchDefaults.max_hold_min}
                  onChange={e => setBatchDefaults(p => ({ ...p, max_hold_min: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-dark-600 flex gap-3 justify-end">
              <button
                onClick={() => setBatchConfigOpen(false)}
                className="text-xs px-4 py-2 rounded border border-dark-500 text-gray-400 hover:text-gray-200 transition-colors"
              >取消</button>
              <button
                onClick={() => handleBatchFollow({
                  buy_amount: parseFloat(batchDefaults.buy_amount) || 0.1,
                  take_profit: parseFloat(batchDefaults.take_profit) || 50,
                  stop_loss: parseFloat(batchDefaults.stop_loss) || 30,
                  max_hold_min: parseInt(batchDefaults.max_hold_min) || 60,
                })}
                className="text-xs px-4 py-2 rounded border border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20 font-medium transition-colors"
              >确认跟单</button>
            </div>
          </div>
        </div>
      )}

      {detailCaller ? null : (
        <>
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-200">社群牛人榜</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            今日微信社群喊单达人 · 实时排行
            {lastUpdate && (
              <span className="ml-2">
                更新于 {new Date(lastUpdate).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {batchFollowEnabled && (
            <button
              onClick={() => { setBatchConfigOpen(true); setBatchResult(null) }}
              disabled={batchFollowing || loading}
              className={clsx(
                'text-xs px-3 py-1 rounded border transition-colors font-medium',
                batchFollowing
                  ? 'border-dark-500 text-gray-600 cursor-not-allowed'
                  : 'border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20'
              )}
            >
              {batchFollowing ? '跟单中…' : '⚡ 一键跟单'}
            </button>
          )}
          <button
            onClick={() => { setLoading(true); fetchData() }}
            className="text-xs text-gray-500 hover:text-gray-300 border border-dark-600 hover:border-dark-500 px-2.5 py-1 rounded transition-colors"
          >↻ 刷新</button>
        </div>
      </div>

      {/* 一键跟单结果提示 */}
      {batchResult && (
        <div className={clsx(
          'text-xs px-3 py-2 rounded border',
          batchResult.error
            ? 'bg-red-900/20 border-red-700/30 text-red-400'
            : 'bg-green-900/20 border-green-700/30 text-green-400'
        )}>
          {batchResult.error
            ? `一键跟单失败：${batchResult.error}`
            : `一键跟单完成：新增 ${batchResult.added} 人，更新参数 ${batchResult.updated} 人`
          }
          <button onClick={() => setBatchResult(null)} className="ml-3 text-gray-500 hover:text-gray-300">✕</button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-dark-600 bg-dark-800/40 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">涨幅门槛</span>
          <div className="flex gap-1">
            {THRESHOLD_OPTS.map(o => (
              <button key={o.key} onClick={() => setThreshold(o.key)}
                className={clsx('px-2.5 py-1 text-xs rounded border transition-colors',
                  threshold === o.key
                    ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10'
                    : 'border-dark-600 text-gray-500 hover:text-gray-300 hover:border-dark-500'
                )}>{o.label}</button>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-600 ml-auto">代币涨幅超过门槛才算"达标"</div>
      </div>

      {/* 表格 */}
      <div className="border border-dark-600 rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-gray-500 text-sm">加载中...</div>
        ) : error ? (
          <div className="py-20 text-center text-red-500 text-sm">{error}</div>
        ) : data.length === 0 ? (
          <div className="py-20 text-center text-gray-500 text-sm">暂无数据</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-800/60">
                {[
                  { key: 'rank',       label: '#',       cls: 'pl-4 pr-2 w-12 text-center' },
                  { key: null,         label: '喊单人',   cls: 'px-3 text-left' },
                  { key: 'today_pct',  label: '今日收益率', cls: 'px-3 w-28 text-center' },
                  { key: 'seven_mult', label: '7日收益率', cls: 'px-3 w-28 text-center hidden lg:table-cell' },
                  { key: null,         label: '曲线',     cls: 'px-3 w-20 hidden lg:table-cell' },
                  { key: 'ca_count',   label: '今日喊单', cls: 'px-3 w-28 text-center' },
                  { key: 'total_ca',   label: '总喊单',   cls: 'px-3 w-24 text-center hidden sm:table-cell' },
                  { key: 'win_rate',   label: '胜率',     cls: 'px-3 w-32' },
                  { key: 'total_mult', label: '今日累计倍数', cls: 'px-3 w-24 text-center' },
                  { key: null,         label: '最近代币', cls: 'px-3 hidden md:table-cell' },
                  { key: 'last_call',  label: '最后喊单', cls: 'px-3 w-28 text-center hidden sm:table-cell' },
                  { key: null,         label: '跟单战绩', cls: 'px-2 w-36' },
                  { key: null,         label: '操作',     cls: 'px-2 w-20 text-center' },
                  { key: null,         label: '',         cls: 'w-6' },
                ].map(({ key, label, cls }, i) => (
                  <th key={i} className={clsx('py-3 text-xs font-medium', cls,
                    key ? 'cursor-pointer select-none text-gray-400 hover:text-gray-200' : 'text-gray-500'
                  )}
                    onClick={key ? () => handleSort(key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {key && (
                        <span className="text-[10px] leading-none">
                          {sortKey === key ? (sortDir === 'desc' ? '▼' : '▲') : <span className="text-gray-700">⇅</span>}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((item) => (
                <PersonRow
                  key={item.qy_wxid}
                  item={item}
                  history={history[item.qy_wxid] || []}
                  expanded={expanded === item.qy_wxid}
                  onToggle={() => setExpanded(expanded === item.qy_wxid ? null : item.qy_wxid)}
                  onFollowClick={setFollowTarget}
                  onDetailClick={setDetailCaller}
                  isFollowing={followMap[item.qy_wxid] || null}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && data.length > 0 && (
        <p className="text-xs text-gray-600 text-right">
          共 {data.length} 位牛人 · 数据来自微信社群信号平台
        </p>
      )}
        </>
      )}
    </div>
  )
}
