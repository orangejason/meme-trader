"""
交易历史接口
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db, Trade, CaFeed, TokenDetail
from datetime import datetime, timedelta, timezone
import json

router = APIRouter(prefix="/api/trades", tags=["trades"])


def _period_cutoff(period: str) -> datetime | None:
    """返回 UTC 截止时间，period='all' 返回 None"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "hour":  now - timedelta(hours=1),
        "day":   now - timedelta(days=1),
        "week":  now - timedelta(weeks=1),
        "month": now - timedelta(days=30),
        "year":  now - timedelta(days=365),
    }.get(period)


async def _get_token_meta_batch(db: AsyncSession, cas: list[str]) -> dict[str, dict]:
    """批量查代币元信息，优先 token_detail（AVE真实数据），fallback ca_feed"""
    if not cas:
        return {}

    meta: dict[str, dict] = {}

    # 第一步：从 token_detail 批量查（AVE API 数据，未打码）
    try:
        result = await db.execute(
            select(TokenDetail).where(TokenDetail.ca.in_(cas))
            .order_by(TokenDetail.fetched_at.desc())
        )
        for td in result.scalars().all():
            if td.ca not in meta and (td.token_name or td.symbol):
                meta[td.ca] = {"token_name": td.token_name or "", "symbol": td.symbol or "", "logo_url": ""}
    except Exception:
        pass

    # 第二步：未命中的从 ca_feed 补充
    missing = [ca for ca in cas if ca not in meta]
    if missing:
        try:
            result = await db.execute(
                select(CaFeed).where(CaFeed.ca.in_(missing)).order_by(CaFeed.received_at.desc())
            )
            for feed in result.scalars().all():
                if feed.ca in meta:
                    continue
                name = (feed.token_name or "").replace("*", "").strip()
                symbol = (feed.symbol or "").replace("*", "").strip()
                logo_url = ""
                if feed.raw_json:
                    raw = json.loads(feed.raw_json)
                    logo_url = raw.get("logo_url", "") or ""
                    if not name:
                        name = (raw.get("name", "") or "").replace("*", "").strip()
                    if not symbol:
                        symbol = (raw.get("symbol", "") or "").replace("*", "").strip()
                meta[feed.ca] = {"token_name": name, "symbol": symbol, "logo_url": logo_url}
        except Exception:
            pass

    return meta


@router.get("/history")
async def get_trade_history(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Trade).where(
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        ).order_by(Trade.close_time.desc()).limit(limit).offset(offset)
    )
    trades = result.scalars().all()
    cas = list({t.ca for t in trades})
    meta_map = await _get_token_meta_batch(db, cas)
    return [_serialize(t, meta_map.get(t.ca, {})) for t in trades]


@router.get("/stats")
async def get_trade_stats(
    period: str = Query("all", regex="^(hour|day|week|month|year|all)$"),
    db: AsyncSession = Depends(get_db),
):
    """统计数据：总盈亏、胜率等（只统计有真实 tx 的交易）支持时段过滤"""
    result = await db.execute(select(Trade))
    trades = result.scalars().all()
    trades = [t for t in trades if getattr(t, 'buy_tx', '') or getattr(t, 'sell_tx', '')]

    # 按时段过滤
    cutoff = _period_cutoff(period)
    if cutoff:
        trades = [t for t in trades if t.close_time and t.close_time >= cutoff]

    empty = {
        "total_trades": 0, "win_trades": 0, "loss_trades": 0,
        "win_rate": 0, "total_pnl_usdt": 0, "total_invested": 0,
        "total_gas_usd": 0, "avg_win": 0, "avg_loss": 0,
        "max_win": 0, "max_loss": 0, "profit_factor": None,
        "best_streak": 0, "worst_streak": 0, "period": period,
    }
    if not trades:
        return empty

    total = len(trades)
    wins = sum(1 for t in trades if t.pnl_usdt > 0)
    total_pnl = sum(t.pnl_usdt for t in trades)
    total_invested = sum(t.amount_usdt for t in trades)
    total_gas = sum(getattr(t, 'gas_fee_usd', 0) or 0 for t in trades)

    win_pnls  = [t.pnl_usdt for t in trades if t.pnl_usdt > 0]
    loss_pnls = [t.pnl_usdt for t in trades if t.pnl_usdt <= 0]

    avg_win  = round(sum(win_pnls)  / len(win_pnls),  4) if win_pnls  else 0
    avg_loss = round(sum(loss_pnls) / len(loss_pnls), 4) if loss_pnls else 0
    max_win  = round(max(win_pnls),  4) if win_pnls  else 0
    max_loss = round(min(loss_pnls), 4) if loss_pnls else 0

    # 盈利因子 = 总盈利 / 总亏损绝对值
    total_win_sum  = sum(win_pnls)
    total_loss_abs = abs(sum(loss_pnls)) if loss_pnls else 0
    profit_factor  = round(total_win_sum / total_loss_abs, 2) if total_loss_abs > 0 else None

    # 最长连胜/连败
    best_streak = worst_streak = cur_w = cur_l = 0
    for t in sorted(trades, key=lambda x: x.close_time):
        if t.pnl_usdt > 0:
            cur_w += 1; cur_l = 0
        else:
            cur_l += 1; cur_w = 0
        best_streak  = max(best_streak,  cur_w)
        worst_streak = max(worst_streak, cur_l)

    return {
        "total_trades":   total,
        "win_trades":     wins,
        "loss_trades":    total - wins,
        "win_rate":       round(wins / total * 100, 1),
        "total_pnl_usdt": round(total_pnl, 4),
        "total_invested": round(total_invested, 4),
        "total_gas_usd":  round(total_gas, 4),
        "avg_win":        avg_win,
        "avg_loss":       avg_loss,
        "max_win":        max_win,
        "max_loss":       max_loss,
        "profit_factor":  profit_factor,
        "best_streak":    best_streak,
        "worst_streak":   worst_streak,
        "period":         period,
    }


def _serialize(t: Trade, meta: dict = None) -> dict:
    return {
        "id": t.id,
        "position_id": t.position_id,
        "ca": t.ca,
        "chain": t.chain,
        "entry_price": t.entry_price,
        "exit_price": t.exit_price,
        "amount_usdt": t.amount_usdt,
        "pnl_usdt": round(t.pnl_usdt, 4),
        "pnl_pct": round(t.pnl_pct, 2),
        "reason": t.reason,
        "open_time": t.open_time.isoformat() + "Z",
        "close_time": t.close_time.isoformat() + "Z",
        "buy_tx": getattr(t, 'buy_tx', '') or '',
        "sell_tx": getattr(t, 'sell_tx', '') or '',
        "gas_fee_usd": round(getattr(t, 'gas_fee_usd', 0) or 0, 4),
        "token_name": (meta or {}).get("token_name", ""),
        "symbol": (meta or {}).get("symbol", ""),
        "logo_url": (meta or {}).get("logo_url", ""),
    }
