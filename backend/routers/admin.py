"""
管理员认证接口
- POST /api/admin/login  — 密码换 JWT token
- GET  /api/admin/me     — 验证 token 是否有效
- GET  /api/admin/config — 读取完整配置（含敏感字段）
- PUT  /api/admin/config — 更新完整配置（含敏感字段）
- POST /api/admin/wallet/restore_demo — 恢复演示钱包
- GET  /api/admin/wallet/demo_status  — 查询演示钱包状态
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, ConfigModel
from config import get_settings
import hashlib
import hmac
import time
import base64
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# ── 轻量 JWT（不依赖 python-jose，纯标准库）──────────────────────
# 格式: base64(header).base64(payload).base64(sig)

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _sign(secret: str, msg: str) -> str:
    return _b64(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest())

def _issue_token(secret: str, expire_hours: int) -> str:
    header  = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"role": "admin", "exp": int(time.time()) + expire_hours * 3600}).encode())
    sig = _sign(secret, f"{header}.{payload}")
    return f"{header}.{payload}.{sig}"

def _verify_token(token: str, secret: str) -> bool:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return False
        header, payload, sig = parts
        expected = _sign(secret, f"{header}.{payload}")
        if not hmac.compare_digest(sig, expected):
            return False
        pad = 4 - len(payload) % 4
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * pad))
        return data.get("exp", 0) > time.time()
    except Exception:
        return False


# ── 认证依赖 ──────────────────────────────────────────────────────
def require_admin(authorization: str = Header(default="")):
    s = get_settings()
    # 如果没有配置管理员密码，则管理员功能完全禁用
    if not s.admin_password:
        raise HTTPException(403, "管理员功能未启用（请设置 ADMIN_PASSWORD 环境变量）")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or not _verify_token(token, s.jwt_secret):
        raise HTTPException(401, "管理员 token 无效或已过期，请重新登录")


# ── 敏感配置键（只有管理员才能读写）─────────────────────────────
ADMIN_ONLY_KEYS = {
    "ave_trade_api_key", "ave_trade_api_url",
    "ave_data_api_key",  "ave_data_api_url",
    "ai_api_key",        "ai_base_url",
    "wallet_encrypted_mnemonic",
    "wallet_demo_encrypted_mnemonic",
}


# ── 登录 ──────────────────────────────────────────────────────────
class LoginBody(BaseModel):
    password: str

@router.post("/login")
def admin_login(body: LoginBody):
    s = get_settings()
    if not s.admin_password:
        raise HTTPException(403, "管理员功能未启用")
    # 用 hmac 比较防时序攻击
    if not hmac.compare_digest(body.password, s.admin_password):
        raise HTTPException(401, "密码错误")
    token = _issue_token(s.jwt_secret, s.jwt_expire_hours)
    return {"token": token, "expires_in": s.jwt_expire_hours * 3600}


@router.get("/me")
def admin_me(_: None = Depends(require_admin)):
    return {"role": "admin", "ok": True}


# ── 完整配置读写（含敏感字段）────────────────────────────────────
@router.get("/config")
async def admin_get_config(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    result = await db.execute(select(ConfigModel))
    rows = result.scalars().all()
    return {r.key: r.value for r in rows}


class AdminConfigBody(BaseModel):
    configs: dict[str, str]

@router.put("/config")
async def admin_update_config(
    body: AdminConfigBody,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    for key, value in body.configs.items():
        result = await db.execute(select(ConfigModel).where(ConfigModel.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(ConfigModel(key=key, value=value))
    await db.commit()
    return {"success": True, "updated": list(body.configs.keys())}


# ── 演示钱包 ──────────────────────────────────────────────────────
@router.get("/wallet/demo_status")
async def demo_wallet_status(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    """查询演示钱包是否已配置"""
    s = get_settings()
    # 检查环境变量里有没有演示助记词
    has_demo_env = bool(s.demo_wallet_mnemonic)
    # 检查 DB 里有没有存演示钱包
    result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    demo_row = result.scalar_one_or_none()
    has_demo_db = bool(demo_row)

    # 当前活跃钱包
    result2 = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    active_row = result2.scalar_one_or_none()
    has_active = bool(active_row)

    # 判断当前是否在用演示钱包
    wallet_mode_row = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_mode")
    )
    mode_row = wallet_mode_row.scalar_one_or_none()
    wallet_mode = mode_row.value if mode_row else "demo"

    return {
        "has_demo": has_demo_env or has_demo_db,
        "has_active_wallet": has_active,
        "wallet_mode": wallet_mode,
        "demo_source": "env" if has_demo_env else ("db" if has_demo_db else "none"),
    }


@router.post("/wallet/save_demo")
async def save_demo_wallet(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    """把当前活跃钱包保存为演示钱包快照（管理员操作）"""
    result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    active_row = result.scalar_one_or_none()
    if not active_row:
        raise HTTPException(400, "当前没有活跃钱包，无法保存为演示钱包")

    # 存入 wallet_demo_encrypted_mnemonic
    demo_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    demo_row = demo_result.scalar_one_or_none()
    if demo_row:
        demo_row.value = active_row.value
    else:
        db.add(ConfigModel(key="wallet_demo_encrypted_mnemonic", value=active_row.value))
    await db.commit()
    return {"success": True, "message": "当前钱包已保存为演示钱包快照"}


@router.post("/wallet/restore_demo")
async def restore_demo_wallet(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    """恢复演示钱包（从 DB 快照或 env 助记词）"""
    from services.wallet_manager import wallet_manager, encrypt_mnemonic, validate_mnemonic

    s = get_settings()

    # 优先用 DB 里的演示钱包快照
    demo_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    demo_row = demo_result.scalar_one_or_none()

    if demo_row:
        encrypted = demo_row.value
    elif s.demo_wallet_mnemonic:
        # 从环境变量助记词加密
        mnemonic = s.demo_wallet_mnemonic.strip()
        if not validate_mnemonic(mnemonic):
            raise HTTPException(500, "DEMO_WALLET_MNEMONIC 环境变量中的助记词无效")
        encrypted = encrypt_mnemonic(mnemonic, s.wallet_master_password)
    else:
        raise HTTPException(400, "未配置演示钱包（请先执行 save_demo 或设置 DEMO_WALLET_MNEMONIC 环境变量）")

    # 覆盖活跃钱包
    active_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    active_row = active_result.scalar_one_or_none()
    if active_row:
        active_row.value = encrypted
    else:
        db.add(ConfigModel(key="wallet_encrypted_mnemonic", value=encrypted))

    # 标记钱包模式
    mode_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_mode")
    )
    mode_row = mode_result.scalar_one_or_none()
    if mode_row:
        mode_row.value = "demo"
    else:
        db.add(ConfigModel(key="wallet_mode", value="demo"))

    await db.commit()
    wallet_manager.clear_cache()
    return {"success": True, "message": "演示钱包已恢复"}
