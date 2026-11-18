/**
 * 认证与会话：对应 PHP 版 core.php 的密码/会话/权限部分与 content.php 的 TOTP 部分。
 *
 * 与 PHP 版的关键差异（任务书第四节要求）：PHP 版用原生 Session，Workers 无此机制，
 * 改为 D1 sessions 表存服务端会话（id + user_id + csrf_token + expires_at），
 * Cookie 名仍为 cforum_session（HttpOnly + Secure + SameSite=Lax，7 天），可即时吊销。
 * 未登录访客的 CSRF 令牌改由 cforum_csrf Cookie 承载（PHP 版存于匿名 Session，行为等价）。
 */
import { CSRF_COOKIE, SESSION_LIFETIME, SESSION_NAME, type Ctx } from './ctx';
import { err, randomToken, redirect, timingSafeEqual } from './core';
import type { Row } from './db';

// ---------- 密码（PBKDF2，与 PHP hash_password()/verify_password() 格式完全一致） ----------

function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0 ? hex : '';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256, // PHP hash_pbkdf2(..., 64 hex) = 32 字节
  );
  return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

/** PBKDF2 密码哈希，格式与原项目一致：pbkdf2:迭代次数:盐hex:哈希hex */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return 'pbkdf2:100000:' + bytesToHex(salt) + ':' + (await pbkdf2Hex(password, salt, 100000));
}

/**
 * 校验密码。
 * @returns [是否正确, 是否为旧版 SHA-256 哈希（需升级）]
 */
export async function verifyPassword(password: string, stored: string): Promise<[boolean, boolean]> {
  if (stored.startsWith('pbkdf2:')) {
    const parts = stored.split(':');
    if (parts.length !== 4) return [false, false];
    const actual = await pbkdf2Hex(password, hexToBytes(parts[2]), parseInt(parts[1], 10) || 0);
    return [timingSafeEqual(parts[3], actual), false];
  }
  return [timingSafeEqual(stored, await sha256Hex(password)), true];
}

// ---------- 会话（D1 服务端会话） ----------

/** 读取当前会话行（按 Cookie 中的会话 ID 查 sessions 表，校验过期） */
export async function getSession(ctx: Ctx): Promise<Row | null> {
  if (ctx.sessionRow !== undefined) return ctx.sessionRow;
  ctx.sessionRow = null;
  const sid = ctx.cookies.get(SESSION_NAME);
  if (sid) {
    const row = await ctx.db.one('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', [
      sid,
      Math.floor(Date.now() / 1000),
    ]);
    if (row) ctx.sessionRow = row;
  }
  return ctx.sessionRow;
}

/** 当前登录用户（对应 current_user()） */
export async function currentUser(ctx: Ctx): Promise<Row | null> {
  if (ctx.userRow !== undefined) return ctx.userRow;
  ctx.userRow = null;
  const session = await getSession(ctx);
  if (session) {
    ctx.userRow = await ctx.db.one('SELECT * FROM users WHERE id = ?', [Number(session.user_id)]);
  }
  return ctx.userRow ?? null;
}

/** 建立登录会话（对应 login_as()：换新会话 ID 与 CSRF 令牌，旧会话作废） */
export async function loginAs(ctx: Ctx, userId: number): Promise<void> {
  const oldSid = ctx.cookies.get(SESSION_NAME);
  if (oldSid) await ctx.db.run('DELETE FROM sessions WHERE id = ?', [oldSid]);
  const sid = randomToken(32);
  const csrf = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.run('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)', [
    sid,
    userId,
    csrf,
    now + SESSION_LIFETIME,
  ]);
  ctx.setCookie(SESSION_NAME, sid, { maxAge: SESSION_LIFETIME });
  ctx.sessionRow = { id: sid, user_id: userId, csrf_token: csrf, expires_at: now + SESSION_LIFETIME };
  ctx.userRow = undefined;
}

/** 退出登录（对应 logout_now()：删除会话行并过期 Cookie） */
export async function logoutNow(ctx: Ctx): Promise<void> {
  const sid = ctx.cookies.get(SESSION_NAME);
  if (sid) await ctx.db.run('DELETE FROM sessions WHERE id = ?', [sid]);
  ctx.clearCookie(SESSION_NAME);
  ctx.sessionRow = null;
  ctx.userRow = null;
}

// ---------- CSRF（对应 csrf_token()/csrf_valid()/require_csrf()） ----------

/** 生成/获取当前 CSRF token（页面放 <meta name="csrf-token">，JS 用 X-CSRF-Token 回传） */
export async function csrfToken(ctx: Ctx): Promise<string> {
  const session = await getSession(ctx);
  if (session) return String(session.csrf_token);
  let token = ctx.cookies.get(CSRF_COOKIE);
  if (!token) {
    token = randomToken(32);
    ctx.setCookie(CSRF_COOKIE, token, { maxAge: SESSION_LIFETIME });
  }
  return token;
}

/** API 写操作统一校验 */
export async function requireCsrf(ctx: Ctx): Promise<void> {
  const session = await getSession(ctx);
  const expected = session ? String(session.csrf_token) : (ctx.cookies.get(CSRF_COOKIE) ?? '');
  const headerToken = ctx.request.headers.get('X-CSRF-Token');
  const token = headerToken ?? (ctx.param('_csrf', null) as string | null);
  if (!expected || typeof token !== 'string' || !timingSafeEqual(expected, token)) {
    err('安全校验失败，请刷新页面后重试', 403);
  }
}

// ---------- 权限（对应 require_user()/require_admin()/page_require_*()） ----------

/** API：要求登录，否则返回 401；封禁用户 403 */
export async function requireUser(ctx: Ctx): Promise<Row> {
  const user = await currentUser(ctx);
  if (!user) err('请先登录', 401);
  if ((user as Row).status === 'banned') err('账号已被封禁', 403);
  return user as Row;
}

/** API：要求管理员 */
export async function requireAdmin(ctx: Ctx): Promise<Row> {
  const user = await requireUser(ctx);
  if (user.role !== 'admin') err('需要管理员权限', 403);
  return user;
}

/** 页面：要求登录，否则跳登录页 */
export async function pageRequireUser(ctx: Ctx): Promise<Row> {
  const user = await currentUser(ctx);
  if (!user) redirect('/login');
  return user as Row;
}

/** 页面：要求管理员 */
export async function pageRequireAdmin(ctx: Ctx): Promise<Row> {
  const user = await pageRequireUser(ctx);
  if (user.role !== 'admin') redirect('/');
  return user;
}

// ---------- TOTP 双因素认证（对应 content.php，RFC 6238：SHA1 / 30 秒 / 6 位） ----------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function totpBase32Encode(data: Uint8Array): string {
  let bits = '';
  for (const byte of data) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += B32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

export function totpBase32Decode(secret: string): Uint8Array {
  const clean = secret.toUpperCase().replace(/[ \-=]/g, '');
  let bits = '';
  for (const ch of clean) {
    const pos = B32_ALPHABET.indexOf(ch);
    if (pos < 0) continue;
    bits += pos.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

/** 生成 20 字节随机密钥的 Base32 文本 */
export function totpGenerateSecret(): string {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return totpBase32Encode(buf);
}

/** 计算某时间点的 6 位 TOTP */
export async function totpCode(secret: string, time?: number): Promise<string> {
  const counter = Math.floor((time ?? Math.floor(Date.now() / 1000)) / 30);
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', totpBase32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg as BufferSource));
  const offset = hash[19] & 0x0f;
  const value =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(value % 1000000).padStart(6, '0');
}

/** 校验 TOTP，允许前后各 1 个时间窗口 */
export async function totpVerify(secret: string, code: string, window = 1): Promise<boolean> {
  const cleaned = String(code).replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqual(await totpCode(secret, now + i * 30), cleaned)) return true;
  }
  return false;
}

/** otpauth:// 二维码内容 */
export function totpUri(secret: string, email: string, issuer = 'TForum'): string {
  return (
    'otpauth://totp/' + encodeURIComponent(issuer) + ':' + encodeURIComponent(email) +
    '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30'
  );
}
