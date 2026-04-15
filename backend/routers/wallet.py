"""
钱包管理接口：新建、导入、查看地址、删除
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, ConfigModel
from services.wallet_manager import (
    wallet_manager,
    generate_mnemonic,
    validate_mnemonic,
    encrypt_mnemonic,
    decrypt_mnemonic,
    derive_all_addresses,
)
from config import get_settings

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


def _get_password() -> str:
    pw = get_settings().wallet_master_password
    if not pw:
        raise HTTPException(500, "WALLET_MASTER_PASSWORD 未配置")
    return pw


async def _get_encrypted(db: AsyncSession) -> str | None:
    result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _save_encrypted(db: AsyncSession, ciphertext: str):
    result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = ciphertext
    else:
        db.add(ConfigModel(key="wallet_encrypted_mnemonic", value=ciphertext))
    await db.commit()
    wallet_manager.clear_cache()


async def _get_wallet_mode(db: AsyncSession) -> str:
    result = await db.execute(select(ConfigModel).where(ConfigModel.key == "wallet_mode"))
    row = result.scalar_one_or_none()
    return row.value if row else "demo"


async def _set_wallet_mode(db: AsyncSession, mode: str):
    result = await db.execute(select(ConfigModel).where(ConfigModel.key == "wallet_mode"))
    row = result.scalar_one_or_none()
    if row:
        row.value = mode
    else:
        db.add(ConfigModel(key="wallet_mode", value=mode))
    await db.commit()


# ── 新建钱包 ──────────────────────────────────────────────────

@router.post("/create")
async def create_wallet(db: AsyncSession = Depends(get_db)):
    """生成新助记词并加密保存，返回助记词（仅此一次，请立即备份）"""
    existing = await _get_encrypted(db)
    mode = await _get_wallet_mode(db)
    # demo 模式下允许直接创建（会覆盖演示钱包），custom 模式下已有钱包则拦截
    if existing and mode == "custom":
        raise HTTPException(400, "钱包已存在，请先删除再新建（操作不可逆）")

    mnemonic = generate_mnemonic()
    ciphertext = encrypt_mnemonic(mnemonic, _get_password())
    await _save_encrypted(db, ciphertext)
    await _set_wallet_mode(db, "custom")

    addresses = derive_all_addresses(mnemonic)
    return {
        "success": True,
        "mnemonic": mnemonic,
        "addresses": addresses,
        "warning": "请立即抄写助记词并妥善保管，系统不会再次显示！",
    }


# ── 导入钱包 ──────────────────────────────────────────────────

class ImportRequest(BaseModel):
    mnemonic: str
    force: bool = False


@router.post("/import")
async def import_wallet(body: ImportRequest, db: AsyncSession = Depends(get_db)):
    """导入已有助记词"""
    mnemonic = body.mnemonic.strip()
    if not validate_mnemonic(mnemonic):
        raise HTTPException(400, "助记词无效，请检查单词数量和拼写")

    existing = await _get_encrypted(db)
    mode = await _get_wallet_mode(db)
    if existing and mode == "custom" and not body.force:
        raise HTTPException(400, "钱包已存在，传入 force=true 覆盖（旧钱包资产请先转出）")

    ciphertext = encrypt_mnemonic(mnemonic, _get_password())
    await _save_encrypted(db, ciphertext)
    await _set_wallet_mode(db, "custom")

    addresses = derive_all_addresses(mnemonic)
    return {"success": True, "addresses": addresses}


# ── 查看地址 ──────────────────────────────────────────────────

@router.get("/addresses")
async def get_addresses(db: AsyncSession = Depends(get_db)):
    """获取各链钱包地址（不含私钥）"""
    encrypted = await _get_encrypted(db)
    if not encrypted:
        return {"exists": False, "addresses": {}}
    try:
        mnemonic = decrypt_mnemonic(encrypted, _get_password())
        addresses = derive_all_addresses(mnemonic)
        return {"exists": True, "addresses": addresses}
    except Exception as e:
        raise HTTPException(500, f"解密失败，请检查 WALLET_MASTER_PASSWORD: {e}")


# ── 删除钱包 ──────────────────────────────────────────────────

@router.delete("/delete")
async def delete_wallet(db: AsyncSession = Depends(get_db)):
    """删除自定义钱包，自动回退到演示钱包（如果有）"""
    s = get_settings()

    # 尝试恢复演示钱包
    demo_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    demo_row = demo_result.scalar_one_or_none()

    if demo_row:
        # 有演示钱包快照 → 恢复
        result = await db.execute(
            select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = demo_row.value
        else:
            db.add(ConfigModel(key="wallet_encrypted_mnemonic", value=demo_row.value))
        await _set_wallet_mode(db, "demo")
        await db.commit()
        wallet_manager.clear_cache()
        return {"success": True, "restored_demo": True, "message": "自定义钱包已删除，已自动恢复演示钱包"}
    elif s.demo_wallet_mnemonic:
        # 从环境变量恢复
        from services.wallet_manager import validate_mnemonic as _vm
        mnemonic = s.demo_wallet_mnemonic.strip()
        if _vm(mnemonic):
            ciphertext = encrypt_mnemonic(mnemonic, s.wallet_master_password)
            result = await db.execute(
                select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
            )
            row = result.scalar_one_or_none()
            if row:
                row.value = ciphertext
            else:
                db.add(ConfigModel(key="wallet_encrypted_mnemonic", value=ciphertext))
            await _set_wallet_mode(db, "demo")
            await db.commit()
            wallet_manager.clear_cache()
            return {"success": True, "restored_demo": True, "message": "已恢复演示钱包"}
    else:
        # 无演示钱包 → 直接删除
        result = await db.execute(
            select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
        )
        row = result.scalar_one_or_none()
        if row:
            await db.delete(row)
        await db.commit()
        wallet_manager.clear_cache()
        return {"success": True, "restored_demo": False, "message": "钱包已删除"}


# ── 检查钱包状态 ──────────────────────────────────────────────

@router.get("/status")
async def wallet_status(db: AsyncSession = Depends(get_db)):
    encrypted = await _get_encrypted(db)
    mode = await _get_wallet_mode(db)

    # 是否有演示钱包可用
    s = get_settings()
    demo_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    has_demo = bool(demo_result.scalar_one_or_none()) or bool(s.demo_wallet_mnemonic)

    if not encrypted:
        return {"exists": False, "wallet_mode": mode, "has_demo": has_demo, "addresses": {}}
    try:
        mnemonic = decrypt_mnemonic(encrypted, _get_password())
        addresses = derive_all_addresses(mnemonic)
        return {
            "exists": True,
            "wallet_mode": mode,
            "has_demo": has_demo,
            "addresses": addresses,
        }
    except Exception:
        return {
            "exists": True,
            "wallet_mode": mode,
            "has_demo": has_demo,
            "addresses": {},
            "error": "解密失败，主密码可能已变更",
        }


# ── 用户切换到演示钱包（无需管理员）──────────────────────────

@router.post("/use_demo")
async def use_demo_wallet(db: AsyncSession = Depends(get_db)):
    """切换到演示钱包（任何用户都可以执行，用于自助恢复默认状态）"""
    s = get_settings()

    demo_result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_demo_encrypted_mnemonic")
    )
    demo_row = demo_result.scalar_one_or_none()

    if demo_row:
        encrypted = demo_row.value
    elif s.demo_wallet_mnemonic:
        mnemonic = s.demo_wallet_mnemonic.strip()
        if not validate_mnemonic(mnemonic):
            raise HTTPException(500, "演示钱包助记词无效")
        encrypted = encrypt_mnemonic(mnemonic, s.wallet_master_password)
    else:
        raise HTTPException(400, "系统未配置演示钱包")

    result = await db.execute(
        select(ConfigModel).where(ConfigModel.key == "wallet_encrypted_mnemonic")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = encrypted
    else:
        db.add(ConfigModel(key="wallet_encrypted_mnemonic", value=encrypted))
    await _set_wallet_mode(db, "demo")
    await db.commit()
    wallet_manager.clear_cache()
    return {"success": True, "message": "已切换到演示钱包"}
