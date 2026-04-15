"""
分析数据 API
提供漏斗统计、链分布、发币人排行、P&L 曲线、CA 流水列表、持仓价格曲线
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, Integer
from datetime import datetime, timedelta
import hashlib
from database import get_db, CaFeed, SenderStats, Trade, Position, PriceSnapshot, LeaderboardSnapshot, FollowTrader


def _short_hash(s: str, length: int = 4) -> str:
    """把字符串哈希成固定长度的大写十六进制编号，用于隐藏真实名称"""
    if not s:
        return "????"
    return hashlib.md5(s.encode('utf-8', errors='replace')).hexdigest()[:length].upper()

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/signal_overview")
async def get_signal_overview(
    period: str = "day",   # hour | day | week | month | year
    db: AsyncSession = Depends(get_db),
):
    """MEME信号总览：总推送次数、独立CA数、过滤通过率、时序折线数据"""
    from sqlalchemy import text as _text

    PERIOD_MAP = {
        "hour":  (timedelta(hours=1),   "%Y-%m-%d %H:%M", 60, timedelta(minutes=1)),
        "day":   (timedelta(days=1),    "%Y-%m-%d %H",    24, timedelta(hours=1)),
        "week":  (timedelta(weeks=1),   "%Y-%m-%d",        7, timedelta(days=1)),
        "month": (timedelta(days=30),   "%Y-%m-%d",       30, timedelta(days=1)),
        "year":  (timedelta(days=365),  "%Y-%m",          12, timedelta(days=30)),
    }
    delta, fmt, buckets, bucket_size = PERIOD_MAP.get(period, PERIOD_MAP["day"])
    cutoff = datetime.utcnow() - delta

    # 总量统计
    total_q = await db.execute(
        select(
            func.count().label("total"),
            func.count(func.distinct(CaFeed.ca)).label("unique_ca"),
            func.sum(func.cast(CaFeed.filter_passed, Integer)).label("passed"),
            func.sum(func.cast(CaFeed.bought, Integer)).label("bought"),
        ).where(CaFeed.received_at >= cutoff)
    )
    row = total_q.first()
    total      = row.total or 0
    unique_ca  = row.unique_ca or 0
    passed     = int(row.passed or 0)
    bought_cnt = int(row.bought or 0)

    # 时序折线（按 bucket 聚合推送次数和独立CA）
    series_q = await db.execute(
        select(
            func.strftime(fmt, CaFeed.received_at).label("bucket"),
            func.count().label("cnt"),
            func.count(func.distinct(CaFeed.ca)).label("uniq"),
            func.sum(func.cast(CaFeed.filter_passed, Integer)).label("pass_cnt"),
        )
        .where(CaFeed.received_at >= cutoff)
        .group_by("bucket")
        .order_by("bucket")
    )
    series = [
        {"t": r.bucket, "cnt": r.cnt, "uniq": r.uniq, "pass": int(r.pass_cnt or 0)}
        for r in series_q
    ]

    return {
        "period": period,
        "total": total,
        "unique_ca": unique_ca,
        "passed": passed,
        "bought": bought_cnt,
        "pass_rate": round(passed / total * 100, 1) if total else 0,
        "buy_rate": round(bought_cnt / total * 100, 1) if total else 0,
        "series": series,
    }


# ── 漏斗统计 ──────────────────────────────────────────────────────────────────
@router.get("/funnel")
async def get_funnel(days: int = 7, db: AsyncSession = Depends(get_db)):
    """
    返回过去 N 天的漏斗数据:
    total_received → filter_passed → bought → profitable
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    total_result = await db.execute(
        select(func.count()).select_from(CaFeed).where(CaFeed.received_at >= cutoff)
    )
    total = total_result.scalar() or 0

    passed_result = await db.execute(
        select(func.count()).select_from(CaFeed).where(
            CaFeed.received_at >= cutoff, CaFeed.filter_passed == True
        )
    )
    passed = passed_result.scalar() or 0

    bought_result = await db.execute(
        select(func.count()).select_from(CaFeed).where(
            CaFeed.received_at >= cutoff, CaFeed.bought == True
        )
    )
    bought = bought_result.scalar() or 0

    # 盈利笔数（只统计有真实 tx 的交易）
    profit_result = await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.close_time >= cutoff, Trade.pnl_usdt > 0,
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    profitable = profit_result.scalar() or 0

    # 亏损笔数（只统计有真实 tx 的交易）
    loss_result = await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.close_time >= cutoff, Trade.pnl_usdt <= 0,
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    loss = loss_result.scalar() or 0

    # 过滤通过但未买入（passed 但 bought=False）
    not_bought_result = await db.execute(
        select(func.count()).select_from(CaFeed).where(
            CaFeed.received_at >= cutoff,
            CaFeed.filter_passed == True,
            CaFeed.bought == False,
        )
    )
    not_bought = not_bought_result.scalar() or 0

    # 按拦截原因分组统计
    reason_result = await db.execute(
        select(CaFeed.filter_reason, func.count().label("cnt"))
        .where(CaFeed.received_at >= cutoff, CaFeed.filter_passed == False)
        .group_by(CaFeed.filter_reason)
        .order_by(desc("cnt"))
        .limit(10)
    )
    filter_breakdown = [{"reason": r, "count": c} for r, c in reason_result.all()]

    return {
        "days": days,
        "total_received": total,
        "filter_passed": passed,
        "not_bought": not_bought,
        "bought": bought,
        "profitable": profitable,
        "loss": loss,
        "filter_breakdown": filter_breakdown,
    }


# ── 链分布 ────────────────────────────────────────────────────────────────────
@router.get("/chain_distribution")
async def get_chain_distribution(days: int = 7, db: AsyncSession = Depends(get_db)):
    cutoff = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(CaFeed.chain, func.count().label("cnt"))
        .where(CaFeed.received_at >= cutoff)
        .group_by(CaFeed.chain)
        .order_by(desc("cnt"))
    )
    rows = result.all()

    bought_result = await db.execute(
        select(CaFeed.chain, func.count().label("cnt"))
        .where(CaFeed.received_at >= cutoff, CaFeed.bought == True)
        .group_by(CaFeed.chain)
    )
    bought_map = {r.chain: r.cnt for r in bought_result.all()}

    return [
        {
            "chain": r.chain or "UNKNOWN",
            "total": r.cnt,
            "bought": bought_map.get(r.chain, 0),
        }
        for r in rows
    ]


# ── 发币人排行 ─────────────────────────────────────────────────────────────────
@router.get("/sender_leaderboard")
async def get_sender_leaderboard(
    limit: int = 50,
    sort_by: str = Query("total_pushed", enum=["total_pnl_usdt", "win_count", "total_pushed", "ws_win_rate", "ws_total_tokens"]),
    days: int = 30,
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.utcnow() - timedelta(days=days)

    # 从 CaFeed 聚合每个发币人的推送统计（包含没有买入记录的）
    feed_result = await db.execute(
        select(
            CaFeed.sender,
            func.count().label("feed_total"),
            func.sum(func.cast(CaFeed.bought, Integer)).label("feed_bought"),
            func.max(CaFeed.sender_win_rate).label("ws_win_rate"),
            func.max(CaFeed.sender_total_tokens).label("ws_total_tokens"),
            func.max(CaFeed.sender_best_multiple).label("ws_best_multiple"),
            func.max(CaFeed.received_at).label("last_seen"),
        )
        .where(CaFeed.received_at >= cutoff, CaFeed.sender != "")
        .group_by(CaFeed.sender)
    )
    feed_rows = {r.sender: r for r in feed_result.all()}

    # 从 SenderStats 取本地交易结果
    stats_result = await db.execute(select(SenderStats))
    stats_map = {r.sender: r for r in stats_result.scalars().all()}

    # 合并两个数据源
    senders = set(feed_rows.keys()) | set(stats_map.keys())
    merged = []
    for sender in senders:
        f = feed_rows.get(sender)
        s = stats_map.get(sender)
        if not f and not s:
            continue
        feed_total = int(f.feed_total) if f else (s.total_pushed or 0)
        feed_bought = int(f.feed_bought or 0) if f else (s.total_bought or 0)
        win_count = s.win_count or 0 if s else 0
        loss_count = s.loss_count or 0 if s else 0
        total_closed = win_count + loss_count
        merged.append({
            "sender": sender,
            "total_pushed": feed_total,
            "total_bought": feed_bought,
            "win_count": win_count,
            "loss_count": loss_count,
            "win_rate": round(win_count / total_closed * 100, 1) if total_closed > 0 else 0,
            "total_pnl_usdt": round(s.total_pnl_usdt or 0, 2) if s else 0,
            "best_pnl_pct": round(s.best_pnl_pct or 0, 1) if s else 0,
            "worst_pnl_pct": round(s.worst_pnl_pct or 0, 1) if s else 0,
            "ws_win_rate": float(f.ws_win_rate or 0) if f else float(s.ws_win_rate or 0 if s else 0),
            "ws_total_tokens": int(f.ws_total_tokens or 0) if f else int(s.ws_total_tokens or 0 if s else 0),
            "ws_best_multiple": float(f.ws_best_multiple or 0) if f else float(s.ws_best_multiple or 0 if s else 0),
            "last_seen": (f.last_seen.isoformat() + "Z") if f and f.last_seen else ((s.last_seen.isoformat() + "Z") if s and s.last_seen else None),
            "has_trade": feed_bought > 0,
        })

    # 排序
    sort_key_map = {
        "total_pushed": lambda x: x["total_pushed"],
        "total_pnl_usdt": lambda x: x["total_pnl_usdt"],
        "win_count": lambda x: x["win_count"],
        "ws_win_rate": lambda x: x["ws_win_rate"],
        "ws_total_tokens": lambda x: x["ws_total_tokens"],
    }
    merged.sort(key=sort_key_map.get(sort_by, lambda x: x["total_pushed"]), reverse=True)
    return merged[:limit]


# ── P&L 时间序列 ──────────────────────────────────────────────────────────────
@router.get("/pnl_series")
async def get_pnl_series(days: int = 30, db: AsyncSession = Depends(get_db)):
    """返回每日累计 P&L 数据点，用于折线图"""
    cutoff = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(Trade)
        .where(
            Trade.close_time >= cutoff,
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
        .order_by(Trade.close_time)
    )
    trades = result.scalars().all()

    cumulative = 0.0
    series = []
    for t in trades:
        cumulative += t.pnl_usdt
        series.append({
            "time": t.close_time.isoformat() + "Z",
            "pnl_usdt": round(t.pnl_usdt, 4),
            "cumulative_pnl": round(cumulative, 4),
            "reason": t.reason,
            "ca": t.ca,
            "chain": t.chain,
        })

    # 统计汇总
    total_pnl = sum(t.pnl_usdt for t in trades)
    win_trades = [t for t in trades if t.pnl_usdt > 0]
    loss_trades = [t for t in trades if t.pnl_usdt <= 0]

    return {
        "series": series,
        "summary": {
            "total_trades": len(trades),
            "win_trades": len(win_trades),
            "loss_trades": len(loss_trades),
            "win_rate": round(len(win_trades) / len(trades) * 100, 1) if trades else 0,
            "total_pnl_usdt": round(total_pnl, 4),
            "avg_pnl_usdt": round(total_pnl / len(trades), 4) if trades else 0,
            "best_trade": round(max((t.pnl_usdt for t in trades), default=0), 4),
            "worst_trade": round(min((t.pnl_usdt for t in trades), default=0), 4),
        },
    }


# ── CA 流水列表 ───────────────────────────────────────────────────────────────
@router.get("/ca_feed")
async def get_ca_feed(
    page: int = 1,
    page_size: int = 50,
    chain: str = "",
    filter_passed: str = "",   # "true" | "false" | ""
    bought: str = "",          # "true" | "false" | ""
    days: int = 7,
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.utcnow() - timedelta(days=days)
    q = select(CaFeed).where(CaFeed.received_at >= cutoff)

    if chain:
        q = q.where(CaFeed.chain == chain.upper())
    if filter_passed == "true":
        q = q.where(CaFeed.filter_passed == True)
    elif filter_passed == "false":
        q = q.where(CaFeed.filter_passed == False)
    if bought == "true":
        q = q.where(CaFeed.bought == True)
    elif bought == "false":
        q = q.where(CaFeed.bought == False)

    count_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total = count_result.scalar() or 0

    q = q.order_by(desc(CaFeed.received_at)).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    rows = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": [
            {
                "id": r.id,
                "received_at": r.received_at.isoformat() + "Z",
                "ca": r.ca,
                "chain": r.chain,
                "token_name": r.token_name,
                "symbol": r.symbol,
                "sender": r.sender,
                "sender_win_rate": r.sender_win_rate,
                "current_multiple": r.current_multiple,
                "bqfc": r.bqfc,
                "qwfc": r.qwfc,
                "fgq": r.fgq,
                "market_cap": r.market_cap,
                "holders": r.holders,
                "risk_score": r.risk_score,
                "grcxcs": r.grcxcs,
                "filter_passed": r.filter_passed,
                "filter_reason": r.filter_reason,
                "bought": r.bought,
                "position_id": r.position_id,
            }
            for r in rows
        ],
    }


@router.get("/recent_signals")
async def get_recent_signals(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """最近信号流，用于首页展示。sender/group 脱敏为哈希编号。"""
    import json as _json
    q = select(CaFeed).order_by(desc(CaFeed.received_at)).limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()

    # 批量查每条记录的 CA 是第几次出现（在整个 ca_feed 表中的历史推送次数）
    ca_list = list({r.ca for r in rows})
    ca_counts: dict[str, int] = {}
    if ca_list:
        count_q = select(CaFeed.ca, func.count().label("cnt")).where(CaFeed.ca.in_(ca_list)).group_by(CaFeed.ca)
        count_result = await db.execute(count_q)
        ca_counts = {row.ca: row.cnt for row in count_result}

    out = []
    for r in rows:
        # 从 raw_json 补读 qun_name（社区）和 qy_name（喊单人）及胜率
        group_raw = ""
        sender_raw = r.sender or ""
        win_rate = r.sender_win_rate or 0.0
        try:
            raw = _json.loads(r.raw_json or "{}")
            group_raw = raw.get("qun_name", "") or ""
            if not sender_raw:
                sender_raw = raw.get("qy_name", "") or ""
            if not win_rate:
                win_rate = float(raw.get("sender_win_rate") or 0)
        except Exception:
            pass

        out.append({
            "id": r.id,
            "received_at": r.received_at.isoformat() + "Z",
            "ca": r.ca,
            "chain": r.chain,
            "symbol": r.symbol or r.token_name or "",
            "push_count": ca_counts.get(r.ca, 1),   # 我们自己统计的总推送次数
            "sender_id": _short_hash(sender_raw) if sender_raw else None,
            "sender_win_rate": round(win_rate, 1) if win_rate else None,
            "group_id": _short_hash(group_raw) if group_raw else None,
            "filter_passed": r.filter_passed,
            "bought": r.bought,
        })
    return out


# ── 持仓价格曲线 ───────────────────────────────────────────────────────────────
@router.get("/price_curve/{position_id}")
async def get_price_curve(position_id: int, db: AsyncSession = Depends(get_db)):
    """返回某持仓的完整价格快照数组，用于画 K 线/折线图"""
    result = await db.execute(
        select(PriceSnapshot)
        .where(PriceSnapshot.position_id == position_id)
        .order_by(PriceSnapshot.timestamp)
    )
    snaps = result.scalars().all()

    pos_result = await db.execute(select(Position).where(Position.id == position_id))
    pos = pos_result.scalar_one_or_none()

    return {
        "position": {
            "id": pos.id,
            "ca": pos.ca,
            "chain": pos.chain,
            "entry_price": pos.entry_price,
            "amount_usdt": pos.amount_usdt,
            "status": pos.status,
            "open_time": (pos.open_time.isoformat() + "Z") if pos.open_time else None,
        } if pos else None,
        "snapshots": [
            {
                "timestamp": s.timestamp.isoformat() + "Z",
                "price": s.price,
                "pnl_pct": s.pnl_pct,
                "event_type": s.event_type,
            }
            for s in snaps
        ],
    }


# ── 整体统计汇总（Dashboard 用） ──────────────────────────────────────────────
@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db)):
    """供 Dashboard 顶部卡片使用的汇总数据"""
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # 今日 P&L（只统计有真实 tx 的交易）
    today_pnl_result = await db.execute(
        select(func.sum(Trade.pnl_usdt)).where(
            Trade.close_time >= today,
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    today_pnl = today_pnl_result.scalar() or 0.0

    # 总 P&L（只统计有真实 tx 的交易）
    total_pnl_result = await db.execute(
        select(func.sum(Trade.pnl_usdt)).where(
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    total_pnl = total_pnl_result.scalar() or 0.0

    # 总交易次数（只统计有真实 tx 的交易）
    total_trades_result = await db.execute(
        select(func.count()).select_from(Trade).where(
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    total_trades = total_trades_result.scalar() or 0

    # 胜率（只统计有真实 tx 的交易）
    win_result = await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.pnl_usdt > 0,
            (Trade.buy_tx != '') | (Trade.sell_tx != '')
        )
    )
    win_count = win_result.scalar() or 0
    win_rate = round(win_count / total_trades * 100, 1) if total_trades > 0 else 0

    # 今日收到 CA 数
    today_ca_result = await db.execute(
        select(func.count()).select_from(CaFeed).where(CaFeed.received_at >= today)
    )
    today_ca = today_ca_result.scalar() or 0

    # 开仓数
    open_pos_result = await db.execute(
        select(func.count()).select_from(Position).where(Position.status == "open")
    )
    open_positions = open_pos_result.scalar() or 0

    return {
        "today_pnl_usdt": round(today_pnl, 4),
        "total_pnl_usdt": round(total_pnl, 4),
        "total_trades": total_trades,
        "win_count": win_count,
        "win_rate": win_rate,
        "today_ca_received": today_ca,
        "open_positions": open_positions,
    }


# ── 钱包资产总览 ───────────────────────────────────────────────────────────────
CHAIN_NATIVE = {
    "SOL": "SOL",
    "BSC": "BNB",
    "ETH": "ETH",
    "XLAYER": "OKB",
}

@router.get("/portfolio")
async def get_portfolio(db: AsyncSession = Depends(get_db)):
    """
    返回各链钱包地址 + 主链余额 + 持仓代币估值
    主链余额调用 AVE Bot API（点击刷新时触发）
    持仓估值根据 position_price_source 配置决定实时/缓存
    """
    import asyncio
    from services.wallet_manager import wallet_manager
    from services.ave_client import ave_client
    from database import ConfigModel

    # 读配置
    cfg_result = await db.execute(select(ConfigModel))
    cfg = {r.key: r.value for r in cfg_result.scalars().all()}
    price_source = cfg.get("position_price_source", "cached")

    # 获取各链地址
    try:
        addresses = await wallet_manager.get_all_addresses_async()
    except Exception:
        addresses = {}

    # 读取所有开仓持仓，按链分组
    pos_result = await db.execute(
        select(Position).where(Position.status == "open")
    )
    open_positions = pos_result.scalars().all()

    # 如果需要实时价格，并发拉取所有持仓的当前价格
    price_cache: dict[str, float] = {}
    if price_source == "realtime" and open_positions:
        async def fetch_price(pos: Position):
            try:
                p = await ave_client.get_price(pos.ca, pos.chain)
                return pos.ca, p
            except Exception:
                return pos.ca, pos.current_price
        results = await asyncio.gather(*[fetch_price(p) for p in open_positions])
        price_cache = dict(results)

    # 按链整理持仓数据
    chain_positions: dict[str, list] = {}
    total_position_value = 0.0
    for pos in open_positions:
        price = price_cache.get(pos.ca, pos.current_price) if price_source == "realtime" else pos.current_price
        price = price or pos.entry_price or 0.0
        value_usdt = price * pos.token_amount if price > 0 else pos.amount_usdt
        pnl_pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.entry_price > 0 and price > 0 else 0.0
        total_position_value += value_usdt

        chain = pos.chain
        if chain not in chain_positions:
            chain_positions[chain] = []
        chain_positions[chain].append({
            "id": pos.id,
            "ca": pos.ca,
            "entry_price": pos.entry_price,
            "current_price": price,
            "token_amount": pos.token_amount,
            "amount_usdt": pos.amount_usdt,
            "value_usdt": round(value_usdt, 4),
            "pnl_pct": round(pnl_pct, 2),
            "open_time": (pos.open_time.isoformat() + "Z") if pos.open_time else None,
        })

    # 并发查询各链主链余额
    CHAINS = ["SOL", "BSC", "ETH", "XLAYER"]

    # ── 公链 RPC 配置 ─────────────────────────────────────────────────────────
    # EVM 链：用 eth_getBalance (JSON-RPC) 查主链币，用 eth_call 查 USDT 余额
    EVM_RPC = {
        "BSC":    "https://bsc-dataseed1.binance.org",
        "ETH":    "https://ethereum-rpc.publicnode.com",
        "XLAYER": "https://rpc.xlayer.tech",
    }
    # 各链 USDT 合约地址 + decimals
    USDT_CONTRACT = {
        "BSC": ("0x55d398326f99059fF775485246999027B3197955", 18),   # BSC-USDT (BEP20, 18位)
        "ETH": ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),    # ETH-USDT (ERC20, 6位)
    }
    SOL_RPC = "https://api.mainnet-beta.solana.com"

    async def _evm_rpc(rpc_url: str, payload: dict) -> dict:
        """通用 EVM JSON-RPC 调用"""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=6.0) as c:
                r = await c.post(rpc_url, json=payload)
                return r.json()
        except Exception:
            return {}

    async def fetch_evm_native(chain: str, addr: str):
        """查 EVM 主链原生币余额，返回 float (ether 单位)"""
        rpc = EVM_RPC.get(chain)
        if not rpc or not addr:
            return None
        try:
            data = await _evm_rpc(rpc, {
                "jsonrpc": "2.0", "id": 1, "method": "eth_getBalance",
                "params": [addr, "latest"]
            })
            hex_val = data.get("result", "0x0")
            return int(hex_val, 16) / 1e18
        except Exception:
            return None

    async def fetch_evm_token(chain: str, addr: str, token_contract: str, decimals: int = 6):
        """查 ERC20 token 余额（balanceOf），返回 float"""
        rpc = EVM_RPC.get(chain)
        if not rpc or not addr:
            return None
        # balanceOf(address) = keccak256 前4字节 + 32字节地址
        padded = addr.lower().replace("0x", "").zfill(64)
        data_hex = "0x70a08231" + padded
        try:
            resp = await _evm_rpc(rpc, {
                "jsonrpc": "2.0", "id": 1, "method": "eth_call",
                "params": [{"to": token_contract, "data": data_hex}, "latest"]
            })
            hex_val = resp.get("result", "0x0")
            return int(hex_val, 16) / (10 ** decimals)
        except Exception:
            return None

    async def fetch_sol_balance(addr: str):
        """查 SOL 主链余额（lamports → SOL）"""
        if not addr:
            return None
        import httpx
        try:
            async with httpx.AsyncClient(timeout=6.0) as c:
                r = await c.post(SOL_RPC, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "getBalance",
                    "params": [addr]
                })
                val = r.json().get("result", {}).get("value", None)
                return val / 1e9 if val is not None else None
        except Exception:
            return None

    async def fetch_balance(chain: str):
        addr = addresses.get(chain, "")
        if not addr:
            return chain, {"native": None, "usdt": None}
        try:
            if chain == "SOL":
                native = await fetch_sol_balance(addr)
                return chain, {"native": native, "usdt": None}
            else:
                native, usdt = await asyncio.gather(
                    fetch_evm_native(chain, addr),
                    fetch_evm_token(chain, addr, USDT_CONTRACT[chain][0], USDT_CONTRACT[chain][1]) if chain in USDT_CONTRACT else asyncio.sleep(0),
                )
                return chain, {"native": native, "usdt": usdt if chain in USDT_CONTRACT else None}
        except Exception:
            return chain, {"native": None, "usdt": None}

    balance_results = await asyncio.gather(*[fetch_balance(c) for c in CHAINS])
    balance_map = dict(balance_results)

    # 组装结果
    chains_data = []
    for chain in CHAINS:
        addr = addresses.get(chain, "")
        bal_info = balance_map.get(chain, {})
        native_bal = bal_info.get("native") if isinstance(bal_info, dict) else None
        usdt_bal = bal_info.get("usdt") if isinstance(bal_info, dict) else None
        positions_in_chain = chain_positions.get(chain, [])
        chain_pos_value = sum(p["value_usdt"] for p in positions_in_chain)

        chains_data.append({
            "chain": chain,
            "native_symbol": CHAIN_NATIVE.get(chain, chain),
            "address": addr,
            "native_balance": round(native_bal, 8) if native_bal is not None else None,
            "usdt_balance": round(usdt_bal, 4) if usdt_bal is not None else None,
            "positions": positions_in_chain,
            "position_count": len(positions_in_chain),
            "position_value_usdt": round(chain_pos_value, 4),
        })

    return {
        "price_source": price_source,
        "total_position_value_usdt": round(total_position_value, 4),
        "chains": chains_data,
    }


# ── CA 战绩排行榜 ──────────────────────────────────────────────────────────────
def _ca_leaderboard_range(period: str) -> tuple:
    """返回 (start_utc, end_utc)，None 表示无限制。北京时间 UTC+8 感知。"""
    now_utc = datetime.utcnow()
    bj_now = now_utc + timedelta(hours=8)
    bj_today_start = bj_now.replace(hour=0, minute=0, second=0, microsecond=0)
    utc_today_start = bj_today_start - timedelta(hours=8)

    ranges = {
        "morning":   (utc_today_start + timedelta(hours=6),  utc_today_start + timedelta(hours=12)),
        "afternoon": (utc_today_start + timedelta(hours=12), utc_today_start + timedelta(hours=18)),
        "evening":   (utc_today_start + timedelta(hours=18), utc_today_start + timedelta(hours=24)),
        "midnight":  (utc_today_start,                       utc_today_start + timedelta(hours=6)),
        "today":     (utc_today_start,                       None),
        "yesterday": (utc_today_start - timedelta(days=1),   utc_today_start),
        "week":      (now_utc - timedelta(days=7),           None),
        "month":     (now_utc - timedelta(days=30),          None),
        "quarter":   (now_utc - timedelta(days=90),          None),
        "year":      (now_utc - timedelta(days=365),         None),
        "all":       (None,                                  None),
    }
    return ranges.get(period, ranges["week"])


@router.get("/ca_leaderboard")
async def get_ca_leaderboard(
    period: str = "week",
    sort_by: str = "pnl",   # pnl | win_rate | best_pnl | count
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """CA 战绩排行榜：按 CA 聚合交易结果，附带叙事数据"""
    import json as _json

    start_utc, end_utc = _ca_leaderboard_range(period)

    # 1. 按时段过滤交易记录，排除 sell_failed
    q = select(Trade).where(Trade.reason != "sell_failed")
    if start_utc:
        q = q.where(Trade.close_time >= start_utc)
    if end_utc:
        q = q.where(Trade.close_time < end_utc)

    result = await db.execute(q.order_by(Trade.close_time))
    trades = result.scalars().all()

    if not trades:
        return []

    # 2. 按 ca+chain 聚合
    from collections import defaultdict
    groups: dict[tuple, list] = defaultdict(list)
    for t in trades:
        groups[(t.ca, t.chain)].append(t)

    # 3. 批量查 CaFeed（最新一条）
    ca_list = list({ca for ca, _ in groups.keys()})
    feed_map: dict[str, object] = {}
    if ca_list:
        # 子查询：每个 CA 最新的 CaFeed id
        subq = (
            select(func.max(CaFeed.id).label("max_id"))
            .where(CaFeed.ca.in_(ca_list))
            .group_by(CaFeed.ca)
        ).subquery()
        feed_result = await db.execute(
            select(CaFeed).where(CaFeed.id.in_(select(subq.c.max_id)))
        )
        for f in feed_result.scalars().all():
            feed_map[f.ca] = f

    # 4. 每笔交易的详情（用于展开行）—— 避免后续 lazy load
    def _trade_detail(t: Trade) -> dict:
        return {
            "id": t.id,
            "close_time": t.close_time.isoformat() + "Z",
            "open_time": t.open_time.isoformat() + "Z" if t.open_time else None,
            "pnl_usdt": round(t.pnl_usdt, 4),
            "pnl_pct": round(t.pnl_pct, 2),
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "amount_usdt": t.amount_usdt,
            "reason": t.reason,
            "buy_tx": t.buy_tx,
            "sell_tx": t.sell_tx,
        }

    # 5. 组装结果
    rows = []
    for (ca, chain), tlist in groups.items():
        total_pnl = sum(t.pnl_usdt for t in tlist)
        pnl_pcts = [t.pnl_pct for t in tlist]
        win_count = sum(1 for t in tlist if t.pnl_usdt > 0)
        trade_count = len(tlist)
        exit_reasons: dict[str, int] = {}
        for t in tlist:
            exit_reasons[t.reason] = exit_reasons.get(t.reason, 0) + 1

        # 叙事数据来自 CaFeed
        feed = feed_map.get(ca)
        narrative = {}
        if feed:
            sender_raw = feed.sender or ""
            group_raw = ""
            try:
                raw = _json.loads(feed.raw_json or "{}")
                group_raw = raw.get("qun_name", "") or ""
            except Exception:
                pass
            narrative = {
                "sender_id": _short_hash(sender_raw) if sender_raw else None,
                "group_id": _short_hash(group_raw) if group_raw else None,
                "sender_win_rate": feed.sender_win_rate,
                "group_win_rate": feed.sender_group_win_rate,
                "bqfc": feed.bqfc,
                "qwfc": feed.qwfc,
                "market_cap": feed.market_cap,
                "holders": feed.holders,
                "current_multiple": feed.current_multiple,
                "risk_score": feed.risk_score,
            }

        rows.append({
            "ca": ca,
            "chain": chain,
            "symbol": feed.symbol if feed else "",
            "token_name": feed.token_name if feed else "",
            "trade_count": trade_count,
            "total_pnl_usdt": round(total_pnl, 4),
            "avg_pnl_pct": round(sum(pnl_pcts) / len(pnl_pcts), 2),
            "best_pnl_pct": round(max(pnl_pcts), 2),
            "worst_pnl_pct": round(min(pnl_pcts), 2),
            "win_count": win_count,
            "win_rate": round(win_count / trade_count * 100, 1) if trade_count else 0,
            "exit_reasons": exit_reasons,
            "first_trade": min(t.close_time for t in tlist).isoformat() + "Z",
            "last_trade": max(t.close_time for t in tlist).isoformat() + "Z",
            "narrative": narrative,
            "trades": [_trade_detail(t) for t in sorted(tlist, key=lambda x: x.close_time, reverse=True)],
        })

    # 6. 排序
    sort_key = {
        "pnl": lambda x: x["total_pnl_usdt"],
        "win_rate": lambda x: (x["win_rate"], x["trade_count"]),
        "best_pnl": lambda x: x["best_pnl_pct"],
        "count": lambda x: x["trade_count"],
    }.get(sort_by, lambda x: x["total_pnl_usdt"])

    rows.sort(key=sort_key, reverse=True)
    return rows[:limit]


@router.get("/leaderboard_proxy")
async def leaderboard_proxy(rise_threshold: float = 0.2, db: AsyncSession = Depends(get_db)):
    """代理请求 hodlo.ai 牛人榜，顺带保存今日快照"""
    import httpx
    from sqlalchemy import select, delete
    url = f"https://hodlo.ai/api/v1/token-data/today-ca-senders-rank?rise_threshold={rise_threshold}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            r.raise_for_status()
            payload = r.json()

        # 保存今日快照（北京时间日期，每人每天只存一条，重复则更新）
        from datetime import timezone, timedelta
        bj_date = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%d")
        for item in payload.get("data", []):
            wxid = item.get("qy_wxid", "")
            ca_count = item.get("ca_count") or 0
            total_mult = item.get("total_multiplier") or 0.0
            avg_mult = total_mult / ca_count if ca_count > 0 else 0.0
            wr_str = item.get("today_win_rate", "0%")
            win_rate = float(str(wr_str).replace("%", "") or 0)

            # upsert：先删今天同一人的旧快照，再插新的
            await db.execute(
                delete(LeaderboardSnapshot).where(
                    LeaderboardSnapshot.wxid == wxid,
                    LeaderboardSnapshot.date == bj_date,
                )
            )
            db.add(LeaderboardSnapshot(
                wxid=wxid,
                name=item.get("name", ""),
                date=bj_date,
                avg_mult=avg_mult,
                win_rate=win_rate,
                ca_count=ca_count,
            ))
        await db.commit()

        # 清理 8 天前的旧快照
        cutoff = (datetime.now(timezone.utc) + timedelta(hours=8) - timedelta(days=8)).strftime("%Y-%m-%d")
        await db.execute(delete(LeaderboardSnapshot).where(LeaderboardSnapshot.date < cutoff))
        await db.commit()

        # ── 附加每人的本系统跟单战绩 ──────────────────────────────────────────
        wxid_list = [item.get("qy_wxid", "") for item in payload.get("data", []) if item.get("qy_wxid")]
        follow_stats: dict[str, dict] = {}
        if wxid_list:
            from database import Position
            # 查所有跟单持仓（follow_wxid 在 wxid_list 中）
            pos_rows = (await db.execute(
                select(Position).where(
                    Position.follow_wxid.in_(wxid_list),
                    Position.status.in_(["open", "closed"]),
                )
            )).scalars().all()
            # 按 follow_wxid 聚合
            from collections import defaultdict
            pos_by_wxid: dict[str, list] = defaultdict(list)
            for p in pos_rows:
                pos_by_wxid[p.follow_wxid].append(p)
            # 查对应的 Trade 记录（position_id in）
            pos_ids = [p.id for p in pos_rows]
            trade_by_pos: dict[int, Trade] = {}
            if pos_ids:
                trade_rows = (await db.execute(
                    select(Trade).where(Trade.position_id.in_(pos_ids))
                )).scalars().all()
                for t in trade_rows:
                    trade_by_pos[t.position_id] = t
            # 聚合统计
            for wxid, positions in pos_by_wxid.items():
                closed = [p for p in positions if p.status == "closed"]
                open_cnt = len([p for p in positions if p.status == "open"])
                trades = [trade_by_pos[p.id] for p in closed if p.id in trade_by_pos]
                win = [t for t in trades if t.pnl_usdt > 0]
                total_pnl = sum(t.pnl_usdt for t in trades)
                # 最近5个币种（按开仓时间倒序）
                recent_tokens = []
                for p in sorted(positions, key=lambda x: x.open_time or datetime.utcfromtimestamp(0), reverse=True)[:5]:
                    t = trade_by_pos.get(p.id)
                    recent_tokens.append({
                        "ca": p.ca,
                        "chain": p.chain,
                        "symbol": "",  # 后续前端可从 feed 取
                        "pnl_pct": round(t.pnl_pct, 1) if t else None,
                        "pnl_usdt": round(t.pnl_usdt, 3) if t else None,
                        "status": p.status,
                        "open_time": (p.open_time.isoformat() + "Z") if p.open_time else None,
                    })
                follow_stats[wxid] = {
                    "follow_count": len(positions),
                    "closed_count": len(closed),
                    "open_count": open_cnt,
                    "win_count": len(win),
                    "win_rate": round(len(win) / len(trades) * 100, 1) if trades else None,
                    "total_pnl_usdt": round(total_pnl, 3),
                    "recent_tokens": recent_tokens,
                }
        # 把跟单统计注入到每个 item
        for item in payload.get("data", []):
            wxid = item.get("qy_wxid", "")
            item["follow_stats"] = follow_stats.get(wxid, None)

        return payload
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}


@router.get("/community_leaderboard_proxy")
async def community_leaderboard_proxy(
    rise_threshold: float = 0.2,
    sort_by: str = "today",
    db: AsyncSession = Depends(get_db),
):
    """代理 hodlo.ai 社群胜率榜"""
    import httpx
    url = f"https://hodlo.ai/api/v1/token-data/community-win-rate-rank?rise_threshold={rise_threshold}&sort_by={sort_by}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            r.raise_for_status()
            payload = r.json()
        return payload
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}


@router.get("/leaderboard_history")
async def leaderboard_history(db: AsyncSession = Depends(get_db)):
    """返回过去 7 天每位喊单人的每日均倍数，用于前端绘制曲线"""
    from sqlalchemy import select
    from datetime import timezone, timedelta
    rows = (await db.execute(
        select(LeaderboardSnapshot).order_by(LeaderboardSnapshot.date.asc())
    )).scalars().all()

    # 按 wxid 聚合
    history: dict[str, list] = {}
    for row in rows:
        if row.wxid not in history:
            history[row.wxid] = []
        history[row.wxid].append({
            "date": row.date,
            "avg_mult": row.avg_mult,
            "win_rate": row.win_rate,
            "ca_count": row.ca_count,
        })
    return history


# ── 跟单 CRUD ────────────────────────────────────────────────────────────────

@router.get("/follow_traders")
async def list_follow_traders(db: AsyncSession = Depends(get_db)):
    """获取所有跟单配置"""
    rows = (await db.execute(select(FollowTrader))).scalars().all()
    return [
        {
            "wxid": r.wxid, "name": r.name, "enabled": r.enabled,
            "buy_amount": r.buy_amount, "take_profit": r.take_profit,
            "stop_loss": r.stop_loss, "max_hold_min": r.max_hold_min,
            "note": r.note,
        }
        for r in rows
    ]


@router.post("/follow_traders")
async def upsert_follow_trader(body: dict, db: AsyncSession = Depends(get_db)):
    """新增或更新跟单配置（按 wxid upsert）"""
    from sqlalchemy import select as _sel
    wxid = body.get("wxid", "").strip()
    if not wxid:
        return {"success": False, "error": "wxid required"}
    # 参数校验
    take_profit = float(body.get("take_profit", 50.0))
    stop_loss   = float(body.get("stop_loss", 30.0))
    buy_amount  = float(body.get("buy_amount", 0.1))
    max_hold_min= int(body.get("max_hold_min", 60))
    if take_profit <= 0:
        return {"success": False, "error": "take_profit 必须大于 0"}
    if stop_loss <= 0:
        return {"success": False, "error": "stop_loss 必须大于 0"}
    if buy_amount <= 0:
        return {"success": False, "error": "buy_amount 必须大于 0"}
    if max_hold_min <= 0:
        return {"success": False, "error": "max_hold_min 必须大于 0"}
    row = (await db.execute(_sel(FollowTrader).where(FollowTrader.wxid == wxid))).scalar_one_or_none()
    if row:
        row.name        = body.get("name", row.name)
        row.enabled     = bool(body.get("enabled", row.enabled))
        row.buy_amount  = buy_amount
        row.take_profit = take_profit
        row.stop_loss   = stop_loss
        row.max_hold_min= max_hold_min
        row.note        = body.get("note", row.note)
    else:
        db.add(FollowTrader(
            wxid=wxid,
            name=body.get("name", ""),
            enabled=bool(body.get("enabled", True)),
            buy_amount=buy_amount,
            take_profit=take_profit,
            stop_loss=stop_loss,
            max_hold_min=max_hold_min,
            note=body.get("note", ""),
        ))
    await db.commit()
    return {"success": True}


@router.delete("/follow_traders/{wxid}")
async def delete_follow_trader(wxid: str, db: AsyncSession = Depends(get_db)):
    """删除跟单配置"""
    from sqlalchemy import delete as _del
    await db.execute(_del(FollowTrader).where(FollowTrader.wxid == wxid))
    await db.commit()
    return {"success": True}


@router.post("/follow_traders/batch")
async def batch_follow_traders(body: dict, db: AsyncSession = Depends(get_db)):
    """批量新增/更新跟单配置（一键跟单）"""
    from sqlalchemy import select as _sel
    traders = body.get("traders", [])   # [{wxid, name}, ...]
    defaults = body.get("defaults", {})
    buy_amount  = float(defaults.get("buy_amount", 0.1))
    take_profit = float(defaults.get("take_profit", 50.0))
    stop_loss   = float(defaults.get("stop_loss", 30.0))
    max_hold_min = int(defaults.get("max_hold_min", 60))

    added = updated = 0
    for t in traders:
        wxid = str(t.get("wxid", "")).strip()
        if not wxid:
            continue
        row = (await db.execute(_sel(FollowTrader).where(FollowTrader.wxid == wxid))).scalar_one_or_none()
        if row:
            row.enabled      = True
            row.buy_amount   = buy_amount
            row.take_profit  = take_profit
            row.stop_loss    = stop_loss
            row.max_hold_min = max_hold_min
            updated += 1
        else:
            db.add(FollowTrader(
                wxid=wxid, name=t.get("name", ""),
                enabled=True,
                buy_amount=buy_amount, take_profit=take_profit,
                stop_loss=stop_loss, max_hold_min=max_hold_min,
                note="一键跟单",
            ))
            added += 1
    await db.commit()
    return {"success": True, "added": added, "updated": updated}



# ── 喊单人详情 ────────────────────────────────────────────────────────────────

@router.get("/caller_detail/{wxid}")
async def caller_detail(wxid: str, db: AsyncSession = Depends(get_db)):
    """喊单人详情：历史快照 + 跟单状态"""
    from sqlalchemy import select as _sel
    # 历史快照（7天）
    snaps = (await db.execute(
        _sel(LeaderboardSnapshot)
        .where(LeaderboardSnapshot.wxid == wxid)
        .order_by(LeaderboardSnapshot.date.asc())
    )).scalars().all()

    history = [
        {"date": s.date, "avg_mult": s.avg_mult, "win_rate": s.win_rate, "ca_count": s.ca_count}
        for s in snaps
    ]

    # 跟单配置
    follow = (await db.execute(
        _sel(FollowTrader).where(FollowTrader.wxid == wxid)
    )).scalar_one_or_none()
    follow_cfg = None
    if follow:
        follow_cfg = {
            "enabled": follow.enabled, "buy_amount": follow.buy_amount,
            "take_profit": follow.take_profit, "stop_loss": follow.stop_loss,
            "max_hold_min": follow.max_hold_min, "note": follow.note,
        }

    return {"wxid": wxid, "history": history, "follow": follow_cfg}


