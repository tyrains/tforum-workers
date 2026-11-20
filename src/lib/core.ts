/**
 * 核心工具：对应 PHP 版 lib/core.php（输出、转义、参数、校验、限流、时间、资源 URL）。
 * 会话/CSRF/密码部分在 auth.ts；此处函数与 PHP 同名同义，方便对照维护。
 */
import type { Ctx } from './ctx';
import { ApiError, JsonExit, RedirectExit } from './errors';
import type { Row } from './db';

/** 站点默认名（对应 config.php 的 DEFAULT_SITE_TITLE；后台「站点设置」可覆盖，存 settings 表） */
export const DEFAULT_SITE_TITLE = 'TForum';

/** 页脚版权声明默认文案（对应 config.php 的 DEFAULT_SITE_COPYRIGHT；后台「站点设置」可覆盖，存 settings 表 site_copyright；清空则不显示这一行） */
export const DEFAULT_SITE_COPYRIGHT = 'Powered by <a class="powered-link" href="https://github.com/tyrains" target="_blank" rel="noopener noreferrer">tyrains</a>';

// ---------- 输出与跳转 ----------

/** HTML 转义（对应 e()：htmlspecialchars ENT_QUOTES） */
export function e(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 失败响应（对应 err()：抛出后由入口输出 JSON） */
export function err(message: string, code = 400, extra: Record<string, unknown> = {}): never {
  throw new ApiError(code, message, extra);
}

/**
 * 成功响应（对应 ok()）。
 * PHP 版 array_filter 只剔除 === '' 的值：message 为空时不输出；
 * data 为空数组时保留并编码为 []，非空关联数组编码为对象——此处等价处理。
 */
export function ok(data: Record<string, unknown> = {}, message = ''): never {
  const payload: Record<string, unknown> = { ok: true };
  if (message !== '') payload.message = message;
  const normalized = normalizeAssetUrls(data) as Record<string, unknown>;
  payload.data = normalized && Object.keys(normalized).length > 0 ? normalized : [];
  throw new JsonExit(payload, 200);
}

/** 页面跳转（对应 redirect()） */
export function redirect(url: string): never {
  throw new RedirectExit(url, 302);
}

/** 站内页面链接（对应 page_url()，新版为干净路径，见 index.ts 路由表） */
export function pageUrl(page: string, params: Record<string, string | number> = {}): string {
  const pathMap: Record<string, string> = {
    home: '/', post: '/post', 'post-new': '/post-new', 'post-edit': '/post-edit',
    login: '/login', register: '/register', forgot: '/forgot', reset: '/reset',
    verify: '/verify', 'verify-email-change': '/verify-email-change',
    settings: '/settings', profile: '/profile', likes: '/likes', admin: '/admin',
    terms: '/terms', privacy: '/privacy',
  };
  let base = pathMap[page] ?? '/';
  const rest = { ...params };
  if (page === 'post' && rest.id !== undefined) { base = '/post/' + rest.id; delete rest.id; }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) qs.set(k, String(v));
  const s = qs.toString();
  return s ? base + '?' + s : base;
}

/**
 * 资源 URL 归一化（对应 asset_url()）。
 * PHP 版还处理子目录部署前缀；Workers 版部署在域名根目录，base 恒为空，规则其余不变：
 * 外链/协议相对/data:/#/? 原样，站内绝对路径原样，相对路径补前导 /。
 */
export function assetUrl(url: string): string {
  const u = String(url ?? '').trim();
  if (u === '') return '';
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return '/' + u;
}

/** 递归把 API 响应里的图片类字段转成可访问路径（对应 normalize_asset_urls()） */
export function normalizeAssetUrls(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const keys = ['avatar_url', 'author_avatar', 'bg_image', 'site_bg_image', 'site_logo_url', 'site_favicon_url'];
  if (Array.isArray(value)) return value.map((v) => normalizeAssetUrls(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && keys.includes(k)) out[k] = assetUrl(v);
    else if (v && typeof v === 'object') out[k] = normalizeAssetUrls(v);
    else out[k] = v;
  }
  return out;
}

/** 客户端 IP（对应 client_ip()：优先 CF-Connecting-IP） */
export function clientIp(ctx: Ctx): string {
  return ctx.request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** 生成随机令牌（对应 random_token()：hex 编码） */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 常量时间比较（对应 hash_equals()） */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- 输入校验（与 core.php 逐条一致） ----------

/** 邮箱格式 */
export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && mbLen(email) <= 254;
}

/** 控制字符检查（沿用原项目规则） */
export function hasControlChars(s: string): boolean {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s);
}

export function hasInvisibleChars(s: string): boolean {
  return /[\u200B-\u200F\uFEFF\u2028\u2029\u180E\u3164\u115F\u1160]/u.test(s);
}

/** 多字节字符串长度（对应 mb_strlen，JS 的 [...s].length 按码点计，与 mb_strlen 的字符数一致） */
export function mbLen(s: string): number {
  return [...s].length;
}

/** 截取前 n 个字符（对应 mb_substr(s, 0, n)） */
export function mbSubstr(s: string, start: number, len?: number): string {
  const chars = [...s];
  return len === undefined ? chars.slice(start).join('') : chars.slice(start, start + len).join('');
}

/** 校验用户名，返回错误说明，空串表示通过 */
export function validateUsername(name: string): string {
  if (mbLen(name) < 2 || mbLen(name) > 30) return '用户名长度需为 2～30 个字符';
  if (hasControlChars(name) || hasInvisibleChars(name)) return '用户名包含非法字符';
  const restricted = ['管理员', '管理', 'administrator', 'admin', 'sudo', 'root', 'system', 'official', '官方', '客服', '运营'];
  const lower = name.toLowerCase();
  for (const word of restricted) {
    if (lower.includes(word.toLowerCase())) return '该用户名含保留词，请换一个';
  }
  return '';
}

/** 通用文本校验，返回错误说明 */
export function validateText(s: string, label: string, max = 5000): string {
  if (mbLen(s) > max) return `${label}不能超过 ${max} 个字符`;
  if (hasControlChars(s)) return `${label}包含非法字符`;
  return '';
}

// ---------- 频率限制（对应 rate_limit()，存储由文件改为 D1 rate_limits 表） ----------

/**
 * 简单频率限制：按「动作:IP」分桶计数。
 * PHP 版用 data/ratelimit/*.json 文件存时间戳数组；Workers 无本地文件系统，改存 D1，
 * 计数与拦截语义不变（窗口内达到 limit 次即 429），顺带清理过期记录。
 */
export async function rateLimit(ctx: Ctx, key: string, limit: number, windowSeconds: number): Promise<void> {
  const bucket = key + ':' + clientIp(ctx);
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.run('DELETE FROM rate_limits WHERE bucket = ? AND hit_at <= ?', [bucket, now - windowSeconds]);
  const count = Number(await ctx.db.val('SELECT COUNT(*) FROM rate_limits WHERE bucket = ? AND hit_at > ?', [bucket, now - windowSeconds])) || 0;
  if (count >= limit) err('操作过于频繁，请稍后再试', 429);
  await ctx.db.run('INSERT INTO rate_limits (bucket, hit_at) VALUES (?, ?)', [bucket, now]);
}

// ---------- 审计日志（对应 db.php audit_log()） ----------

export async function auditLog(
  ctx: Ctx,
  action: string,
  resourceType: string | null = null,
  resourceId: string | null = null,
  details: string | null = null,
  userId: number | null = null,
): Promise<void> {
  await ctx.db.run(
    'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, resourceType, resourceId, details, clientIp(ctx)],
  );
}

// ---------- 时间（与 PHP 版逐字一致的展示口径） ----------
// PHP 版时区硬编码 Asia/Shanghai，而 SQLite CURRENT_TIMESTAMP 存的是 UTC 文本；
// PHP 用 strtotime() 按 +08 解析、又用 date() 按 +08 格式化，多数场景等于原字符串截取。
// 这里按同样口径复刻：解析按 +08，格式化直接取原字符串，避免多余时区换算导致显示漂移。

/** 把 'YYYY-MM-DD HH:mm:ss' 按 +08:00 解析为 unix 秒（对应 strtotime()） */
export function parseDbTime(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s ?? '');
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600;
}

/** date('Y-m-d H:i', strtotime(s)) 的等价输出 */
export function fmtDateTime(s: string): string {
  return (s ?? '').slice(0, 16);
}

/** date('Y-m-d', strtotime(s)) 的等价输出 */
export function fmtDate(s: string): string {
  return (s ?? '').slice(0, 10);
}

/** date('Y年n月j日 H:i', strtotime(s)) 的等价输出 */
export function fmtCnDateTime(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s ?? '');
  if (!m) return s ?? '';
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日 ${m[4]}:${m[5]}`;
}

/** 把 unix 秒按 +08 格式化为 'YYYY-MM-DD HH:mm:ss'（对应 date() 在 Asia/Shanghai 下的输出） */
export function fmtShanghai(unixSeconds: number): string {
  const d = new Date((unixSeconds + 8 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 把 unix 秒按 +08 格式化为 'Ymd_His'（上传文件名用，对应 date('Ymd_His')） */
export function fmtFileStamp(unixSeconds: number): string {
  return fmtShanghai(unixSeconds).replace(/[-: ]/g, (c) => (c === ' ' ? '_' : ''));
}

/** 把 'YYYY-MM-DD HH:mm:ss' 按 UTC 解析为 unix 秒（v2 起数据库时间按 UTC 口径解析） */
export function parseDbTimeUtc(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((s ?? '').trim());
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000);
}

/** 时间友好显示（对应 time_ago()；v2 口径：数据库存 UTC，按 UTC 解析后再与当前时间比较） */
export function timeAgo(datetime: string): string {
  const ts = parseDbTimeUtc(datetime);
  if (Number.isNaN(ts)) return e(datetime);
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
  return fmtDate(datetime);
}

/**
 * 绝对时间显示（对应 v2 新增的 format_datetime()）：数据库存的 UTC 时间 → 北京时间，
 * 格式 Y/m/d H:i。例如 2026-11-19 02:46:00(UTC) → 2026/11/19 10:46。空串返回空串，解析失败回显原文（转义）。
 */
export function formatDatetime(datetime: string): string {
  const s = (datetime ?? '').trim();
  if (s === '') return '';
  const ts = parseDbTimeUtc(s);
  if (Number.isNaN(ts)) return e(s);
  return fmtShanghai(ts).slice(0, 16).replace(/-/g, '/');
}

// ---------- 用户公开信息（对应 api_auth.php public_user() / default_avatar()） ----------

/** 默认头像 URL */
export function defaultAvatar(id: number): string {
  return '/api/avatar?id=' + id;
}

/** 用户公开信息（不带密码等敏感字段） */
export function publicUser(u: Row): Row {
  return {
    id: Number(u.id),
    email: u.email,
    username: u.username,
    nickname: u.nickname ? u.nickname : u.username,
    role: u.role,
    status: u.status ?? 'normal',
    verified: Number(u.verified) === 1,
    avatar_url: u.avatar_url ? u.avatar_url : defaultAvatar(Number(u.id)),
    bio: u.bio ?? '',
    totp_enabled: Number(u.totp_enabled ?? 0) === 1,
    email_notifications: Number(u.email_notifications ?? 1) === 1,
    created_at: u.created_at,
  };
}
