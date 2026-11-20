/**
 * TForum Worker 入口：静态资源 / API / 页面 SSR / R2 上传文件 四路分发。
 * 对应 PHP 版 index.php + api.php + bootstrap 的组合职责：
 * - 旧链接兼容：index.php?p=x、index.php/post/1、/posts/<id>、api.php?r= 一律映射到新路径/API；
 * - ?theme= 服务端兜底通道、?lang= 语言通道、force_login、区域限制均在此层处理；
 * - 业务代码通过异常（ApiError/JsonExit/RedirectExit）结束请求，这里统一落成响应。
 */
import type { Env } from './env';
import { Ctx } from './lib/ctx';
import { ApiError, JsonExit, RedirectExit } from './lib/errors';
import { err } from './lib/core';
import { currentUser } from './lib/auth';
import { currentLocale, t } from './lib/i18n';
import { themeIsValid } from './lib/theme-registry';
import { pageFooter, pageHeader } from './lib/layout';
import * as AuthApi from './api/auth';
import * as ContentApi from './api/content';
import * as AdminApi from './api/admin';
import { renderHome } from './pages/home';
import { renderPost } from './pages/post';
import { renderPostEdit } from './pages/post-edit';
import { renderLogin } from './pages/login';
import { renderRegister } from './pages/register';
import { renderForgot } from './pages/forgot';
import { renderReset } from './pages/reset';
import { renderVerify } from './pages/verify';
import { renderSettings } from './pages/settings';
import { renderProfile } from './pages/profile';
import { renderLikes } from './pages/likes';
import { renderAdmin } from './pages/admin';
import { renderLegal } from './pages/legal';

type ApiHandler = (ctx: Ctx, ...ids: number[]) => Promise<void | Response>;

/** API 路由表：与 PHP 版 api.php 的 $routes 逐条对应（正则 + 方法 + 处理函数） */
const API_ROUTES: Array<[RegExp, string, ApiHandler]> = [
  [/^config$/, 'GET', AuthApi.apiConfig],
  [/^auth\/check$/, 'GET', AuthApi.apiAuthCheck],
  [/^login$/, 'POST', AuthApi.apiLogin],
  [/^logout$/, 'POST', AuthApi.apiLogout],
  [/^register$/, 'POST', AuthApi.apiRegister],
  [/^verify$/, 'GET', AuthApi.apiVerifyEmail],
  [/^auth\/forgot-password$/, 'POST', AuthApi.apiForgotPassword],
  [/^auth\/reset-password$/, 'POST', AuthApi.apiResetPassword],
  [/^verify-email-change$/, 'GET', AuthApi.apiVerifyEmailChange],
  [/^users$/, 'GET', AuthApi.apiUsers],
  [/^user\/profile$/, 'POST', AuthApi.apiUpdateProfile],
  [/^user\/(\d+)\/profile$/, 'GET', AuthApi.apiGetProfile],
  [/^user\/upload-bg$/, 'POST', AuthApi.apiUploadBg],
  [/^user\/upload-avatar$/, 'POST', AuthApi.apiUploadAvatar],
  [/^user\/totp\/disable$/, 'POST', AuthApi.apiTotpDisable],
  [/^user\/delete$/, 'POST', AuthApi.apiDeleteAccount],
  [/^user\/totp\/setup$/, 'POST', AuthApi.apiTotpSetup],
  [/^user\/totp\/verify$/, 'POST', AuthApi.apiTotpVerify],
  [/^user\/change-password$/, 'POST', AuthApi.apiChangePassword],
  [/^user\/change-email$/, 'POST', AuthApi.apiChangeEmail],
  [/^user\/likes$/, 'GET', AuthApi.apiMyLikes],
  [/^posts$/, 'GET', ContentApi.apiListPosts],
  [/^posts$/, 'POST', ContentApi.apiCreatePost],
  [/^posts\/(\d+)$/, 'GET', ContentApi.apiGetPost],
  [/^posts\/(\d+)$/, 'PUT', ContentApi.apiUpdatePost],
  [/^posts\/(\d+)$/, 'DELETE', ContentApi.apiDeletePost],
  [/^posts\/(\d+)\/comments$/, 'GET', ContentApi.apiListComments],
  [/^posts\/(\d+)\/comments$/, 'POST', ContentApi.apiCreateComment],
  [/^comments\/(\d+)$/, 'DELETE', ContentApi.apiDeleteComment],
  [/^posts\/(\d+)\/like$/, 'POST', ContentApi.apiToggleLike],
  [/^posts\/(\d+)\/like-status$/, 'GET', ContentApi.apiLikeStatus],
  [/^posts\/(\d+)\/likers$/, 'GET', ContentApi.apiPostLikers],
  [/^categories$/, 'GET', ContentApi.apiListCategories],
  [/^upload$/, 'POST', AuthApi.apiUpload],
  [/^markdown\/render$/, 'POST', ContentApi.apiMarkdownRender],
  [/^user\/theme$/, 'POST', ContentApi.apiSetTheme],
  [/^admin\/settings$/, 'GET', AdminApi.apiAdminGetSettings],
  [/^admin\/settings$/, 'POST', AdminApi.apiAdminSaveSettings],
  [/^admin\/stats$/, 'GET', AdminApi.apiAdminStats],
  [/^admin\/categories$/, 'GET', AdminApi.apiAdminListCategories],
  [/^admin\/categories$/, 'POST', AdminApi.apiAdminAddCategory],
  [/^admin\/categories\/(\d+)$/, 'PUT', AdminApi.apiAdminUpdateCategory],
  [/^admin\/categories\/(\d+)$/, 'DELETE', AdminApi.apiAdminDeleteCategory],
  [/^admin\/users$/, 'GET', AdminApi.apiAdminListUsers],
  [/^admin\/users\/(\d+)\/update$/, 'POST', AdminApi.apiAdminUpdateUser],
  [/^admin\/users\/(\d+)\/role$/, 'POST', AdminApi.apiAdminSetRole],
  [/^admin\/users\/(\d+)\/verify$/, 'POST', AdminApi.apiAdminVerifyUser],
  [/^admin\/users\/(\d+)\/resend$/, 'POST', AdminApi.apiAdminResendVerify],
  [/^admin\/users\/(\d+)\/action$/, 'POST', AdminApi.apiAdminUserAction],
  [/^admin\/users\/(\d+)$/, 'DELETE', AdminApi.apiAdminDeleteUser],
  [/^admin\/posts$/, 'GET', AdminApi.apiAdminListPosts],
  [/^admin\/posts\/(\d+)\/action$/, 'POST', AdminApi.apiAdminPostAction],
  [/^admin\/posts\/(\d+)\/pin$/, 'POST', AdminApi.apiAdminPinPost],
  [/^admin\/posts\/(\d+)\/move$/, 'POST', AdminApi.apiAdminMovePost],
  [/^admin\/posts\/(\d+)$/, 'DELETE', AdminApi.apiAdminDeletePost],
  [/^admin\/comments$/, 'GET', AdminApi.apiAdminListComments],
  [/^admin\/comments\/(\d+)\/action$/, 'POST', AdminApi.apiAdminCommentAction],
  [/^admin\/comments\/(\d+)$/, 'DELETE', AdminApi.apiAdminDeleteComment],
  [/^admin\/cleanup\/analyze$/, 'GET', AdminApi.apiAdminCleanupAnalyze],
  [/^admin\/cleanup\/execute$/, 'POST', AdminApi.apiAdminCleanupExecute],
  [/^test-email$/, 'POST', AdminApi.apiTestEmail],
];

/** 页面名 => 干净路径（旧链接跳转与路由共用） */
const PAGE_PATHS: Record<string, string> = {
  home: '/', post: '/post', 'post-new': '/post-new', 'post-edit': '/post-edit',
  login: '/login', register: '/register', forgot: '/forgot', reset: '/reset',
  verify: '/verify', 'verify-email-change': '/verify-email-change',
  settings: '/settings', profile: '/profile', likes: '/likes', admin: '/admin',
  terms: '/terms', privacy: '/privacy',
};

/** 强制登录时游客可访问的页面 */
const PUBLIC_PAGES = ['login', 'register', 'forgot', 'reset', 'verify', 'terms', 'privacy', 'verify-email-change'];

function jsonResponse(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** 把 ctx 累积的 Set-Cookie（含 flash）落到响应上 */
function finalize(ctx: Ctx, response: Response): Response {
  ctx.flushFlashCookie();
  if (ctx.cookiesOut.length === 0) return response;
  const res = new Response(response.body, response);
  for (const c of ctx.cookiesOut) res.headers.append('Set-Cookie', c);
  return res;
}

/** 区域限制名单解析（逗号或换行分隔的国家代码） */
function parseRegionList(raw: string): string[] {
  return raw.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** 区域限制：名单都为空时完全不拦截（默认关闭，与现站行为一致） */
async function regionBlocked(ctx: Ctx): Promise<boolean> {
  const allowed = parseRegionList(await ctx.settings.get('site_allowed_regions', ''));
  const blocked = parseRegionList(await ctx.settings.get('site_blocked_regions', ''));
  if (allowed.length === 0 && blocked.length === 0) return false;
  const country = String((ctx.request.cf as { country?: string } | undefined)?.country ?? '').toUpperCase();
  if (country === '') return false;
  if (blocked.includes(country)) return true;
  if (allowed.length > 0 && !allowed.includes(country)) return true;
  return false;
}

/** API 分发：route 已去掉 /api/ 前缀与首尾斜杠 */
async function handleApi(ctx: Ctx, route: string): Promise<Response> {
  const method = ctx.request.method.toUpperCase();
  // 图片类接口直接输出二进制，不走 JSON 响应
  if (method === 'GET' && route === 'avatar') return AuthApi.apiAvatar(ctx);
  if (method === 'GET' && route === 'totp-qr') return AuthApi.apiTotpQr(ctx);
  for (const [pattern, allowedMethod, handler] of API_ROUTES) {
    if (method !== allowedMethod) continue;
    const m = pattern.exec(route);
    if (m) {
      const result = await handler(ctx, ...m.slice(1).map((v) => parseInt(v, 10)));
      if (result instanceof Response) return result;
      // 处理函数正常返回说明内部逻辑漏了 ok()/err()，按服务器错误处理
      return jsonResponse({ ok: false, error: '内部错误' }, 500);
    }
  }
  err('接口不存在：' + method + ' ' + route, 404);
}

/** 旧页面链接（index.php?p=post&id=1 等）转干净路径 */
function legacyPageTarget(page: string, query: URLSearchParams): string {
  const rest = new URLSearchParams(query);
  rest.delete('p');
  rest.delete('theme');
  let base = PAGE_PATHS[page] ?? '/';
  if (page === 'post') {
    const id = rest.get('id') ?? '0';
    rest.delete('id');
    base = '/post/' + id;
  }
  const qs = rest.toString();
  return qs ? base + '?' + qs : base;
}

/** 页面分发：返回 [状态码, 完整 HTML] */
async function handlePage(ctx: Ctx, page: string, postId?: number): Promise<Response> {
  // 强制登录模式（先于 404 判断，与 PHP 版顺序一致）
  if ((await ctx.settings.bool('force_login')) && !(await currentUser(ctx)) && !PUBLIC_PAGES.includes(page)) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const titles: Record<string, string> = {
    home: '',
    post: t(ctx, 'post', {}, '帖子'),
    'post-new': t(ctx, 'newPost', {}, '发帖'),
    'post-edit': t(ctx, 'edit', {}, '编辑'),
    login: t(ctx, 'login', {}, '登录'),
    register: t(ctx, 'register', {}, '注册'),
    forgot: t(ctx, 'forgotPassword', {}, '找回密码'),
    reset: t(ctx, 'resetPassword', {}, '重置密码'),
    verify: t(ctx, 'verifyEmail', {}, '验证邮箱'),
    'verify-email-change': t(ctx, 'verifyEmail', {}, '验证邮箱'),
    settings: t(ctx, 'settings', {}, '设置'),
    profile: t(ctx, 'profile', {}, '个人主页'),
    likes: t(ctx, 'myLikes', {}, '我的点赞'),
    admin: t(ctx, 'adminPanel', {}, '管理后台'),
    terms: t(ctx, 'terms', {}, '用户协议'),
    privacy: t(ctx, 'privacy', {}, '隐私政策'),
  };
  if (!(page in titles)) {
    const html = (await pageHeader(ctx, '404'))
      + '<div class="empty"><div class="empty-icon">🔍</div><p>页面不存在</p><a class="btn btn-primary" href="/">返回首页</a></div>'
      + (await pageFooter(ctx));
    return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  let body: string;
  switch (page) {
    case 'home': body = await renderHome(ctx); break;
    case 'post': body = await renderPost(ctx, postId ?? ctx.intParam('id', 0)); break;
    case 'post-new': body = await renderPostEdit(ctx); break;
    case 'post-edit': body = await renderPostEdit(ctx); break;
    case 'login': body = await renderLogin(ctx); break;
    case 'register': body = await renderRegister(ctx); break;
    case 'forgot': body = await renderForgot(ctx); break;
    case 'reset': body = await renderReset(ctx); break;
    case 'verify': body = await renderVerify(ctx, false); break;
    case 'verify-email-change': body = await renderVerify(ctx, true); break;
    case 'settings': body = await renderSettings(ctx); break;
    case 'profile': body = await renderProfile(ctx); break;
    case 'likes': body = await renderLikes(ctx); break;
    case 'admin': body = await renderAdmin(ctx); break;
    case 'terms': body = await renderLegal(ctx, true); break;
    case 'privacy': body = await renderLegal(ctx, false); break;
    default: body = '';
  }
  const html = (await pageHeader(ctx, titles[page])) + body + (await pageFooter(ctx));
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** /uploads/* 从 R2 读出（DB 中存 uploads/usr/... 相对路径，R2 Key 去掉 uploads/ 前缀） */
async function handleUpload(ctx: Ctx, path: string): Promise<Response> {
  const key = path.replace(/^\/uploads\//, '');
  if (key === '' || key.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }
  const obj = await ctx.env.R2.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  if (!headers.has('Content-Type')) {
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const types: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    };
    if (types[ext]) headers.set('Content-Type', types[ext]);
  }
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 静态资源走 Workers Static Assets（public/ 目录）
    if (path.startsWith('/assets/')) {
      return env.ASSETS.fetch(request);
    }

    const ctx = new Ctx(env, request);
    try {
      await ctx.parseBody();
      currentLocale(ctx); // ?lang= 通道：任何动态请求都可切换语言并写 Cookie

      // ---- 旧 API 入口兼容：api.php?r=posts 直接按 API 路由服务（不跳转，避免 POST 丢数据） ----
      if (path === '/api.php') {
        let route = String(ctx.param('r', '') ?? '').trim().replace(/^\/+|\/+$/g, '');
        if (route.startsWith('api/')) route = route.slice(4);
        if (await regionBlocked(ctx)) err('您所在的地区暂不提供服务', 403);
        return finalize(ctx, await handleApi(ctx, route));
      }

      // ---- 旧页面入口兼容：index.php?p=x / index.php/post/1 / /posts/<id> → 302 干净路径 ----
      const isLegacyIndex = path === '/index.php' || path.startsWith('/index.php/');
      const postsShort = /^\/posts\/(\d+)$/.exec(path);
      if (isLegacyIndex || postsShort) {
        let page = 'home';
        const query = new URLSearchParams(url.searchParams);
        if (postsShort) {
          page = 'post';
          query.set('id', postsShort[1]);
        } else if (path.startsWith('/index.php/')) {
          const parts = path.slice('/index.php/'.length).split('/').filter(Boolean);
          if (parts.length) {
            page = parts[0];
            if (page === 'post' && parts[1]) query.set('id', parts[1]);
          }
        } else if (query.has('p')) {
          page = query.get('p') ?? 'home';
        }
        // ?theme= 兜底通道：先落 Cookie 再直达干净路径（合法性由主题注册表判定）
        const theme = query.get('theme');
        if (theme !== null && themeIsValid(theme)) {
          ctx.setCookie('cforum_theme', theme, { maxAge: 365 * 86400, httpOnly: false });
        }
        return finalize(ctx, new Response(null, { status: 302, headers: { Location: legacyPageTarget(page, query) } }));
      }

      // ---- API ----
      if (path === '/api' || path.startsWith('/api/')) {
        let route = path.slice('/api'.length).replace(/^\/+|\/+$/g, '');
        if (route.startsWith('api/')) route = route.slice(4);
        if (await regionBlocked(ctx)) err('您所在的地区暂不提供服务', 403);
        return finalize(ctx, await handleApi(ctx, route));
      }

      // ---- 上传文件 ----
      if (path.startsWith('/uploads/')) {
        return finalize(ctx, await handleUpload(ctx, path));
      }

      // ---- 页面：?theme= 兜底通道（写 Cookie 后跳回无 theme 参数的本页） ----
      if (url.searchParams.has('theme')) {
        const theme = url.searchParams.get('theme') ?? '';
        if (themeIsValid(theme)) {
          ctx.setCookie('cforum_theme', theme, { maxAge: 365 * 86400, httpOnly: false });
          ctx.cookies.set('cforum_theme', theme); // 本次请求立刻可见
        }
        const clean = new URLSearchParams(url.searchParams);
        clean.delete('theme');
        const qs = clean.toString();
        return finalize(ctx, new Response(null, { status: 302, headers: { Location: path + (qs ? '?' + qs : '') } }));
      }

      if (await regionBlocked(ctx)) {
        return finalize(ctx, new Response('您所在的地区暂不提供服务', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));
      }

      // ---- 干净路径页面路由 ----
      let page = '';
      let postId: number | undefined;
      if (path === '/' || path === '') {
        page = 'home';
      } else {
        const postMatch = /^\/post\/(\d+)$/.exec(path);
        if (postMatch) {
          page = 'post';
          postId = parseInt(postMatch[1], 10);
        } else {
          const name = path.slice(1);
          if (name in PAGE_PATHS && name !== 'home' && name !== 'post') page = name;
        }
      }
      return finalize(ctx, await handlePage(ctx, page, postId));
    } catch (e) {
      if (e instanceof JsonExit) {
        return finalize(ctx, jsonResponse(e.payload, e.status));
      }
      if (e instanceof ApiError) {
        return finalize(ctx, jsonResponse({ ok: false, error: e.message, ...e.extra }, e.status));
      }
      if (e instanceof RedirectExit) {
        return finalize(ctx, new Response(null, { status: e.status, headers: { Location: e.location } }));
      }
      throw e;
    }
  },
};
