/**
 * 请求上下文：对应 PHP 版的超全局变量（$_GET/$_POST/$_COOKIE/$_SESSION）与 bootstrap 状态。
 * 一个请求创建一个 Ctx，贯穿路由、API、页面渲染全过程。
 */
import type { Env } from '../env';
import { Db, Settings, type Row } from './db';

export const SESSION_NAME = 'cforum_session';
export const SESSION_LIFETIME = 7 * 24 * 3600; // 7 天（同 config.php）
export const CSRF_COOKIE = 'cforum_csrf'; // 游客（未登录）会话的 CSRF 令牌载体，替代 PHP Session
export const FLASH_COOKIE = 'cforum_flash'; // 替代 PHP $_SESSION['flash'] 的一次性消息
export const ASSET_VERSION = '20261120a3'; // 静态资源破缓存版本号（替代 PHP 的 filemtime）

export class Ctx {
  readonly db: Db;
  readonly settings: Settings;
  readonly url: URL;
  readonly query: URLSearchParams;
  /** 请求体参数（JSON 或表单），对应 body_params() */
  body: Record<string, unknown> = {};
  /** multipart / urlencoded 的原始 FormData（取上传文件用） */
  form: FormData | null = null;
  private bodyParsed = false;
  /** Cookie 解析结果 */
  readonly cookies = new Map<string, string>();
  /** 待下发的 Set-Cookie */
  cookiesOut: string[] = [];
  /** 会话行缓存（undefined=未查，null=无会话） */
  sessionRow: Row | null | undefined = undefined;
  /** 当前用户缓存 */
  userRow: Row | null | undefined = undefined;
  /** 当前语言缓存 */
  localeValue: string | undefined = undefined;
  /** 待写入的 flash 消息 */
  private flashOut: Record<string, string[]> = {};
  private flashDirty = false;

  constructor(
    public env: Env,
    public request: Request,
  ) {
    this.db = new Db(env.DB);
    this.settings = new Settings(this.db);
    this.url = new URL(request.url);
    this.query = this.url.searchParams;
    const cookieHeader = request.headers.get('Cookie') ?? '';
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const name = part.slice(0, idx).trim();
        let value = part.slice(idx + 1).trim();
        try { value = decodeURIComponent(value); } catch { /* 保持原样 */ }
        this.cookies.set(name, value);
      }
    }
  }

  /** 解析请求体：JSON 或表单（对应 body_params()，只解析一次） */
  async parseBody(): Promise<void> {
    if (this.bodyParsed) return;
    this.bodyParsed = true;
    const method = this.request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return;
    const ct = (this.request.headers.get('Content-Type') ?? '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        const parsed = await this.request.clone().json().catch(() => null);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.body = parsed as Record<string, unknown>;
        }
      } else if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
        this.form = await this.request.clone().formData();
        for (const [k, v] of this.form.entries()) {
          if (typeof v === 'string') this.body[k] = v;
        }
      }
    } catch {
      /* 解析失败按空参数处理，与 PHP json_decode 失败回退一致 */
    }
  }

  /** 取参数：请求体优先，其次 query（对应 param()） */
  param(key: string, def: unknown = null): unknown {
    if (Object.prototype.hasOwnProperty.call(this.body, key)) return this.body[key];
    if (this.query.has(key)) return this.query.get(key);
    return def;
  }

  /** 取字符串参数 */
  strParam(key: string, def = ''): string {
    const v = this.param(key, null);
    return v === null || v === undefined ? def : String(v);
  }

  /** 取整数参数（对应 int_param()：is_numeric 才转换） */
  intParam(key: string, def = 0): number {
    const v = this.param(key, null);
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) {
      return Math.trunc(parseFloat(v));
    }
    return def;
  }

  /** 取上传文件（对应 $_FILES[name]，字段不存在返回 null；空文件由上传处理函数判定） */
  file(name: string): File | null {
    if (!this.form) return null;
    const f = this.form.get(name);
    return f instanceof File ? f : null;
  }

  /** 追加一条 Set-Cookie */
  setCookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; sameSite?: string; path?: string } = {}): void {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${opts.path ?? '/'}`);
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    parts.push('Secure');
    parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
    this.cookiesOut.push(parts.join('; '));
    this.cookies.set(name, value);
  }

  /** 删除 Cookie（下发过期） */
  clearCookie(name: string): void {
    this.cookiesOut.push(`${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    this.cookies.delete(name);
  }

  /** 写 flash 消息（对应 flash()） */
  flash(type: string, msg: string): void {
    (this.flashOut[type] ??= []).push(msg);
    this.flashDirty = true;
  }

  /** 把累积的 flash 消息落为 Cookie（响应发出前由入口调用） */
  flushFlashCookie(): void {
    if (!this.flashDirty) return;
    this.setCookie(FLASH_COOKIE, JSON.stringify(this.flashOut), { maxAge: 300 });
  }

  /** 读入的 flash 消息（来自上一个请求设置的 Cookie） */
  readFlash(): Record<string, string[]> {
    const raw = this.cookies.get(FLASH_COOKIE);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /** 请求来源 Origin（邮件链接拼 BASE_URL 用） */
  get origin(): string {
    return this.env.SITE_URL ?? this.url.origin;
  }
}
