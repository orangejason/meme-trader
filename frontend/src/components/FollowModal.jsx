import { useState, useEffect } from 'react'
import { clsx } from 'clsx'

export default function FollowModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    enabled: true,
    buy_amount: 0.1,
    take_profit: 50,
    stop_loss: 30,
    max_hold_min: 60,
    note: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exists, setExists] = useState(false)

  useEffect(() => {
    fetch(`/api/analytics/caller_detail/${encodeURIComponent(item.qy_wxid)}`)
      .then(r => r.json())
      .then(d => {
        if (d.follow) {
          setForm({
            enabled: d.follow.enabled,
            buy_amount: d.follow.buy_amount,
            take_profit: d.follow.take_profit,
            stop_loss: d.follow.stop_loss,
            max_hold_min: d.follow.max_hold_min,
            note: d.follow.note || '',
          })
          setExists(true)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [item.qy_wxid])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/analytics/follow_traders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wxid: item.qy_wxid, name: item.name || '', ...form }),
      })
      const d = await r.json()
      if (d.success) { onSaved?.(); onClose() }
      else alert('保存失败')
    } catch (e) { alert('保存失败: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('确认取消跟单？')) return
    setDeleting(true)
    try {
      await fetch(`/api/analytics/follow_traders/${encodeURIComponent(item.qy_wxid)}`, { method: 'DELETE' })
      onSaved?.(); onClose()
    } catch (e) { alert('删除失败') }
    finally { setDeleting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-[400px] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">跟单设置</h3>
            <p className="text-xs text-gray-500 mt-0.5">{item.name || '匿名'}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-600 text-sm">加载中...</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300 font-medium">启用跟单</p>
                <p className="text-xs text-gray-600 mt-0.5">开启后该喊单人的CA会自动买入</p>
              </div>
              <button
                onClick={() => set('enabled', !form.enabled)}
                className={clsx(
                  'relative w-11 h-6 rounded-full transition-colors',
                  form.enabled ? 'bg-accent-blue' : 'bg-dark-600'
                )}
              >
                <span className={clsx(
                  'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  form.enabled ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
            </div>

            {/* 买入金额 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">买入金额 (USDT)</label>
              <div className="flex gap-1 flex-wrap mb-1">
                {[0.05, 0.1, 0.2, 0.5, 1].map(v => (
                  <button key={v} onClick={() => set('buy_amount', v)}
                    className={clsx('text-xs px-2 py-0.5 rounded border transition-colors',
                      form.buy_amount === v
                        ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10'
                        : 'border-dark-500 text-gray-500 hover:text-gray-300'
                    )}>{v}U</button>
                ))}
              </div>
              <input type="number" step="0.01" min="0.01" value={form.buy_amount}
                onChange={e => set('buy_amount', parseFloat(e.target.value) || 0.1)}
                className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
            </div>

            {/* 止盈止损 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">止盈 (%)</label>
                <input type="number" step="5" min="5" value={form.take_profit}
                  onChange={e => set('take_profit', parseFloat(e.target.value) || 50)}
                  className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">止损 (%)</label>
                <input type="number" step="5" min="5" value={form.stop_loss}
                  onChange={e => set('stop_loss', parseFloat(e.target.value) || 30)}
                  className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
              </div>
            </div>

            {/* 最长持仓 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">最长持仓（分钟）</label>
              <div className="flex gap-1 flex-wrap mb-1">
                {[30, 60, 120, 240].map(v => (
                  <button key={v} onClick={() => set('max_hold_min', v)}
                    className={clsx('text-xs px-2 py-0.5 rounded border transition-colors',
                      form.max_hold_min === v
                        ? 'border-accent-blue/60 text-accent-blue bg-accent-blue/10'
                        : 'border-dark-500 text-gray-500 hover:text-gray-300'
                    )}>{v}分</button>
                ))}
              </div>
              <input type="number" step="10" min="10" value={form.max_hold_min}
                onChange={e => set('max_hold_min', parseInt(e.target.value) || 60)}
                className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
            </div>

            {/* 备注 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">备注</label>
              <input type="text" value={form.note} placeholder="可选"
                onChange={e => set('note', e.target.value)}
                className="w-full bg-dark-700 border border-dark-500 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent-blue/60" />
            </div>

            {/* 按钮 */}
            <div className="flex gap-2 pt-1">
              {exists && (
                <button onClick={handleDelete} disabled={deleting}
                  className="px-3 py-2 text-xs rounded border border-red-700/50 text-red-400 hover:bg-red-900/20 transition-colors">
                  {deleting ? '删除中...' : '取消跟单'}
                </button>
              )}
              <button onClick={onClose}
                className="flex-1 py-2 text-xs rounded border border-dark-500 text-gray-500 hover:text-gray-300 transition-colors">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-xs rounded bg-accent-blue/90 hover:bg-accent-blue text-white font-medium transition-colors">
                {saving ? '保存中...' : (exists ? '更新跟单' : '开始跟单')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
