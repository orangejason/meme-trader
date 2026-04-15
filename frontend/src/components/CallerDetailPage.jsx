import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'

const CHAIN_CFG = {
  bsc:     { label: 'BSC',  color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  solana:  { label: 'SOL',  color: 'text-purple-400 bg-purple-900/20 border-purple-700/30' },
  eth:     { label: 'ETH',  color: 'text-blue-400 bg-blue-900/20 border-blue-700/30' },
  base:    { label: 'BASE', color: 'text-sky-400 bg-sky-900/20 border-sky-700/30' },
  unknown: { label: '?',    color: 'text-gray-500 bg-dark-700/20 border-dark-500' },
}

// 根据 token 地址格式推断链
function guessChain(token) {
  if (!token) return 'unknown'
  if (!token.startsWith('0x')) return 'solana'  // base58 = SOL
  if (token.length === 42) return 'bsc'          // EVM，默认 BSC（最常见）
  return 'unknown'
}

// DexScreener chain slug
const DEXSCREENER_CHAIN = { bsc: 'bsc', solana: 'solana', eth: 'ethereum', base: 'base' }

// 代币 Logo：DexScreener 图片，失败时 fallback 到 Identicon
function TokenLogo({ token, chain, symbol, size = 32 }) {
  const [err, setErr] = useState(false)
  const dsChain = DEXSCREENER_CHAIN[chain] || 'bsc'
  const logoUrl = token ? `https://dd.dexscreener.com/ds-data/tokens/${dsChain}/${token.toLowerCase()}.png` : null

  if (!logoUrl || err) {
    // Fallback: Identicon
    const h = strHash(token || symbol || '?')
    const hue = h % 360
    return (
      <svg width={size} height={size} style={{ borderRadius: '50%', flexShrink: 0 }}>
        <rect width={size} height={size} fill={`hsl(${hue},20%,14%)`} rx={size / 2} />
        <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={size * 0.4}
          fill={`hsl(${hue},60%,55%)`} fontWeight="bold">
          {(symbol || '?').slice(0, 2).toUpperCase()}
        </text>
      </svg>
    )
  }
  return (
    <img
      src={logoUrl}
      alt={symbol}
      width={size} height={size}
      style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
      onError={() => setErr(true)}
    />
  )
}

function strHash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0
  return Math.abs(h)
}

function Identicon({ seed, size = 48 }) {
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

function parseRate(s) {
  return parseFloat(String(s || '0').replace('%', '')) || 0
}

function DetailSparkline({ points }) {
  if (!points || points.length === 0) return (
    <div className="h-20 flex items-center justify-center text-gray-600 text-sm">数据积累中（每日更新）</div>
  )
  const vals = points.map(p => p.avg_mult * 100)
  const W = 600, H = 80, padX = 30, padY = 8

  // 只有 1 个点时：显示单点 + 数值 + 日期
  if (points.length === 1) {
    const v = vals[0]
    const color = v >= 100 ? '#fde047' : v >= 30 ? '#4ade80' : v >= 0 ? '#4ade80' : '#f87171'
    const cx = W / 2, cy = H / 2
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        <line x1={padX} y1={cy} x2={W - padX} y2={cy} stroke="#374151" strokeWidth="0.8" strokeDasharray="4,3" />
        <circle cx={cx} cy={cy} r="5" fill={color} />
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="13" fontWeight="bold" fill={color}>
          {v >= 0 ? '+' : ''}{v.toFixed(0)}%
        </text>
        <text x={cx} y={H - 1} textAnchor="middle" fontSize="9" fill="#4b5563">{points[0].date?.slice(5)}</text>
        <text x={W - padX + 2} y={cy + 3} fontSize="8" fill="#4b5563">今日</text>
      </svg>
    )
  }

  const min = Math.min(...vals, 0)
  const max = Math.max(...vals, 0)
  const range = max - min || 1
  const pts = vals.map((v, i) => {
    const x = padX + (i / (vals.length - 1)) * (W - padX * 2)
    const y = H - padY - ((v - min) / range) * (H - padY * 2)
    return [x, y]
  })
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const zeroY = H - padY - ((0 - min) / range) * (H - padY * 2)
  const up = vals[vals.length - 1] >= vals[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
      <line x1={padX} y1={zeroY.toFixed(1)} x2={W - padX} y2={zeroY.toFixed(1)}
        stroke="#374151" strokeWidth="0.8" strokeDasharray="4,3" />
      <polyline points={polyline} fill="none"
        stroke={up ? '#4ade80' : '#f87171'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3"
          fill={vals[i] >= 0 ? '#4ade80' : '#f87171'} />
      ))}
      {points.map((p, i) => {
        const [x] = pts[i]
        return (
          <text key={i} x={x.toFixed(1)} y={H - 1} textAnchor="middle"
            fontSize="9" fill="#4b5563">{p.date?.slice(5)}</text>
        )
      })}
    </svg>
  )
}

export default function CallerDetailPage({ item, history = [], onBack, onFollowClick }) {
  const [detail, setDetail] = useState(null)
  const [followCfg, setFollowCfg] = useState(null)
  const [tokenSort, setTokenSort] = useState({ key: 'call_time', dir: 'desc' })
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const totalWr = parseRate(item.win_rate)
  const todayWr = parseRate(item.today_win_rate)

  useEffect(() => {
    fetch(`/api/analytics/caller_detail/${encodeURIComponent(item.qy_wxid)}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setFollowCfg(d.follow || null) })
      .catch(() => {})
  }, [item.qy_wxid])

  const startEdit = () => {
    setEditForm(followCfg ? { ...followCfg } : {
      enabled: true, buy_amount: 0.1, take_profit: 50, stop_loss: 30, max_hold_min: 60, note: ''
    })
    setEditing(true)
  }

  const setF = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/analytics/follow_traders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wxid: item.qy_wxid, name: item.name || '', ...editForm }),
      })
      const d = await r.json()
      if (d.success) { setFollowCfg({ ...editForm }); setEditing(false) }
      else alert('保存失败')
    } catch { alert('保存失败') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('确认取消跟单？')) return
    setDeleting(true)
    try {
      await fetch(`/api/analytics/follow_traders/${encodeURIComponent(item.qy_wxid)}`, { method: 'DELETE' })
      setFollowCfg(null); setEditing(false)
    } catch { alert('删除失败') }
    finally { setDeleting(false) }
  }

  const snaps = detail?.history || history
  const records = item.records || []

  const sortedRecords = [...records].sort((a, b) => {
    let av, bv
    switch (tokenSort.key) {
      case 'call_time': av = new Date(a.call_time||0).getTime(); bv = new Date(b.call_time||0).getTime(); break
      case 'multiplier': av = a.multiplier||0; bv = b.multiplier||0; break
      case 'symbol': av = (a.symbol||'').toLowerCase(); bv = (b.symbol||'').toLowerCase();
        return tokenSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      default: av = 0; bv = 0
    }
    return tokenSort.dir === 'asc' ? av - bv : bv - av
  })

  const handleTokenSort = (key) => {
    setTokenSort(s => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))
  }

  const SortIcon = ({ k }) => {
    if (tokenSort.key !== k) return <span className="text-gray-700 text-[10px]">⇅</span>
    return <span className="text-[10px]">{tokenSort.dir === 'desc' ? '▼' : '▲'}</span>
  }

  return (
    <div className="space-y-4">
      {/* 顶部：返回 + 身份 + 跟单 */}
      <div className="flex items-center gap-4">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors shrink-0">
          ← 返回榜单
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Identicon seed={item.qy_wxid} size={44} />
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-200">{item.name || <span className="text-gray-500">匿名</span>}</div>
            <div className="text-xs text-gray-500 font-mono truncate">{item.qy_wxid}</div>
          </div>
        </div>
        <button
          onClick={onFollowClick}
          className={clsx(
            'shrink-0 px-4 py-2 text-sm font-medium rounded border transition-colors',
            followCfg
              ? 'border-green-600/50 text-green-400 bg-green-900/20 hover:bg-green-900/40'
              : 'border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20'
          )}
        >
          {followCfg ? (followCfg.enabled ? '✓ 跟单中' : '⏸ 跟单已暂停') : '+ 跟单'}
        </button>
      </div>

      {/* 上方两列布局：左统计+曲线，右跟单配置 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 左：统计数字 */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-dark-600 rounded-xl bg-dark-800/60 px-5 py-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[
                { label: '历史总单', value: item.total_ca_count },
                { label: '历史盈利', value: item.total_win_count, color: 'text-green-400' },
                { label: '历史胜率', value: item.win_rate, color: totalWr >= 60 ? 'text-green-400' : totalWr >= 45 ? 'text-yellow-400' : 'text-red-400' },
                { label: '今日喊单', value: item.ca_count },
                { label: '今日胜率', value: item.today_win_rate, color: todayWr >= 60 ? 'text-green-400' : todayWr >= 45 ? 'text-yellow-400' : 'text-red-400' },
                { label: '今日收益率', value: item.ca_count > 0 ? `+${((item.total_multiplier / item.ca_count) * 100).toFixed(1)}%` : '—', color: 'text-accent-blue' },
              ].map(s => (
                <div key={s.label} className="bg-dark-700/40 rounded-lg px-3 py-2.5 text-center">
                  <div className={clsx('text-lg font-bold tabular-nums', s.color || 'text-gray-200')}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 收益率曲线 */}
          <div className="border border-dark-600 rounded-xl bg-dark-800/60 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-300">历史收益率曲线（每日均倍数）</h4>
              {snaps.length > 0 && (
                <div className="flex gap-3">
                  {snaps.map(s => {
                    const pct = s.avg_mult * 100
                    const color = pct >= 100 ? 'text-yellow-300' : pct >= 30 ? 'text-green-400' : pct >= 0 ? 'text-green-600' : 'text-red-400'
                    return (
                      <div key={s.date} className="text-xs text-center">
                        <div className={clsx('font-bold font-mono', color)}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</div>
                        <div className="text-gray-600">{s.date?.slice(5)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <DetailSparkline points={snaps} />
          </div>
        </div>

        {/* 右：跟单配置 */}
        <div className="space-y-4">
          {editing && editForm ? (
            <div className="border border-accent-blue/30 rounded-xl bg-dark-800/60 px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-200">{followCfg ? '编辑跟单配置' : '设置跟单'}</h4>
                <button onClick={() => setF('enabled', !editForm.enabled)}
                  className={clsx('relative w-10 h-5 rounded-full transition-colors shrink-0',
                    editForm.enabled ? 'bg-accent-blue' : 'bg-dark-600')}>
                  <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    editForm.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">买入金额 (U)</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {[0.05,0.1,0.2,0.5,1].map(v => (
                      <button key={v} onClick={() => setF('buy_amount', v)}
                        className={clsx('text-xs px-2 py-0.5 rounded border transition-colors',
                          editForm.buy_amount === v ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10' : 'border-dark-500 text-gray-500 hover:text-gray-300'
                        )}>{v}U</button>
                    ))}
                  </div>
                  <input type="number" step="0.01" min="0.01" value={editForm.buy_amount}
                    onChange={e => setF('buy_amount', parseFloat(e.target.value)||0.1)}
                    className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">止盈 (%)</label>
                    <input type="number" step="5" min="5" value={editForm.take_profit}
                      onChange={e => setF('take_profit', parseFloat(e.target.value)||50)}
                      className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">止损 (%)</label>
                    <input type="number" step="5" min="5" value={editForm.stop_loss}
                      onChange={e => setF('stop_loss', parseFloat(e.target.value)||30)}
                      className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">最长持仓（分钟）</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {[30,60,120,240].map(v => (
                      <button key={v} onClick={() => setF('max_hold_min', v)}
                        className={clsx('text-xs px-2 py-0.5 rounded border transition-colors',
                          editForm.max_hold_min === v ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10' : 'border-dark-500 text-gray-500 hover:text-gray-300'
                        )}>{v}分</button>
                    ))}
                  </div>
                  <input type="number" step="10" min="10" value={editForm.max_hold_min}
                    onChange={e => setF('max_hold_min', parseInt(e.target.value)||60)}
                    className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">备注</label>
                  <input type="text" value={editForm.note||''} placeholder="可选"
                    onChange={e => setF('note', e.target.value)}
                    className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                {followCfg && (
                  <button onClick={handleDelete} disabled={deleting}
                    className="px-3 py-1.5 text-xs rounded border border-red-700/50 text-red-400 hover:bg-red-900/20 transition-colors">
                    {deleting ? '删除中…' : '取消跟单'}
                  </button>
                )}
                <button onClick={() => setEditing(false)}
                  className="flex-1 py-1.5 text-xs rounded border border-dark-500 text-gray-500 hover:text-gray-300 transition-colors">取消</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-1.5 text-xs rounded bg-accent-blue/90 hover:bg-accent-blue text-white font-medium transition-colors">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ) : followCfg ? (
            <div className="border border-green-800/40 rounded-xl bg-green-900/10 px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-green-400">当前跟单配置</h4>
                <div className="flex items-center gap-2">
                  <span className={clsx('text-xs px-2 py-0.5 rounded border',
                    followCfg.enabled ? 'border-green-600/40 text-green-400 bg-green-900/20' : 'border-gray-600 text-gray-500')}>
                    {followCfg.enabled ? '启用中' : '已暂停'}
                  </span>
                  <button onClick={startEdit}
                    className="text-xs px-2.5 py-0.5 rounded border border-dark-500 text-gray-400 hover:text-gray-200 hover:border-dark-400 transition-colors">编辑</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '买入金额', value: `${followCfg.buy_amount}U`, color: 'text-accent-blue' },
                  { label: '止盈', value: `+${followCfg.take_profit}%`, color: 'text-green-400' },
                  { label: '止损', value: `-${followCfg.stop_loss}%`, color: 'text-red-400' },
                  { label: '最长持仓', value: `${followCfg.max_hold_min}分`, color: 'text-gray-200' },
                ].map(f => (
                  <div key={f.label} className="bg-dark-700/40 rounded-lg px-3 py-2.5 text-center">
                    <div className={clsx('text-base font-bold', f.color)}>{f.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{f.label}</div>
                  </div>
                ))}
              </div>
              {followCfg.note && <p className="text-xs text-gray-500 mt-3">备注：{followCfg.note}</p>}
            </div>
          ) : (
            <div className="border border-dark-600 rounded-xl bg-dark-800/60 px-5 py-6 flex flex-col items-center justify-center gap-3 text-center">
              <div className="text-gray-600 text-sm">尚未配置跟单</div>
              <button onClick={startEdit}
                className="text-xs px-4 py-2 rounded border border-accent-blue/50 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20 transition-colors">
                + 设置跟单
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 代币详情表格 */}
      {records.length > 0 && (
        <div className="border border-dark-600 rounded-xl bg-dark-800/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-dark-600 flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-300">今日喊单代币 <span className="text-gray-500 font-normal">（{records.length} 条）</span></h4>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700/60 bg-dark-800/40">
                {[
                  { key: 'symbol',     label: '代币',     cls: 'px-4 text-left' },
                  { key: 'call_time',  label: '喊单时间', cls: 'px-4 text-center' },
                  { key: 'multiplier', label: '涨幅',     cls: 'px-4 text-center' },
                  { key: null,         label: '当前价',   cls: 'px-4 text-right' },
                  { key: null,         label: '最高价',   cls: 'px-4 text-right' },
                  { key: null,         label: '合约地址', cls: 'px-4 text-left hidden lg:table-cell' },
                ].map(({ key, label, cls }, i) => (
                  <th key={i}
                    className={clsx('py-2.5 text-xs font-medium', cls,
                      key ? 'cursor-pointer select-none text-gray-400 hover:text-gray-200' : 'text-gray-500'
                    )}
                    onClick={key ? () => handleTokenSort(key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}{key && <SortIcon k={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((r, i) => {
                const detectedChain = r.chain ? (r.chain || '').toLowerCase() : guessChain(r.token)
                const chain = { ...(CHAIN_CFG[detectedChain] || CHAIN_CFG.unknown), key: detectedChain }
                const pct = (r.multiplier || 0) * 100
                const pctColor = pct >= 100 ? 'text-yellow-300' : pct >= 20 ? 'text-green-400' : pct >= 0 ? 'text-green-600' : 'text-red-400'
                const callTime = r.call_time ? new Date(r.call_time) : null
                const timeStr = callTime
                  ? callTime.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
                  : '—'
                const dateStr = callTime
                  ? callTime.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' })
                  : ''
                return (
                  <tr key={i} className="border-b border-dark-700/30 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <TokenLogo token={r.token} chain={chain.key} symbol={r.symbol} size={28} />
                        <div>
                          <div className="text-sm font-medium text-gray-200 leading-tight">{r.symbol || '—'}</div>
                          <span className={clsx('text-[10px] font-bold px-1 py-0 rounded border', chain.color)}>{chain.label}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="text-sm text-gray-300 tabular-nums">{timeStr}</div>
                      {dateStr && <div className="text-xs text-gray-600">{dateStr}</div>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('text-base font-bold tabular-nums font-mono', pctColor)}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                      <div className="text-[10px] text-gray-600 mt-0.5">最大涨幅</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-gray-400 font-mono tabular-nums">
                        {r.current_price_usd ? `$${parseFloat(r.current_price_usd).toExponential(3)}` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-gray-400 font-mono tabular-nums">
                        {r.max_price ? `$${parseFloat(r.max_price).toExponential(3)}` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-600 font-mono"
                        title={r.token}>
                        {r.token ? `${r.token.slice(0, 6)}…${r.token.slice(-6)}` : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
