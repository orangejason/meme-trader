import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import FollowModal from './FollowModal'

const API_URL = '/api/analytics/community_leaderboard_proxy'

// ── 工具 ───────────────────────────────────────────────────────────────────────
function strHash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0
  return Math.abs(h)
}

// 匿名化群名：取 qun_id hash 前4位十六进制
function anonName(qun_id) {
  const h = strHash(qun_id || '').toString(16).toUpperCase().padStart(8, '0')
  return `社群·${h.slice(0, 4)}`
}

function Identicon({ seed, size = 36 }) {
  const grid = useMemo(() => {
    const h = strHash(seed || '?')
    const hue = h % 360
    const sat = 55 + (h >> 8) % 30
    const lit = 45 + (h >> 16) % 20
    const color = `hsl(${hue},${sat}%,${lit}%)`
    const bg = `hsl(${hue},15%,14%)`
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
        <rect key={i} x={c.col * cell} y={c.row * cell} width={cell} height={cell} fill={grid.color} />
      ))}
    </svg>
  )
}

// 迷你收益率柱状图（用今日/7日/全部 三段横向对比）
function ReturnSparkline({ today, seven, all }) {
  const vals = [
    { label: '今', v: today?.total_ca > 0 ? today.total_multiplier / today.total_ca : 0 },
    { label: '7日', v: seven?.total_ca > 0 ? seven.total_multiplier / seven.total_ca : 0 },
  ]
  const maxV = Math.max(...vals.map(x => Math.abs(x.v)), 0.01)
  const W = 56, H = 28, barW = 16, gap = 8, pad = 4
  const totalW = vals.length * barW + (vals.length - 1) * gap
  const startX = (W - totalW) / 2
  const zeroY = H - pad
  return (
    <svg width={W} height={H}>
      {vals.map((item, i) => {
        const barH = Math.max(2, (Math.abs(item.v) / maxV) * (H - pad * 2 - 4))
        const x = startX + i * (barW + gap)
        const y = item.v >= 0 ? zeroY - barH : zeroY
        const color = item.v >= 1 ? '#fde047' : item.v >= 0.2 ? '#4ade80' : item.v >= 0 ? '#6ee7b7' : '#f87171'
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx="2" opacity={0.85} />
            <text x={x + barW / 2} y={H} textAnchor="middle" fill="#6b7280" fontSize="7">{item.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// 今日收益率单元格
function TodayReturn({ today }) {
  if (!today?.total_ca) return <span className="text-gray-600 text-xs">—</span>
  const avg = today.total_multiplier / today.total_ca  // 倍数（如1.5 = +150%）
  const pct = avg * 100
  const color = pct >= 100 ? 'text-yellow-300' : pct >= 30 ? 'text-green-400' : pct >= 0 ? 'text-green-600' : 'text-red-400'
  return (
    <div className="text-center">
      <div className={clsx('text-sm font-bold tabular-nums font-mono', color)}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">均 {today.total_ca} 单</div>
    </div>
  )
}

// 7日收益率单元格
function SevenReturn({ seven }) {
  if (!seven?.total_ca) return <span className="text-gray-600 text-xs">—</span>
  const avg = seven.total_multiplier / seven.total_ca
  const pct = avg * 100
  const color = pct >= 100 ? 'text-yellow-300' : pct >= 30 ? 'text-green-400' : pct >= 0 ? 'text-green-600' : 'text-red-400'
  return (
    <div className="text-center">
      <div className={clsx('text-sm font-bold tabular-nums font-mono', color)}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">{seven.total_ca} 单</div>
    </div>
  )
}

// 胜率进度条（all / today / 7day 三行）
function WinRateBlock({ all, today, seven }) {
  const wr = all?.win_rate ?? 0
  const color = wr >= 65 ? 'bg-green-500' : wr >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const textColor = wr >= 65 ? 'text-green-400' : wr >= 50 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-1.5 min-w-[90px]">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-dark-700 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full', color)} style={{ width: `${Math.min(wr, 100)}%` }} />
        </div>
        <span className={clsx('text-sm font-bold tabular-nums w-10 text-right', textColor)}>{wr.toFixed(0)}%</span>
      </div>
      <div className="flex gap-3 text-[11px] text-gray-500">
        <span>今 <span className={today?.win_rate >= 60 ? 'text-green-400' : 'text-gray-400'}>{today?.win_rate?.toFixed(0) ?? '—'}%</span></span>
        <span>7日 <span className={seven?.win_rate >= 60 ? 'text-green-400' : 'text-gray-400'}>{seven?.win_rate?.toFixed(0) ?? '—'}%</span></span>
      </div>
    </div>
  )
}

// 喊单数量格
function CaCountBlock({ today, seven }) {
  return (
    <div className="text-center space-y-0.5">
      <div className="text-sm font-bold text-gray-200">{today?.total_ca ?? 0}</div>
      <div className="text-[10px] text-gray-500">
        赢 <span className="text-green-400">{today?.win_ca ?? 0}</span>
        <span className="mx-1 text-gray-700">·</span>
        7日 {seven?.total_ca ?? 0}
      </div>
    </div>
  )
}

// 总历史格
function HistoryBlock({ all }) {
  return (
    <div className="text-center space-y-0.5">
      <div className="text-sm font-bold text-gray-300">{all?.total_ca ?? 0}</div>
      <div className="text-[10px] text-gray-500">赢 <span className="text-green-400 font-medium">{all?.win_ca ?? 0}</span></div>
    </div>
  )
}

// 跟单战绩格
function FollowStatsCell({ fs }) {
  if (!fs) return <span className="text-gray-700 text-xs">—</span>
  const pnl = fs.total_pnl_usdt
  const pnlColor = pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-500'
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-accent-blue font-medium">🔗 {fs.follow_count}次</span>
        {fs.win_rate != null && (
          <span className={clsx('text-xs font-medium', fs.win_rate >= 60 ? 'text-green-400' : fs.win_rate >= 40 ? 'text-yellow-400' : 'text-red-400')}>
            胜{fs.win_rate.toFixed(0)}%
          </span>
        )}
        {fs.open_count > 0 && <span className="text-xs text-yellow-400/80">持{fs.open_count}</span>}
      </div>
      <div className={clsx('text-xs font-mono font-medium', pnlColor)}>
        {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}U
      </div>
    </div>
  )
}

// 展开详情
function ExpandedPanel({ item }) {
  const { all, today, seven_day } = item
  return (
    <div className="px-5 py-4 bg-dark-800/70 border-t border-dark-700/40">
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div className="bg-dark-700/40 rounded-lg px-3 py-2.5">
          <div className="text-gray-500 font-medium mb-2">今日</div>
          <div className="space-y-1 text-gray-400">
            <div>喊单 <span className="text-gray-200">{today?.total_ca ?? 0}</span> 个</div>
            <div>盈利 <span className="text-green-400">{today?.win_ca ?? 0}</span> 个</div>
            <div>胜率 <span className={today?.win_rate >= 60 ? 'text-green-400 font-medium' : 'text-yellow-400 font-medium'}>{today?.win_rate?.toFixed(1) ?? '0'}%</span></div>
            <div>均涨幅 <span className="text-accent-blue font-medium">
              {today?.total_ca > 0 ? `+${(today.total_multiplier / today.total_ca * 100).toFixed(1)}%` : '—'}
            </span></div>
          </div>
        </div>
        <div className="bg-dark-700/40 rounded-lg px-3 py-2.5">
          <div className="text-gray-500 font-medium mb-2">近7日</div>
          <div className="space-y-1 text-gray-400">
            <div>喊单 <span className="text-gray-200">{seven_day?.total_ca ?? 0}</span> 个</div>
            <div>盈利 <span className="text-green-400">{seven_day?.win_ca ?? 0}</span> 个</div>
            <div>胜率 <span className={seven_day?.win_rate >= 60 ? 'text-green-400 font-medium' : 'text-yellow-400 font-medium'}>{seven_day?.win_rate?.toFixed(1) ?? '0'}%</span></div>
            <div>均涨幅 <span className="text-accent-blue font-medium">
              {seven_day?.total_ca > 0 ? `+${(seven_day.total_multiplier / seven_day.total_ca * 100).toFixed(1)}%` : '—'}
            </span></div>
          </div>
        </div>
        <div className="bg-dark-700/40 rounded-lg px-3 py-2.5">
          <div className="text-gray-500 font-medium mb-2">历史全部</div>
          <div className="space-y-1 text-gray-400">
            <div>喊单 <span className="text-gray-200">{all?.total_ca ?? 0}</span> 个</div>
            <div>盈利 <span className="text-green-400">{all?.win_ca ?? 0}</span> 个</div>
            <div>胜率 <span className={all?.win_rate >= 60 ? 'text-green-400 font-medium' : 'text-yellow-400 font-medium'}>{all?.win_rate?.toFixed(1) ?? '0'}%</span></div>
            <div>均涨幅 <span className="text-accent-blue font-medium">
              {all?.total_ca > 0 ? `+${(all.total_multiplier / all.total_ca * 100).toFixed(1)}%` : '—'}
            </span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommunityRow({ item, rank, expanded, onToggle, onFollowClick, isFollowing }) {
  const { qun_id, all, today, seven_day } = item
  const displayName = anonName(qun_id)
  const wr = all?.win_rate ?? 0
  const todayAvgPct = today?.total_ca > 0 ? (today.total_multiplier / today.total_ca) * 100 : null

  const rankNode = rank <= 3
    ? <span className="text-lg">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
    : <span className="text-sm text-gray-500 tabular-nums font-medium">{rank}</span>

  // ── 移动端卡片 ────────────────────────────────────────────────
  const pctColor = todayAvgPct === null ? 'text-gray-600'
    : todayAvgPct >= 100 ? 'text-yellow-300' : todayAvgPct >= 30 ? 'text-green-400'
    : todayAvgPct >= 0 ? 'text-green-600' : 'text-red-400'
  const wrColor    = wr >= 60 ? 'text-green-400' : wr >= 50 ? 'text-yellow-400' : 'text-red-400'
  const wrBarColor = wr >= 60 ? 'bg-green-500'   : wr >= 50 ? 'bg-yellow-500'   : 'bg-red-500'
  const todayWr    = all?.win_rate ?? 0

  const MobileCard = () => (
    <div
      className={clsx('border-b border-dark-700/50 px-3 py-3', expanded ? 'bg-dark-700/30' : 'active:bg-white/[0.025]')}
      onClick={onToggle}
    >
      <div className="flex items-center gap-2.5">
        {/* 排名 */}
        <div className="w-5 text-center shrink-0 text-sm text-gray-500 tabular-nums">
          {rank <= 3 ? <span className="text-base">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span> : rank}
        </div>

        {/* 头像 */}
        <Identicon seed={qun_id} size={36} />

        {/* 中间：名字 + 胜率条 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-100 font-mono truncate mb-1.5">{displayName}</div>
          <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 bg-dark-600 rounded-full overflow-hidden shrink-0">
              <div className={clsx('h-full rounded-full', wrBarColor)} style={{ width: `${Math.min(wr, 100)}%` }} />
            </div>
            <span className={clsx('text-xs font-bold tabular-nums shrink-0', wrColor)}>{wr.toFixed(0)}%</span>
            <span className="text-[11px] text-gray-500 shrink-0">今{today?.win_rate?.toFixed(0) ?? '—'}%</span>
          </div>
        </div>

        {/* 右侧：收益率 + 喊单数 + 按钮 */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={clsx('text-base font-bold tabular-nums font-mono leading-none', pctColor)}>
            {todayAvgPct !== null ? `${todayAvgPct >= 0 ? '+' : ''}${todayAvgPct.toFixed(1)}%` : '—'}
          </span>
          <span className="text-[11px] text-gray-500 leading-none">
            {today?.total_ca ?? 0}单 赢{today?.win_ca ?? 0}
          </span>
          <div onClick={e => e.stopPropagation()}>
            {isFollowing ? (
              <button onClick={() => onFollowClick(item)}
                className={clsx('text-[11px] px-2 py-0.5 rounded border font-medium',
                  isFollowing.enabled ? 'border-green-600/50 text-green-400 bg-green-900/20' : 'border-gray-600/40 text-gray-500'
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

  return (
    <>
      {/* 移动端卡片 */}
      <tr className="md:hidden">
        <td colSpan={13} className="p-0"><MobileCard /></td>
      </tr>

      {/* 桌面端表格行 */}
      <tr className={clsx('hidden md:table-row border-b border-dark-700/40 transition-colors cursor-pointer', expanded ? 'bg-dark-700/30' : 'hover:bg-white/[0.025]')}
        onClick={onToggle}>
        <td className="pl-4 pr-2 py-3.5 w-12 text-center">{rankNode}</td>
        <td className="px-3 py-3.5 min-w-[140px]">
          <div className="flex items-center gap-2.5">
            <Identicon seed={qun_id} size={34} />
            <div className="min-w-0">
              <div className="text-sm text-gray-200 font-medium font-mono">{displayName}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">历史 {all?.total_ca ?? 0} 单</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3.5 w-28 text-center"><TodayReturn today={today} /></td>
        <td className="px-3 py-3.5 w-28 text-center hidden lg:table-cell"><SevenReturn seven={seven_day} /></td>
        <td className="px-2 py-3.5 w-16 text-center hidden lg:table-cell"><ReturnSparkline today={today} seven={seven_day} all={all} /></td>
        <td className="px-3 py-3.5 w-24 text-center"><CaCountBlock today={today} seven={seven_day} /></td>
        <td className="px-3 py-3.5 w-20 text-center hidden sm:table-cell"><HistoryBlock all={all} /></td>
        <td className="px-3 py-3.5 hidden md:table-cell">
          <div className="flex flex-wrap gap-1">
            {today?.win_ca > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-700/30 font-mono">今赢{today.win_ca}</span>}
            {seven_day?.win_ca > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-700/30 font-mono">7日赢{seven_day.win_ca}</span>}
            {(!today?.win_ca && !seven_day?.win_ca) && <span className="text-gray-700 text-xs">—</span>}
          </div>
        </td>
        <td className="px-3 py-3.5 w-24 text-center hidden sm:table-cell"><span className="text-gray-700 text-xs">—</span></td>
        <td className="px-3 py-3.5 w-40"><WinRateBlock all={all} today={today} seven={seven_day} /></td>
        <td className="px-2 py-3.5 w-36" onClick={e => e.stopPropagation()}><FollowStatsCell fs={item.follow_stats} /></td>
        <td className="px-2 py-3.5 w-28 text-center" onClick={e => e.stopPropagation()}>
          {isFollowing ? (
            <button onClick={() => onFollowClick(item)}
              className={clsx('w-full text-left text-xs px-2.5 py-1.5 rounded border transition-colors font-medium',
                isFollowing.enabled ? 'border-green-600/50 text-green-400 bg-green-900/20 hover:bg-green-900/40' : 'border-gray-600/50 text-gray-500 bg-dark-700/20 hover:bg-dark-700/40'
              )}>
              <div className="whitespace-nowrap">{isFollowing.enabled ? '✓ 跟单中' : '⏸ 已暂停'}</div>
              <div className="text-[10px] mt-0.5 font-normal opacity-80">{isFollowing.buy_amount}U · 盈{isFollowing.take_profit}% 亏{isFollowing.stop_loss}%</div>
            </button>
          ) : (
            <button onClick={() => onFollowClick(item)}
              className="text-xs px-2.5 py-1.5 rounded border border-accent-blue/40 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20 hover:border-accent-blue/70 transition-colors whitespace-nowrap font-medium">
              + 跟单
            </button>
          )}
        </td>
        <td className="pr-3 py-3.5 w-6 text-center">
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

export default function CommunityLeaderboard() {
  const [data, setData] = useState([])
  const [followMap, setFollowMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [threshold, setThreshold] = useState(0.2)
  const [sortBy, setSortBy] = useState('today')
  const [expanded, setExpanded] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [followTarget, setFollowTarget] = useState(null)
  const [localSort, setLocalSort] = useState({ key: 'rank', dir: 'asc' })
  const [batchConfigOpen, setBatchConfigOpen] = useState(false)
  const [batchFollowing, setBatchFollowing] = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [batchDefaults, setBatchDefaults] = useState(() => {
    try {
      const saved = localStorage.getItem('batchFollowDefaults')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { buy_amount: '0.1', take_profit: '50', stop_loss: '30', max_hold_min: '60' }
  })

  const updateBatchDefaults = (updater) => {
    setBatchDefaults(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try { localStorage.setItem('batchFollowDefaults', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}?rise_threshold=${threshold}&sort_by=${sortBy}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      if (json.status === 'error') throw new Error(json.message)
      setData(json.data || [])
      setLastUpdate(Date.now())
      setError(null)
      const fr = await fetch('/api/analytics/follow_traders')
      if (fr.ok) {
        const follows = await fr.json()
        const map = {}
        follows.forEach(f => { map[f.wxid] = f })
        setFollowMap(map)
      }
    } catch (e) {
      setError('数据加载失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [threshold, sortBy])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])
  useEffect(() => {
    const t = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchData])

  const handleLocalSort = (key) => {
    setLocalSort(s => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))
  }

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let av, bv
      switch (localSort.key) {
        case 'rank':        av = a.rank; bv = b.rank; break
        case 'today_ret':   av = a.today?.total_ca > 0 ? a.today.total_multiplier / a.today.total_ca : 0
                            bv = b.today?.total_ca > 0 ? b.today.total_multiplier / b.today.total_ca : 0; break
        case 'seven_ret':   av = a.seven_day?.total_ca > 0 ? a.seven_day.total_multiplier / a.seven_day.total_ca : 0
                            bv = b.seven_day?.total_ca > 0 ? b.seven_day.total_multiplier / b.seven_day.total_ca : 0; break
        case 'win_rate':    av = a.all?.win_rate ?? 0; bv = b.all?.win_rate ?? 0; break
        case 'today_wr':    av = a.today?.win_rate ?? 0; bv = b.today?.win_rate ?? 0; break
        case 'today_ca':    av = a.today?.total_ca ?? 0; bv = b.today?.total_ca ?? 0; break
        case 'total_ca':    av = a.all?.total_ca ?? 0; bv = b.all?.total_ca ?? 0; break
        default: av = a.rank; bv = b.rank
      }
      return localSort.dir === 'asc' ? av - bv : bv - av
    })
  }, [data, localSort])

  const handleBatchFollow = async (defaults) => {
    if (!data.length || batchFollowing) return
    setBatchConfigOpen(false)
    setBatchFollowing(true)
    setBatchResult(null)
    try {
      const traders = data
        .filter(item => item.qun_id)
        .map(item => ({ wxid: item.qun_id, name: anonName(item.qun_id) }))
      const r = await fetch('/api/analytics/follow_traders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traders, defaults }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const result = await r.json()
      setBatchResult({ added: result.added, updated: result.updated })
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
    { key: 0.1, label: '≥10%' }, { key: 0.2, label: '≥20%' },
    { key: 0.5, label: '≥50%' }, { key: 1.0, label: '≥100%' },
  ]
  const SORT_OPTS = [
    { key: 'today', label: '今日' }, { key: 'seven_day', label: '7日' }, { key: 'all', label: '全部' },
  ]

  const SortIcon = ({ k }) => {
    if (localSort.key !== k) return <span className="text-gray-700 text-[10px]">⇅</span>
    return <span className="text-[10px]">{localSort.dir === 'desc' ? '▼' : '▲'}</span>
  }

  const toFollowItem = (item) => ({
    qy_wxid: item.qun_id,
    name: anonName(item.qun_id),
  })

  const COLS = [
    { k: 'rank',      label: '#',       cls: 'pl-4 pr-2 w-12 text-center' },
    { k: null,        label: '社群',     cls: 'px-3 text-left' },
    { k: 'today_ret', label: '今日收益', cls: 'px-3 w-28 text-center' },
    { k: 'seven_ret', label: '7日收益',  cls: 'px-3 w-28 text-center hidden lg:table-cell' },
    { k: null,        label: '曲线',     cls: 'px-2 w-16 text-center hidden lg:table-cell' },
    { k: 'today_ca',  label: '今日喊单', cls: 'px-3 w-24 text-center' },
    { k: 'total_ca',  label: '历史总单', cls: 'px-3 w-20 text-center hidden sm:table-cell' },
    { k: null,        label: '最近战绩', cls: 'px-3 hidden md:table-cell' },
    { k: null,        label: '最后喊单', cls: 'px-3 w-24 text-center hidden sm:table-cell' },
    { k: 'win_rate',  label: '胜率',     cls: 'px-3 w-40' },
    { k: null,        label: '跟单战绩', cls: 'px-2 w-36' },
    { k: null,        label: '操作',     cls: 'px-2 w-28 text-center' },
    { k: null,        label: '',         cls: 'w-6' },
  ]

  return (
    <div className="space-y-3">
      {/* 跟单弹窗 */}
      {followTarget && (
        <FollowModal
          item={toFollowItem(followTarget)}
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
              <p className="text-xs text-gray-500 mt-0.5">将对榜单 {data.length} 个社群设置跟单</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              {[
                { label: '跟单金额 (USDT)', key: 'buy_amount', min: 0.01, step: 0.01 },
                { label: '止盈 (%)', key: 'take_profit', min: 1, step: 1 },
                { label: '止损 (%)', key: 'stop_loss', min: 1, step: 1 },
                { label: '最长持仓 (分钟)', key: 'max_hold_min', min: 1, step: 1 },
              ].map(({ label, key, min, step }) => (
                <div key={key}>
                  <label className="text-xs text-gray-400 block mb-1">{label}</label>
                  <input type="number" min={min} step={step} value={batchDefaults[key]}
                    onChange={e => updateBatchDefaults(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-dark-600 flex gap-3 justify-end">
              <button onClick={() => setBatchConfigOpen(false)}
                className="text-xs px-4 py-2 rounded border border-dark-500 text-gray-400 hover:text-gray-200 transition-colors">取消</button>
              <button onClick={() => handleBatchFollow({
                buy_amount: parseFloat(batchDefaults.buy_amount) || 0.1,
                take_profit: parseFloat(batchDefaults.take_profit) || 50,
                stop_loss: parseFloat(batchDefaults.stop_loss) || 30,
                max_hold_min: parseInt(batchDefaults.max_hold_min) || 60,
              })}
                className="text-xs px-4 py-2 rounded border border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20 font-medium transition-colors">确认跟单</button>
            </div>
          </div>
        </div>
      )}

      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-200">社群胜率榜</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            微信社群综合胜率排行 · 群名已匿名化
            {lastUpdate && (
              <span className="ml-2">更新于 {new Date(lastUpdate).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setBatchConfigOpen(true); setBatchResult(null) }} disabled={batchFollowing || loading}
            className={clsx('text-xs px-3 py-1 rounded border transition-colors font-medium',
              batchFollowing ? 'border-dark-500 text-gray-600 cursor-not-allowed'
                : 'border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20'
            )}>
            {batchFollowing ? '跟单中…' : '⚡ 一键跟单'}
          </button>
          <button onClick={() => { setLoading(true); fetchData() }}
            className="text-xs text-gray-500 hover:text-gray-300 border border-dark-600 hover:border-dark-500 px-2.5 py-1 rounded transition-colors">↻ 刷新</button>
        </div>
      </div>

      {/* 一键跟单结果 */}
      {batchResult && (
        <div className={clsx('text-xs px-3 py-2 rounded border',
          batchResult.error ? 'bg-red-900/20 border-red-700/30 text-red-400' : 'bg-green-900/20 border-green-700/30 text-green-400'
        )}>
          {batchResult.error ? `一键跟单失败：${batchResult.error}` : `完成：新增 ${batchResult.added} 个，更新 ${batchResult.updated} 个`}
          <button onClick={() => setBatchResult(null)} className="ml-3 text-gray-500 hover:text-gray-300">✕</button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-dark-600 bg-dark-800/40 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">排行依据</span>
          <div className="flex gap-1">
            {SORT_OPTS.map(o => (
              <button key={o.key} onClick={() => setSortBy(o.key)}
                className={clsx('px-2.5 py-1 text-xs rounded border transition-colors',
                  sortBy === o.key ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10' : 'border-dark-600 text-gray-500 hover:text-gray-300'
                )}>{o.label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">涨幅门槛</span>
          <div className="flex gap-1">
            {THRESHOLD_OPTS.map(o => (
              <button key={o.key} onClick={() => setThreshold(o.key)}
                className={clsx('px-2.5 py-1 text-xs rounded border transition-colors',
                  threshold === o.key ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10' : 'border-dark-600 text-gray-500 hover:text-gray-300'
                )}>{o.label}</button>
            ))}
          </div>
        </div>
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
                {COLS.map(({ k, label, cls }, i) => (
                  <th key={i} className={clsx('py-3 text-xs font-medium', cls,
                    k ? 'cursor-pointer select-none text-gray-400 hover:text-gray-200' : 'text-gray-500'
                  )} onClick={k ? () => handleLocalSort(k) : undefined}>
                    <span className="inline-flex items-center gap-1">{label}{k && <SortIcon k={k} />}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((item, idx) => (
                <CommunityRow
                  key={item.qun_id}
                  item={item}
                  rank={item.rank ?? idx + 1}
                  expanded={expanded === item.qun_id}
                  onToggle={() => setExpanded(expanded === item.qun_id ? null : item.qun_id)}
                  onFollowClick={setFollowTarget}
                  isFollowing={followMap[item.qun_id] || null}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && data.length > 0 && (
        <p className="text-xs text-gray-600 text-right">共 {data.length} 个社群 · 群名已匿名化 · 数据来自微信社群信号平台</p>
      )}
    </div>
  )
}
