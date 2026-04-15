import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ReferenceDot,
} from 'recharts'
import { Card } from './UI'
import { clsx } from 'clsx'

const API = ''

// 与后端一致的4位哈希编号，用于脱敏发币人名称
function shortHash(s) {
  if (!s) return '????'
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return (h >>> 0).toString(16).slice(0, 4).toUpperCase().padStart(4, '0')
}

const CHAIN_EXPLORER_TX = {
  BSC:    tx => `https://bscscan.com/tx/${tx}`,
  ETH:    tx => `https://etherscan.io/tx/${tx}`,
  SOL:    tx => `https://solscan.io/tx/${tx}`,
  BASE:   tx => `https://basescan.org/tx/${tx}`,
  XLAYER: tx => `https://www.oklink.com/xlayer/tx/${tx}`,
}

const CHAIN_COLORS = {
  SOL: '#9945FF',
  BSC: '#F0B90B',
  ETH: '#627EEA',
  XLAYER: '#00D4AA',
  UNKNOWN: '#6B7280',
}

const fetchJson = (path) =>
  fetch(API + path).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

// ── 小工具 ────────────────────────────────────────────────────────────────────
function StatBadge({ label, value, color = 'gray' }) {
  const colorMap = {
    gray: 'bg-gray-800 text-gray-300',
    green: 'bg-green-900/40 text-green-400',
    red: 'bg-red-900/40 text-red-400',
    blue: 'bg-blue-900/40 text-blue-400',
    yellow: 'bg-yellow-900/40 text-yellow-300',
  }
  return (
    <div className={clsx('rounded-lg px-3 py-2 text-center', colorMap[color])}>
      <div className="text-lg font-bold font-mono">{value}</div>
      <div className="text-xs mt-0.5 opacity-75">{label}</div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-gray-300 mb-3">{children}</h3>
}

// ── 漏斗图 ────────────────────────────────────────────────────────────────────
function FunnelCard({ days }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetchJson(`/api/analytics/funnel?days=${days}`).then(setData).catch(() => {})
  }, [days])

  if (!data) return <Card><SectionTitle>信号漏斗</SectionTitle><div className="text-gray-500 text-sm">加载中...</div></Card>
  if (!Array.isArray(data.filter_breakdown)) return <Card><SectionTitle>信号漏斗</SectionTitle><div className="text-gray-500 text-sm">后端未就绪</div></Card>

  const total = data.total_received || 1
  const bought = data.bought || 0
  const closed = (data.profitable || 0) + (data.loss || 0)

  // 主漏斗步骤
  const mainSteps = [
    { label: '收到信号', value: data.total_received, color: '#3B82F6', sub: null },
    { label: '过滤通过', value: data.filter_passed, color: '#8B5CF6', sub: null },
    { label: '成功买入', value: bought, color: '#10B981', sub: null },
    { label: '已平仓', value: closed, color: '#6B7280', sub: null },
  ]

  // 分叉行（买入的结果 + 通过未买入）
  const forks = [
    { label: '盈利', value: data.profitable || 0, color: '#F59E0B', base: bought },
    { label: '亏损', value: data.loss || 0, color: '#EF4444', base: bought },
    { label: '通过未买入', value: data.not_bought || 0, color: '#374151', textColor: '#9CA3AF', base: data.filter_passed || 1 },
  ]

  return (
    <Card>
      <SectionTitle>信号漏斗（过去 {days} 天）</SectionTitle>

      {/* 主漏斗 */}
      <div className="space-y-2 mb-4">
        {mainSteps.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-20 text-xs text-gray-400 text-right shrink-0">{s.label}</div>
            <div className="flex-1 bg-dark-600 rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2 min-w-[28px]"
                style={{ width: `${Math.max((s.value / total) * 100, 3)}%`, backgroundColor: s.color }}
              >
                <span className="text-xs font-mono text-white">{s.value}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 分叉：盈利 / 亏损 / 通过未买入 */}
      <div className="border-t border-dark-600 pt-3 mb-4">
        <div className="text-xs text-gray-500 mb-2">结果分布</div>
        <div className="space-y-1.5">
          {forks.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <div className="w-20 text-xs text-right shrink-0" style={{ color: f.textColor || f.color }}>{f.label}</div>
              <div className="flex-1 bg-dark-600 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2 min-w-[24px]"
                  style={{ width: `${Math.max((f.value / total) * 100, f.value > 0 ? 3 : 0)}%`, backgroundColor: f.color }}
                >
                  {f.value > 0 && <span className="text-xs font-mono text-white">{f.value}</span>}
                </div>
              </div>
              {f.value === 0 && <span className="text-xs font-mono text-gray-600">0</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 拦截原因 */}
      {data.filter_breakdown.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-2">拦截原因 Top 5</div>
          <div className="space-y-1">
            {data.filter_breakdown.slice(0, 5).map((r) => (
              <div key={r.reason} className="flex justify-between text-xs text-gray-400">
                <span className="truncate flex-1 mr-2">{r.reason}</span>
                <span className="text-gray-300 font-mono">{r.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

// ── 链分布 ────────────────────────────────────────────────────────────────────
function ChainDistributionCard({ days }) {
  const [data, setData] = useState([])
  useEffect(() => {
    fetchJson(`/api/analytics/chain_distribution?days=${days}`).then(setData).catch(() => {})
  }, [days])

  const pieData = data.map(d => ({ name: d.chain, value: d.total }))

  return (
    <Card>
      <SectionTitle>链分布（过去 {days} 天）</SectionTitle>
      {data.length === 0
        ? <div className="text-gray-500 text-sm">暂无数据</div>
        : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={CHAIN_COLORS[entry.name] || '#6B7280'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {data.map(d => (
                <div key={d.chain} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: CHAIN_COLORS[d.chain] || '#6B7280' }} />
                    <span className="text-gray-300">{d.chain}</span>
                  </div>
                  <div className="flex gap-3 font-mono text-gray-400">
                    <span>{d.total} 收到</span>
                    <span className="text-green-400">{d.bought} 买</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
    </Card>
  )
}

// ── P&L 曲线 ──────────────────────────────────────────────────────────────────
const PNL_GRANULARITIES = [
  { label: '每笔', value: 'trade' },
  { label: '按小时', value: 'hour' },
  { label: '按天', value: 'day' },
]

function groupByBucket(series, granularity) {
  if (granularity === 'trade') {
    let cum = 0
    return series.map(p => {
      cum += p.pnl_usdt
      return {
        time: new Date(p.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
        cumPnl: Math.round(cum * 10000) / 10000,
        pnl: p.pnl_usdt,
      }
    })
  }
  // 按小时或按天聚合
  const fmt = granularity === 'hour'
    ? t => { const d = new Date(t); return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).replace(/\//g, '-') }
    : t => { const d = new Date(t); return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') }

  const buckets = new Map()
  for (const p of series) {
    const key = fmt(p.time)
    const cur = buckets.get(key) || { time: key, pnl: 0, count: 0 }
    cur.pnl = Math.round((cur.pnl + p.pnl_usdt) * 10000) / 10000
    cur.count += 1
    buckets.set(key, cur)
  }

  let cum = 0
  return Array.from(buckets.values()).map(b => {
    cum = Math.round((cum + b.pnl) * 10000) / 10000
    return { time: b.time, cumPnl: cum, pnl: b.pnl, count: b.count }
  })
}

function PnlCurveCard({ days }) {
  const [data, setData] = useState(null)
  const [granularity, setGranularity] = useState('trade')

  useEffect(() => {
    setData(null)
    fetchJson(`/api/analytics/pnl_series?days=${days}`).then(setData).catch(() => {})
  }, [days])

  if (!data) return <Card><SectionTitle>P&L 曲线</SectionTitle><div className="text-gray-500 text-sm">加载中...</div></Card>
  if (!data.summary || !Array.isArray(data.series)) return <Card><SectionTitle>P&L 曲线</SectionTitle><div className="text-gray-500 text-sm">后端未就绪</div></Card>

  const s = data.summary
  const chartData = groupByBucket(data.series, granularity)
  const pnlColor = (s.total_pnl_usdt || 0) >= 0 ? '#10B981' : '#EF4444'

  return (
    <Card>
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <SectionTitle>P&L 曲线（过去 {days} 天）</SectionTitle>
        <div className="flex items-center gap-3">
          {/* 粒度切换 */}
          <div className="flex rounded-lg overflow-hidden border border-dark-500">
            {PNL_GRANULARITIES.map(g => (
              <button
                key={g.value}
                onClick={() => setGranularity(g.value)}
                className={clsx(
                  'text-xs px-2.5 py-1 transition-colors',
                  granularity === g.value
                    ? 'bg-accent-blue/20 text-accent-blue'
                    : 'text-gray-500 hover:text-gray-300'
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          {/* 统计徽章 */}
          <div className="flex gap-2">
            <StatBadge label="总盈亏" value={`${s.total_pnl_usdt >= 0 ? '+' : ''}${s.total_pnl_usdt}U`} color={s.total_pnl_usdt >= 0 ? 'green' : 'red'} />
            <StatBadge label="胜率" value={`${s.win_rate}%`} color="blue" />
            <StatBadge label="笔数" value={s.total_trades} color="gray" />
          </div>
        </div>
      </div>
      {chartData.length === 0
        ? <div className="text-gray-500 text-sm py-8 text-center">暂无成交数据</div>
        : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => v.toFixed(2)} />
              <Tooltip
                contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#9CA3AF' }}
                formatter={(v, n) => [typeof v === 'number' ? v.toFixed(4) + 'U' : v, n]}
              />
              <Line type="monotone" dataKey="cumPnl" stroke={pnlColor} dot={granularity !== 'trade'} strokeWidth={2} name="累计P&L" />
              {granularity !== 'trade' && (
                <Line type="monotone" dataKey="pnl" stroke="#6B7280" dot={false} strokeWidth={1} strokeDasharray="4 2" name="当期P&L" />
              )}
            </LineChart>
          </ResponsiveContainer>
        )
      }
    </Card>
  )
}

// ── 发币人排行 ─────────────────────────────────────────────────────────────────
function SenderLeaderboardCard({ days }) {
  const [data, setData] = useState([])
  const [sort, setSort] = useState('total_pushed')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchJson(`/api/analytics/sender_leaderboard?limit=50&sort_by=${sort}&days=${days}`)
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [sort, days])

  const SORTS = [
    { value: 'total_pushed', label: '推送量' },
    { value: 'ws_win_rate', label: 'WS胜率' },
    { value: 'ws_total_tokens', label: '历史发币数' },
    { value: 'total_pnl_usdt', label: '总盈亏' },
    { value: 'win_count', label: '胜次' },
  ]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <SectionTitle>发币人排行</SectionTitle>
          <div className="text-xs text-gray-500 -mt-2">共 {data.length} 人，含未买入</div>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-dark-500">
          {SORTS.map(s => (
            <button
              key={s.value}
              onClick={() => setSort(s.value)}
              className={clsx(
                'text-xs px-2 py-1 transition-colors whitespace-nowrap',
                sort === s.value ? 'bg-accent-blue/20 text-accent-blue' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading
        ? <div className="text-gray-500 text-sm py-4 text-center">加载中...</div>
        : data.length === 0
        ? <div className="text-gray-500 text-sm py-4 text-center">暂无数据</div>
        : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs text-gray-400">
              <thead className="sticky top-0 bg-dark-800">
                <tr className="border-b border-dark-600 text-gray-500">
                  <th className="text-left py-1.5 pr-2 font-medium">发币人</th>
                  <th className="text-right pr-2 font-medium">推送</th>
                  <th className="text-right pr-2 font-medium">买入</th>
                  <th className="text-right pr-2 font-medium">WS胜率</th>
                  <th className="text-right pr-2 font-medium">发币数</th>
                  <th className="text-right pr-2 font-medium">最高倍</th>
                  <th className="text-right pr-2 font-medium">本系统胜</th>
                  <th className="text-right font-medium">总P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr
                    key={r.sender}
                    className={clsx(
                      'border-b border-dark-700/40 hover:bg-dark-700/30',
                      r.has_trade ? '' : 'opacity-60'
                    )}
                  >
                    {/* 发币人 */}
                    <td className="py-1.5 pr-2 font-mono text-gray-300 max-w-[90px] truncate">
                      <span
                        className="bg-orange-900/20 text-orange-400/80 px-1.5 py-0.5 rounded text-[11px]"
                        title="发币人已脱敏为编号"
                      >#{shortHash(r.sender)}</span>
                      {!r.has_trade && (
                        <span className="ml-1 text-gray-600 text-[10px]">无买入</span>
                      )}
                    </td>
                    {/* 推送次数 */}
                    <td className="text-right pr-2 font-mono">{r.total_pushed}</td>
                    {/* 买入次数 */}
                    <td className="text-right pr-2 font-mono">
                      {r.total_bought > 0
                        ? <span className="text-green-400">{r.total_bought}</span>
                        : <span className="text-gray-600">—</span>
                      }
                    </td>
                    {/* WS 胜率 */}
                    <td className={clsx('text-right pr-2 font-mono',
                      r.ws_win_rate >= 60 ? 'text-green-400' : r.ws_win_rate >= 40 ? 'text-yellow-400' : 'text-gray-400'
                    )}>
                      {r.ws_win_rate > 0 ? r.ws_win_rate + '%' : '—'}
                    </td>
                    {/* WS 总发币数 */}
                    <td className="text-right pr-2 font-mono text-gray-300">{r.ws_total_tokens || '—'}</td>
                    {/* WS 最高倍数 */}
                    <td className="text-right pr-2 font-mono text-yellow-400">
                      {r.ws_best_multiple > 0 ? r.ws_best_multiple + 'x' : '—'}
                    </td>
                    {/* 本系统胜/负 */}
                    <td className="text-right pr-2 font-mono">
                      {r.win_count + r.loss_count > 0
                        ? <span>
                            <span className="text-green-400">{r.win_count}</span>
                            <span className="text-gray-600">/</span>
                            <span className="text-red-400">{r.loss_count}</span>
                          </span>
                        : <span className="text-gray-600">—</span>
                      }
                    </td>
                    {/* 总 P&L */}
                    <td className={clsx('text-right font-mono',
                      r.total_pnl_usdt > 0 ? 'text-green-400' : r.total_pnl_usdt < 0 ? 'text-red-400' : 'text-gray-600'
                    )}>
                      {r.win_count + r.loss_count > 0
                        ? (r.total_pnl_usdt >= 0 ? '+' : '') + r.total_pnl_usdt + 'U'
                        : '—'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </Card>
  )
}

// ── CA 流水表 ─────────────────────────────────────────────────────────────────
function CaFeedTable({ days }) {
  const [data, setData] = useState({ total: 0, data: [] })
  const [page, setPage] = useState(1)
  const [filterPassed, setFilterPassed] = useState('')
  const [bought, setBought] = useState('')
  const [selectedCA, setSelectedCA] = useState(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({
      page, page_size: 30, days,
      ...(filterPassed ? { filter_passed: filterPassed } : {}),
      ...(bought ? { bought } : {}),
    })
    fetchJson(`/api/analytics/ca_feed?${params}`).then(setData).catch(() => {})
  }, [page, filterPassed, bought, days])

  useEffect(() => { load() }, [load])

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <SectionTitle>CA 流水（过去 {days} 天）</SectionTitle>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterPassed}
            onChange={e => { setFilterPassed(e.target.value); setPage(1) }}
            className="text-xs bg-dark-600 text-gray-300 border border-dark-500 rounded px-2 py-1"
          >
            <option value="">全部</option>
            <option value="true">过滤通过</option>
            <option value="false">被拦截</option>
          </select>
          <select
            value={bought}
            onChange={e => { setBought(e.target.value); setPage(1) }}
            className="text-xs bg-dark-600 text-gray-300 border border-dark-500 rounded px-2 py-1"
          >
            <option value="">全部</option>
            <option value="true">已买入</option>
            <option value="false">未买入</option>
          </select>
        </div>
      </div>
      <div className="text-xs text-gray-500 mb-2">共 {data.total} 条</div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="w-full text-xs text-gray-400">
          <thead>
            <tr className="border-b border-dark-600 text-gray-500">
              <th className="text-left py-1.5 pr-2">时间</th>
              <th className="text-left pr-2">CA</th>
              <th className="text-left pr-2">链</th>
              <th className="text-left pr-2">代币</th>
              <th className="text-right pr-2">市值</th>
              <th className="text-right pr-2">倍数</th>
              <th className="text-right pr-2">热度</th>
              <th className="text-left pr-2">状态</th>
              <th className="text-left">拦截原因</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map(r => (
              <tr
                key={r.id}
                className="border-b border-dark-700/50 hover:bg-dark-700/30 cursor-pointer"
                onClick={() => r.bought && r.position_id && setSelectedCA({ positionId: r.position_id, ca: r.ca })}
              >
                <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{new Date(r.received_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                <td className="pr-2 font-mono text-gray-300">{r.ca.slice(0, 8)}…</td>
                <td className="pr-2">
                  <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: (CHAIN_COLORS[r.chain] || '#6B7280') + '33', color: CHAIN_COLORS[r.chain] || '#9CA3AF' }}>
                    {r.chain}
                  </span>
                </td>
                <td className="pr-2 text-gray-300">{r.symbol || r.token_name || '—'}</td>
                <td className="text-right pr-2 font-mono">{r.market_cap > 0 ? '$' + (r.market_cap >= 1000000 ? (r.market_cap / 1000000).toFixed(1) + 'M' : r.market_cap >= 1000 ? (r.market_cap / 1000).toFixed(0) + 'K' : r.market_cap.toFixed(0)) : '—'}</td>
                <td className="text-right pr-2 font-mono text-yellow-400">{r.current_multiple > 0 ? r.current_multiple + 'x' : '—'}</td>
                <td className="text-right pr-2 font-mono">{r.qwfc || 0}</td>
                <td className="pr-2">
                  {r.bought
                    ? <span className="text-green-400 font-bold">买入</span>
                    : r.filter_passed
                    ? <span className="text-blue-400">通过</span>
                    : <span className="text-red-400">拦截</span>
                  }
                </td>
                <td className="text-gray-500 max-w-[160px] truncate">{r.filter_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 翻页 */}
      <div className="flex items-center justify-between mt-3">
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => p - 1)}
          className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-2 py-1"
        >
          ← 上一页
        </button>
        <span className="text-xs text-gray-500">第 {page} 页</span>
        <button
          disabled={data.data.length < 30}
          onClick={() => setPage(p => p + 1)}
          className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-2 py-1"
        >
          下一页 →
        </button>
      </div>

      {/* 价格曲线弹窗 */}
      {selectedCA && (
        <PriceCurveModal positionId={selectedCA.positionId} ca={selectedCA.ca} onClose={() => setSelectedCA(null)} />
      )}
    </Card>
  )
}

// ── 价格曲线弹窗 ───────────────────────────────────────────────────────────────
function PriceCurveModal({ positionId, ca, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetchJson(`/api/analytics/price_curve/${positionId}`).then(setData).catch(() => {})
  }, [positionId])

  const chartData = data?.snapshots?.map(s => ({
    time: new Date(s.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }),
    price: s.price,
    pnl: s.pnl_pct,
    event: s.event_type,
  })) || []

  const buyPoints = chartData.filter(d => d.event === 'buy')
  const sellPoints = chartData.filter(d => d.event === 'sell')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-dark-800 border border-dark-600 rounded-xl p-5 w-full max-w-2xl mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">价格曲线 — {ca?.slice(0, 12)}…</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
        </div>
        {!data
          ? <div className="text-gray-500 text-sm py-8 text-center">加载中...</div>
          : chartData.length === 0
          ? <div className="text-gray-500 text-sm py-8 text-center">暂无价格快照</div>
          : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 10 }} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => v.toExponential(2)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#9CA3AF' }}
                  formatter={(v) => [typeof v === 'number' ? v.toPrecision(6) : v]}
                />
                <Line type="monotone" dataKey="price" stroke="#3B82F6" dot={false} strokeWidth={2} name="价格" />
                {buyPoints.map((p, i) => (
                  <ReferenceDot key={'buy' + i} x={p.time} y={p.price} r={6} fill="#10B981" stroke="#fff" strokeWidth={1} />
                ))}
                {sellPoints.map((p, i) => (
                  <ReferenceDot key={'sell' + i} x={p.time} y={p.price} r={6} fill="#EF4444" stroke="#fff" strokeWidth={1} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )
        }
        {data?.position && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-400">
            <div>买入价: <span className="text-gray-200 font-mono">{data.position.entry_price?.toPrecision(6)}</span></div>
            <div>投入: <span className="text-gray-200 font-mono">{data.position.amount_usdt}U</span></div>
            <div>状态: <span className={data.position.status === 'open' ? 'text-green-400' : 'text-gray-400'}>{data.position.status}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CA 战绩排行榜 ─────────────────────────────────────────────────────────────
const LEADERBOARD_PERIODS = [
  // 一行：时段
  [
    { key: 'midnight', label: '凌晨' },
    { key: 'morning',  label: '上午' },
    { key: 'afternoon',label: '下午' },
    { key: 'evening',  label: '晚上' },
    { key: 'today',    label: '今日' },
    { key: 'yesterday',label: '昨日' },
  ],
  // 二行：跨度
  [
    { key: 'week',    label: '本周' },
    { key: 'month',   label: '本月' },
    { key: 'quarter', label: '季度' },
    { key: 'year',    label: '年度' },
    { key: 'all',     label: '全部' },
  ],
]

const LEADERBOARD_SORTS = [
  { key: 'pnl',      label: '总盈亏' },
  { key: 'win_rate', label: '胜率' },
  { key: 'best_pnl', label: '最高收益' },
  { key: 'count',    label: '交易次数' },
]

const RANK_BADGES = ['🥇', '🥈', '🥉']

function fmtCap(v) {
  if (!v || v === 0) return '—'
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
}

function fmtPct(v, sign = true) {
  if (v === null || v === undefined) return '—'
  return (sign && v > 0 ? '+' : '') + v.toFixed(1) + '%'
}

function rateColor(v) {
  if (v === null || v === undefined) return 'text-gray-500'
  if (v >= 60) return 'text-green-400'
  if (v >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

const REASON_LABELS = {
  take_profit: '止盈',
  stop_loss:   '止损',
  timeout:     '超时',
  manual:      '手动',
}

function ExitReasonBadges({ reasons }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {Object.entries(reasons).map(([reason, cnt]) => (
        <span
          key={reason}
          className={clsx(
            'text-[9px] px-1 py-0.5 rounded border',
            reason === 'take_profit' ? 'border-green-800/40 text-green-500 bg-green-900/20' :
            reason === 'stop_loss'   ? 'border-red-800/40   text-red-400   bg-red-900/20'   :
            reason === 'timeout'     ? 'border-yellow-800/40 text-yellow-400 bg-yellow-900/20' :
                                       'border-dark-500 text-gray-500 bg-dark-700/30'
          )}
        >
          {REASON_LABELS[reason] || reason} {cnt > 1 && `×${cnt}`}
        </span>
      ))}
    </div>
  )
}

function WinRateBar({ rate, count, win }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 bg-dark-600 rounded-full h-1.5 overflow-hidden">
        <div
          className={clsx('h-full rounded-full', rate >= 60 ? 'bg-green-400' : rate >= 40 ? 'bg-yellow-400' : 'bg-red-400')}
          style={{ width: `${rate}%` }}
        />
      </div>
      <span className={clsx('text-[11px] font-mono', rateColor(rate))}>{rate.toFixed(0)}%</span>
      <span className="text-[10px] text-gray-600">{win}/{count}</span>
    </div>
  )
}

function CaLeaderboardCard() {
  const [period, setPeriod] = useState('today')
  const [sortBy, setSortBy] = useState('pnl')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    setLoading(true)
    setExpanded(null)
    fetch(`/api/analytics/ca_leaderboard?period=${period}&sort_by=${sortBy}&limit=50`)
      .then(r => r.json())
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period, sortBy])

  return (
    <Card>
      {/* 标题栏 */}
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <SectionTitle>CA 战绩排行榜</SectionTitle>
          <div className="text-xs text-gray-500 -mt-2">买过的 CA 交易结果汇总</div>
        </div>
        {/* 排序维度 */}
        <div className="flex rounded-lg overflow-hidden border border-dark-500">
          {LEADERBOARD_SORTS.map(s => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className={clsx(
                'text-xs px-2.5 py-1 transition-colors whitespace-nowrap',
                sortBy === s.key ? 'bg-accent-blue/20 text-accent-blue' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 时段按钮（两行） */}
      <div className="space-y-1 mb-3">
        {LEADERBOARD_PERIODS.map((row, ri) => (
          <div key={ri} className="flex gap-1 flex-wrap">
            {row.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={clsx(
                  'px-2.5 py-0.5 text-[11px] rounded border transition-colors',
                  period === p.key
                    ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10'
                    : 'border-dark-500 text-gray-500 hover:text-gray-300'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="text-gray-500 text-sm py-8 text-center">加载中...</div>
      ) : data.length === 0 ? (
        <div className="text-gray-500 text-sm py-8 text-center">该时段无交易记录</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-gray-400">
            <thead className="sticky top-0 bg-dark-800">
              <tr className="border-b border-dark-600 text-gray-500">
                <th className="text-left py-1.5 pr-2 w-6 font-medium">#</th>
                <th className="text-left pr-3 font-medium">代币</th>
                <th className="text-left pr-3 font-medium">叙事</th>
                <th className="text-left pr-3 font-medium">出局原因</th>
                <th className="text-right pr-3 font-medium">总P&L</th>
                <th className="text-left pr-3 font-medium">胜率</th>
                <th className="text-right pr-2 font-medium">最高/最低</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <>
                  <tr
                    key={row.ca + row.chain}
                    onClick={() => setExpanded(expanded === row.ca ? null : row.ca)}
                    className={clsx(
                      'border-b border-dark-700/40 cursor-pointer transition-colors',
                      row.total_pnl_usdt > 0 ? 'hover:bg-green-900/10 bg-green-900/5' :
                      row.total_pnl_usdt < 0 ? 'hover:bg-red-900/10 bg-red-900/5' :
                      'hover:bg-dark-700/30'
                    )}
                  >
                    {/* # 排名 */}
                    <td className="py-2 pr-2">
                      <span className={clsx('text-xs font-bold', idx < 3 ? '' : 'text-gray-600')}>
                        {idx < 3 ? RANK_BADGES[idx] : idx + 1}
                      </span>
                    </td>

                    {/* 代币信息 */}
                    <td className="pr-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                          style={{
                            background: (CHAIN_COLORS[row.chain] || '#6B7280') + '33',
                            color: CHAIN_COLORS[row.chain] || '#9CA3AF'
                          }}
                        >
                          {row.chain}
                        </span>
                        <div>
                          <div className="text-gray-200 font-semibold text-[11px]">
                            {row.symbol || row.token_name || row.ca.slice(0, 6) + '…'}
                          </div>
                          <div className="font-mono text-gray-600 text-[10px]">{row.ca.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>

                    {/* 叙事 */}
                    <td className="pr-3">
                      {row.narrative && (
                        <div className="space-y-0.5">
                          {(row.narrative.group_id || row.narrative.sender_id) && (
                            <div className="flex items-center gap-1">
                              {row.narrative.group_id && (
                                <span className="text-blue-400/80 text-[10px] font-mono bg-blue-900/20 px-1 rounded">#{row.narrative.group_id}</span>
                              )}
                              {row.narrative.sender_id && (
                                <span className="text-orange-400/80 text-[10px] font-mono bg-orange-900/20 px-1 rounded">#{row.narrative.sender_id}</span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-[10px]">
                            {row.narrative.qwfc > 0 && (
                              <span className="text-gray-500">热度 <span className="text-gray-300">{row.narrative.qwfc}</span></span>
                            )}
                            {row.narrative.market_cap > 0 && (
                              <span className="text-gray-500">{fmtCap(row.narrative.market_cap)}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* 出局原因 */}
                    <td className="pr-3">
                      <ExitReasonBadges reasons={row.exit_reasons} />
                    </td>

                    {/* 总P&L */}
                    <td className={clsx(
                      'text-right pr-3 font-mono font-semibold',
                      row.total_pnl_usdt > 0 ? 'text-green-400' :
                      row.total_pnl_usdt < 0 ? 'text-red-400' : 'text-gray-500'
                    )}>
                      {row.total_pnl_usdt > 0 ? '+' : ''}{row.total_pnl_usdt.toFixed(3)}U
                      <div className="text-gray-600 font-normal text-[10px]">{row.trade_count} 笔</div>
                    </td>

                    {/* 胜率 */}
                    <td className="pr-3">
                      <WinRateBar rate={row.win_rate} count={row.trade_count} win={row.win_count} />
                    </td>

                    {/* 最高/最低 */}
                    <td className="text-right pr-2 font-mono">
                      <div className="text-green-400 text-[11px]">{fmtPct(row.best_pnl_pct)}</div>
                      <div className="text-red-400 text-[11px]">{fmtPct(row.worst_pnl_pct)}</div>
                    </td>

                    {/* 展开按钮 */}
                    <td className="text-gray-600 text-xs">
                      <span className={clsx('transition-transform inline-block', expanded === row.ca ? 'rotate-180' : '')}>▼</span>
                    </td>
                  </tr>

                  {/* 展开行：每笔交易详情 */}
                  {expanded === row.ca && (
                    <tr key={row.ca + '_detail'} className="border-b border-dark-600/40">
                      <td colSpan={8} className="bg-dark-900/40 px-4 py-3">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          {/* 叙事完整展示 */}
                          {row.narrative && Object.keys(row.narrative).length > 0 && (
                            <div className="text-xs text-gray-500 space-y-1">
                              <div className="text-gray-400 font-semibold mb-1">叙事数据</div>
                              {row.narrative.sender_win_rate > 0 && (
                                <div>喊单人WS胜率: <span className={rateColor(row.narrative.sender_win_rate)}>{row.narrative.sender_win_rate.toFixed(1)}%</span></div>
                              )}
                              {row.narrative.group_win_rate > 0 && (
                                <div>社区WS胜率: <span className={rateColor(row.narrative.group_win_rate)}>{row.narrative.group_win_rate.toFixed(1)}%</span></div>
                              )}
                              {row.narrative.market_cap > 0 && <div>市值: {fmtCap(row.narrative.market_cap)}</div>}
                              {row.narrative.holders > 0 && <div>持仓人数: {row.narrative.holders}</div>}
                              {row.narrative.bqfc > 0 && <div>本群热度: {row.narrative.bqfc}</div>}
                              {row.narrative.qwfc > 0 && <div>全网热度: {row.narrative.qwfc}</div>}
                              {row.narrative.current_multiple > 0 && (
                                <div>市场倍数: <span className="text-yellow-400">{row.narrative.current_multiple}x</span></div>
                              )}
                              {row.narrative.risk_score > 0 && (
                                <div>风险评分: <span className={row.narrative.risk_score >= 70 ? 'text-red-400' : 'text-yellow-400'}>{row.narrative.risk_score}</span></div>
                              )}
                            </div>
                          )}

                          {/* 每笔交易列表 */}
                          <div>
                            <div className="text-xs text-gray-400 font-semibold mb-1">交易明细</div>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {row.trades.map(t => (
                                <div key={t.id} className="flex items-center gap-2 text-[11px] text-gray-500 border-b border-dark-700/30 pb-1">
                                  <span className="font-mono text-gray-600 w-24 shrink-0">
                                    {new Date(t.close_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                                  </span>
                                  <span className={clsx('font-mono font-semibold w-16 shrink-0',
                                    t.pnl_usdt > 0 ? 'text-green-400' : 'text-red-400'
                                  )}>
                                    {t.pnl_usdt > 0 ? '+' : ''}{t.pnl_usdt.toFixed(3)}U
                                  </span>
                                  <span className={clsx('font-mono w-14 shrink-0',
                                    t.pnl_pct > 0 ? 'text-green-400/70' : 'text-red-400/70'
                                  )}>
                                    {fmtPct(t.pnl_pct)}
                                  </span>
                                  <span className={clsx('px-1 rounded text-[9px]',
                                    t.reason === 'take_profit' ? 'bg-green-900/20 text-green-500' :
                                    t.reason === 'stop_loss'   ? 'bg-red-900/20 text-red-400' :
                                    t.reason === 'timeout'     ? 'bg-yellow-900/20 text-yellow-400' :
                                    'bg-dark-700/30 text-gray-500'
                                  )}>
                                    {REASON_LABELS[t.reason] || t.reason}
                                  </span>
                                  {t.sell_tx && (
                                    <a
                                      href={(CHAIN_EXPLORER_TX[row.chain] || (tx => `https://bscscan.com/tx/${tx}`))(t.sell_tx)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-500/60 hover:text-blue-400 text-[10px] ml-auto"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      Tx ↗
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── 主 Analytics 面板 ─────────────────────────────────────────────────────────
// days 由父组件（仪表盘）传入，面板本身不再管理时间范围
export default function AnalyticsPanel({ days = 7 }) {
  return (
    <div className="space-y-4">
      {/* 第一行：漏斗 + 链分布 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FunnelCard days={days} />
        <ChainDistributionCard days={days} />
      </div>

      {/* 第二行：P&L 曲线（全宽） */}
      <PnlCurveCard days={days} />

      {/* 第三行：CA 战绩排行榜（全宽） */}
      <CaLeaderboardCard />

      {/* 第四行：发币人排行 + CA 流水 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-2">
          <SenderLeaderboardCard days={days} />
        </div>
        <div className="lg:col-span-3">
          <CaFeedTable days={days} />
        </div>
      </div>
    </div>
  )
}
