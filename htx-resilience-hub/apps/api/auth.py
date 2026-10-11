"""First-party accounts with PBKDF2 passwords and opaque, revocable sessions."""
import asyncio
import base64
import binascii
import hashlib
import hmac
import logging
import os
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from psycopg.errors import UniqueViolation

from .db import connection

router = APIRouter(prefix="/api/auth")
ITERATIONS = 600_000


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return "pbkdf2_sha256$%d$%s$%s" % (
        ITERATIONS, base64.urlsafe_b64encode(salt).decode(), base64.urlsafe_b64encode(digest).decode()
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or not 100_000 <= int(rounds) <= 2_000_000:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.urlsafe_b64decode(salt), int(rounds))
        return hmac.compare_digest(digest, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError, binascii.Error):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, email: str) -> str:
        return email.strip().lower()


class Signup(Credentials):
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def nonempty_name(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("Display name is required")
        return name.strip()


class ResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, email: str) -> str:
        return email.strip().lower()


class ResetPassword(BaseModel):
    token: str = Field(min_length=32, max_length=200)
    password: str = Field(min_length=12, max_length=128)


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def nonempty_name(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("Display name is required")
        return name.strip()


async def session_user(token: str) -> dict | None:
    if not token or len(token) > 200:
        return None
    async with connection() as conn:
        row = await (await conn.execute("""SELECT a.user_id,a.email,a.display_name FROM account_sessions s
            JOIN accounts a ON a.user_id=s.user_id
            WHERE s.token_hash=%s AND s.expires_at>now()""", (token_hash(token),))).fetchone()
    return dict(row) if row else None


async def create_session(conn, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await conn.execute("""INSERT INTO account_sessions(token_hash,user_id,expires_at)
        VALUES (%s,%s,now()+interval '30 days')""", (token_hash(token), user_id))
    return token


def require_account(request: Request) -> dict:
    account = getattr(request.state, "account", None)
    if not account:
        raise HTTPException(401, "Sign in required")
    return account


def account_user_id(request: Request, proposed: str) -> str:
    """Bind account requests to their server-verified identity; keep legacy demo IDs."""
    account = getattr(request.state, "account", None)
    if account and proposed != account["user_id"]:
        raise HTTPException(403, "This data belongs to another user")
    if proposed.startswith("acct:") and not account:
        raise HTTPException(401, "Sign in required")
    return proposed


@router.post("/signup")
async def signup(payload: Signup) -> dict:
    user_id = "acct:" + str(uuid4())
    encoded_password = await asyncio.to_thread(password_hash, payload.password)
    try:
        async with connection() as conn:
            await conn.execute("INSERT INTO accounts(user_id,email,display_name,password_hash) VALUES (%s,%s,%s,%s)",
                               (user_id, payload.email, payload.display_name.strip(), encoded_password))
            token = await create_session(conn, user_id)
    except UniqueViolation:
        raise HTTPException(409, "An account already uses this email")
    except Exception:
        raise HTTPException(503, "Accounts are unavailable; check database setup")
    return {"session_token": token, "user": {"user_id": user_id, "email": payload.email, "display_name": payload.display_name.strip()}}


@router.post("/login")
async def login(payload: Credentials) -> dict:
    try:
        async with connection() as conn:
            row = await (await conn.execute("SELECT user_id,email,display_name,password_hash FROM accounts WHERE email=%s", (payload.email,))).fetchone()
            # Run the same expensive hash check for an unknown email.
            valid = await asyncio.to_thread(verify_password, payload.password, row["password_hash"] if row else DUMMY_HASH)
            if not row or not valid:
                raise HTTPException(401, "Invalid email or password")
            token = await create_session(conn, row["user_id"])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Accounts are unavailable; check database setup")
    return {"session_token": token, "user": {key: row[key] for key in ("user_id", "email", "display_name")}}


DUMMY_HASH = password_hash("a non-account placeholder password")


@router.get("/session")
async def session(request: Request) -> dict:
    return {"user": require_account(request)}


@router.post("/logout")
async def logout(request: Request) -> dict:
    require_account(request)
    token = request.headers.get("x-account-session", "")
    async with connection() as conn:
        await conn.execute("DELETE FROM account_sessions WHERE token_hash=%s", (token_hash(token),))
    return {"ok": True}


@router.post("/profile")
async def update_profile(request: Request, payload: ProfileUpdate) -> dict:
    account = require_account(request)
    async with connection() as conn:
        await conn.execute("UPDATE accounts SET display_name=%s WHERE user_id=%s", (payload.display_name.strip(), account["user_id"]))
    return {"user": {**account, "display_name": payload.display_name.strip()}}


def send_reset_email(address: str, reset_url: str) -> None:
    message = EmailMessage()
    message["Subject"] = "Reset your Noach password"
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = address
    message.set_content("Use this link within 30 minutes to reset your password:\n\n" + reset_url + "\n\nIf you did not request this, ignore this email.")
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587")), timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if os.getenv("SMTP_USERNAME"):
            smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(message)


@router.post("/request-reset")
async def request_reset(payload: ResetRequest) -> dict:
    dev_link = os.getenv("NOACH_ENV") == "development" and os.getenv("NOACH_DEV_RESET_LINKS") == "true"
    if not dev_link and not all(os.getenv(name) for name in ("SMTP_HOST", "SMTP_FROM", "APP_BASE_URL")):
        raise HTTPException(503, "Password reset email is not configured")
    async with connection() as conn:
        row = await (await conn.execute("SELECT user_id FROM accounts WHERE email=%s", (payload.email,))).fetchone()
        if not row:
            return {"message": "If this address has an account, a reset link is on its way."}
        token = secrets.token_urlsafe(32)
        await conn.execute("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES (%s,%s,now()+interval '30 minutes')",
                           (token_hash(token), row["user_id"]))
    base = os.getenv("APP_BASE_URL", "http://localhost:3000").rstrip("/")
    reset_url = base + "/reset-password?token=" + token
    if dev_link:
        return {"message": "Development reset link ready.", "dev_reset_url": reset_url}
    try:
        await asyncio.to_thread(send_reset_email, payload.email, reset_url)
    except Exception as exc:
        logging.warning("Password reset email unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Password reset email is temporarily unavailable")
    return {"message": "If this address has an account, a reset link is on its way."}


@router.post("/reset")
async def reset_password(payload: ResetPassword) -> dict:
    encoded_password = await asyncio.to_thread(password_hash, payload.password)
    async with connection() as conn:
        row = await (await conn.execute("""UPDATE password_reset_tokens SET used_at=now()
            WHERE token_hash=%s AND used_at IS NULL AND expires_at>now() RETURNING user_id""", (token_hash(payload.token),))).fetchone()
        if not row:
            raise HTTPException(400, "This reset link is invalid or expired")
        await conn.execute("UPDATE accounts SET password_hash=%s WHERE user_id=%s", (encoded_password, row["user_id"]))
        await conn.execute("DELETE FROM account_sessions WHERE user_id=%s", (row["user_id"],))
    return {"message": "Password updated. Sign in with your new password."}
