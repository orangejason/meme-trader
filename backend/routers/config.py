"""
配置接口
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, ConfigModel
from services.broadcaster import broadcaster
from services.ca_listener import start_listener, stop_listener
from services.position_monitor import start_monitor, stop_monitor

router = APIRouter(prefix="/api/config", tags=["config"])

# 用户可读写的配置键（不含敏感 API Key）
VALID_KEYS = {
    "bot_enabled", "auto_buy_enabled", "leaderboard_batch_follow_enabled",
    "buy_with_bnb_fallback_enabled",
    "buy_amount_usdt", "take_profit_pct", "stop_loss_pct",
    "max_hold_minutes", "max_concurrent_positions", "enabled_chains", "price_poll_interval",
    # 支出限额
    "spend_limit_enabled", "spend_limit_usdt", "spend_limit_hours",
    # 发币人质量
    "filter_sender_win_rate_enabled", "filter_sender_win_rate_min",
    "filter_sender_group_win_rate_enabled", "filter_sender_group_win_rate_min",
    "filter_sender_total_tokens_enabled", "filter_sender_total_tokens_min",
    "filter_sender_best_multiple_enabled", "filter_sender_best_multiple_min",
    "filter_new_sender_action",
    # 防追高
    "filter_current_multiple_enabled", "filter_current_multiple_max",
    # 传播热度
    "filter_qwfc_enabled", "filter_qwfc_min",
    "filter_bqfc_enabled", "filter_bqfc_min",
    "filter_fgq_enabled", "filter_fgq_min",
    "filter_grcxcs_enabled", "filter_grcxcs_min",
    # 市场数据
    "filter_market_cap_enabled", "filter_market_cap_min", "filter_market_cap_max",
    "filter_price_change_5m_enabled", "filter_price_change_5m_min",
    "filter_buy_volume_1h_enabled", "filter_buy_volume_1h_min",
    "filter_holders_enabled", "filter_holders_min",
    # 安全
    "filter_honeypot_enabled", "filter_honeypot_unknown_action", "filter_mintable_enabled",
    "filter_risk_score_enabled", "filter_risk_score_max",
    "filter_max_holder_pct_enabled", "filter_max_holder_pct_max",
    # 仪表盘显示
    "position_price_source",
    # GAS 配置
    "gas_price_multiplier", "approve_gas_price_gwei", "broadcast_mode",
    # 买入高级配置
    "buy_amount_fallback_enabled", "buy_amount_fallback_usdt",
    "buy_precheck_enabled", "buy_fail_cooldown_seconds",
    "ca_repeat_buy_enabled", "ca_repeat_qwfc_delta",
    # AI 接口（用户可配置）
    "ai_enabled", "ai_use_builtin", "ai_builtin_daily_limit",
    "ai_provider", "ai_model", "ai_max_tokens", "ai_temperature",
}

# 敏感键：只有管理员可读，普通接口只返回「是否已设置」
SENSITIVE_KEYS = {
    "ave_trade_api_key", "ave_trade_api_url",
    "ave_data_api_key",  "ave_data_api_url",
    "ai_api_key",        "ai_base_url",
    "wallet_encrypted_mnemonic",
    "wallet_demo_encrypted_mnemonic",
}


class ConfigUpdate(BaseModel):
    key: str
    value: str


class ConfigBulkUpdate(BaseModel):
    configs: dict[str, str]


@router.get("")
async def get_config(db: AsyncSession = Depends(get_db)):
    """公开配置读取：用户级配置全部返回，敏感字段仅返回 *已设置* 状态"""
    result = await db.execute(select(ConfigModel))
    rows = result.scalars().all()
    out = {}
    for r in rows:
        if r.key in SENSITIVE_KEYS:
            # 敏感字段：只告知是否有值，不暴露内容
            out[r.key] = "__set__" if r.value else ""
        elif r.key not in ("wallet_mode",):
            # 非敏感字段正常返回（排除内部状态字段）
            out[r.key] = r.value
    # wallet_mode 单独返回（前端钱包组件需要）
    for r in rows:
        if r.key == "wallet_mode":
            out["wallet_mode"] = r.value
    return out


@router.put("")
async def update_config(body: ConfigBulkUpdate, db: AsyncSession = Depends(get_db)):
    prev_bot_enabled = None
    result = await db.execute(select(ConfigModel).where(ConfigModel.key == "bot_enabled"))
    row = result.scalar_one_or_none()
    if row:
        prev_bot_enabled = row.value.lower() == "true"

    for key, value in body.configs.items():
        if key not in VALID_KEYS:
            continue
        result = await db.execute(select(ConfigModel).where(ConfigModel.key == key))
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = value
        else:
            db.add(ConfigModel(key=key, value=value))

    await db.commit()

    if "bot_enabled" in body.configs:
        new_enabled = body.configs["bot_enabled"].lower() == "true"
        if new_enabled and prev_bot_enabled is False:
            start_listener()
            start_monitor()
            broadcaster.log("Bot 已启动")
        elif not new_enabled and prev_bot_enabled is True:
            stop_listener()
            stop_monitor()
            broadcaster.log("Bot 已暂停")

    return {"success": True}
