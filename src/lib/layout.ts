/**
 * 页面公共布局：对应 PHP 版 lib/layout.php 的 page_header()/page_footer()/show_flash()。
 * HTML 结构、class 名、注入的 window.CFORUM、自定义 CSS/JS、公告与页脚均与原版一致；
 * 链接改为干净路径，静态资源版本号用固定构建版本代替 filemtime。
 */
import { ASSET_VERSION, type Ctx } from './ctx';
import { assetUrl, DEFAULT_SITE_COPYRIGHT, DEFAULT_SITE_TITLE, e, mbSubstr, normalizeAssetUrls, publicUser } from './core';
import { csrfToken, currentUser } from './auth';
import { currentLocale, t } from './i18n';
import { themeCssPath, themeEnabledIds, themeIsValid, themeNamesMap, themeNext } from './theme-registry';
import { sanitizeHtml, stripForbiddenFonts } from './content';
import { FLASH_COOKIE } from './ctx';

const THEME_MAG_SVG = '<svg class="icon-theme-mag" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10.5 5 8.6 4.3 6 4.3H4v14h2c2.6 0 4.5.7 6 2.2 1.5-1.5 3.4-2.2 6-2.2h2v-14h-2c-2.6 0-4.5.7-6 2.2z"/><line x1="12" y1="6.5" x2="12" y2="20.5"/></svg>';
const THEME_TOOL_SVG = '<svg class="icon-theme-tool" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="9.5" y1="9.5" x2="9.5" y2="19.5"/></svg>';
const THEME_CYCLE_SVG = '<svg class="icon-theme-cycle" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18.5 7L20 9"/><path d="M17.9 15A7 7 0 0 1 5.5 17L4 15"/></svg>';

/** 当前主题（Cookie 优先，其次站点默认；合法性由注册表统一判定，非法值回落 tool）——layout 与 settings 页共用 */
export async function resolveTheme(ctx: Ctx): Promise<string> {
  const cookieTheme = ctx.cookies.get('cforum_theme');
  const theme = cookieTheme ?? (await ctx.settings.get('site_theme', 'tool'));
  return themeIsValid(theme) ? theme : 'tool';
}

/** 输出页面头部（对应 page_header()） */
export async function pageHeader(ctx: Ctx, title = ''): Promise<string> {
  const siteTitle = await ctx.settings.get('site_title', DEFAULT_SITE_TITLE);
  const fullTitle = title !== '' ? title + ' - ' + siteTitle : siteTitle;
  const user = await currentUser(ctx);
  const locale = currentLocale(ctx);
  const theme = await resolveTheme(ctx);
  const themeNames = themeNamesMap(ctx, true);
  const nextTheme = themeNext(theme);
  const themeTip = '切换主题 · 当前：' + themeNames[theme] + '（点击切换为 ' + themeNames[nextTheme] + '）';
  // 主题样式表地址表（注入前端供无刷新切换；内置两套无专属 CSS，值为空串）
  const themeCss: Record<string, string> = {};
  for (const id of themeEnabledIds()) {
    const p = themeCssPath(id);
    themeCss[id] = p ? '/' + p + '?v=' + ASSET_VERSION : '';
  }
  const curThemeCss = themeCssPath(theme);
  // 按钮本身就是一个可用的链接：JS 失效时由入口的 ?theme= 通道兜底切换
  const themeQuery = new URLSearchParams(ctx.url.searchParams);
  themeQuery.delete('theme');
  themeQuery.set('theme', nextTheme);
  const themeHref = ctx.url.pathname + '?' + themeQuery.toString();
  const bgImage = await ctx.settings.get('site_bg_image', '');
  const favicon = await ctx.settings.get('site_favicon_url', '');
  const logo = await ctx.settings.get('site_logo_url', '');
  const primary = await ctx.settings.get('site_primary_color', '#4f46e5');
  const customCss = stripForbiddenFonts(await ctx.settings.get('site_custom_css', ''), true);
  const announcement = await ctx.settings.get('site_announcement', '');
  const robots = (await ctx.settings.get('force_login', '0')) === '1' ? 'noindex, nofollow' : 'index, follow';
  const csrf = await csrfToken(ctx);
  const userJson = user ? normalizeAssetUrls(publicUser(user)) : null;

  let h = '';
  h += '<!doctype html>\n';
  h += `<html lang="${e(locale)}">\n<head>\n`;
  h += '\t<meta charset="utf-8">\n';
  h += '\t<meta name="viewport" content="width=device-width, initial-scale=1">\n';
  h += `\t<meta name="robots" content="${e(robots)}">\n`;
  h += `\t<meta name="description" content="${e(await ctx.settings.get('site_description', siteTitle))}">\n`;
  h += `\t<meta name="csrf-token" content="${e(csrf)}">\n`;
  h += `\t<meta name="theme" content="${e(theme)}">\n`;
  h += `\t<title>${e(fullTitle)}</title>\n`;
  h += '\t<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">\n';
  if (favicon) h += `\t<link rel="icon" href="${e(assetUrl(favicon))}">\n`;
  h += `\t<link rel="stylesheet" href="/assets/css/style.css?v=${ASSET_VERSION}">\n`;
  if (curThemeCss) {
    h += `\t<link rel="stylesheet" id="theme-style" href="/${e(curThemeCss)}?v=${ASSET_VERSION}">\n`;
  }
  h += '\t<script>\n\t\twindow.CFORUM = {\n';
  h += `\t\t\tbase: ${JSON.stringify(ctx.origin)},\n`;
  h += `\t\t\tlocale: ${JSON.stringify(locale)},\n`;
  h += `\t\t\ttheme: ${JSON.stringify(theme)},\n`;
  h += `\t\t\tthemes: ${JSON.stringify(themeNames)},\n`;
  h += `\t\t\tthemeOrder: ${JSON.stringify(themeEnabledIds())},\n`;
  h += `\t\t\tthemeCss: ${JSON.stringify(themeCss)},\n`;
  h += `\t\t\tuser: ${JSON.stringify(userJson)}\n`;
  h += '\t\t};\n\t</script>\n';
  h += '\t<style>\n';
  h += `\t\t:root { --color-sakura: ${e(primary)}; }\n`;
  if (bgImage) h += `\t\tbody { --user-bg: url('${e(assetUrl(bgImage))}'); }\n`;
  h += '\t\t' + customCss + '\n';
  h += '\t</style>\n';
  h += `\t<script src="/assets/js/app.js?v=${ASSET_VERSION}"></script>\n`;
  h += '</head>\n';
  h += `<body class="theme-${e(theme)}${bgImage ? ' with-bg' : ''}">\n`;
  h += '<header class="site-header">\n\t<div class="container header-inner">\n';
  h += '\t\t<a class="brand" href="/">\n';
  if (logo) {
    h += `\t\t\t<img class="brand-img" src="${e(logo)}" alt="logo">\n`;
  } else {
    h += '\t\t\t<span class="brand-logo">T</span>\n';
  }
  h += `\t\t\t<span class="brand-name" title="${e(siteTitle)}">${e(siteTitle)}</span>\n\t\t</a>\n`;
  h += '\t\t<form class="header-search" method="get" action="/">\n';
  h += `\t\t\t<input type="search" name="q" value="${e(ctx.strParam('q', ''))}" placeholder="${e(t(ctx, 'searchPlaceholder', {}, '搜索标题 / 内容'))}">\n`;
  h += '\t\t</form>\n';
  h += '\t\t<div class="header-actions">\n';
  h += `\t\t\t<a class="header-icon" id="theme-toggle" href="${e(themeHref)}" data-theme-target="${e(nextTheme)}" role="button" title="${e(themeTip)}" aria-label="${e(themeTip)}">${THEME_MAG_SVG}${THEME_TOOL_SVG}${THEME_CYCLE_SVG}</a>\n`;
  if (user) {
    h += '\t\t\t<div class="user-menu">\n\t\t\t\t<button class="user-trigger" id="user-toggle">\n';
    if (user.avatar_url && String(user.avatar_url).includes('uploads/')) {
      h += `\t\t\t\t\t<img class="header-avatar" src="${e(assetUrl(String(user.avatar_url)))}" alt="avatar">\n`;
    } else {
      h += `\t\t\t\t\t<span class="header-avatar-letter">${e(mbSubstr(String(user.username), 0, 1).toUpperCase())}</span>\n`;
    }
    h += `\t\t\t\t\t<span class="header-username">${e(user.nickname ? user.nickname : user.username)}</span>\n`;
    if (user.role === 'admin') {
      h += `\t\t\t\t\t<span class="header-admin-tag">${e(t(ctx, 'admin', {}, '管理员'))}</span>\n`;
    }
    h += '\t\t\t\t</button>\n\t\t\t\t<div class="dropdown" id="user-dropdown">\n';
    h += `\t\t\t\t\t<a href="/profile?id=${Number(user.id)}">👤 ${e(t(ctx, 'profile', {}, '个人主页'))}</a>\n`;
    h += `\t\t\t\t\t<a href="/settings">⚙️ ${e(t(ctx, 'settings', {}, '设置'))}</a>\n`;
    h += '\t\t\t\t\t<a href="/likes">❤️ 我的点赞</a>\n';
    if (user.role === 'admin') {
      h += '\t\t\t\t\t<div class="divider"></div>\n';
      h += `\t\t\t\t\t<a href="/admin">🛡️ ${e(t(ctx, 'adminPanel', {}, '管理后台'))}</a>\n`;
    }
    h += '\t\t\t\t</div>\n\t\t\t</div>\n';
    h += `\t\t\t<button class="header-logout" data-action="logout">${e(t(ctx, 'logout', {}, '退出'))}</button>\n`;
    h += '\t\t\t<a class="btn btn-primary header-new-btn" href="/post-new">发布新帖</a>\n';
  } else {
    h += `\t\t\t<a class="btn btn-sm btn-outline" href="/login">${e(t(ctx, 'login', {}, '登录'))}</a>\n`;
    h += `\t\t\t<a class="btn btn-sm btn-primary" href="/register">${e(t(ctx, 'register', {}, '注册'))}</a>\n`;
  }
  h += '\t\t</div>\n\t</div>\n</header>\n';
  if (announcement) {
    h += '\n<div class="site-announcement container" style="margin-top:14px">\n';
    h += '\t<div class="card glass" style="padding:10px 16px;display:flex;align-items:center;gap:10px;font-size:13px">\n';
    h += '\t\t<span>📢</span>\n';
    h += `\t\t<span style="flex:1">${sanitizeHtml(announcement)}</span>\n`;
    h += '\t</div>\n</div>\n';
  }
  h += '\n<main class="container">\n';
  return h;
}

/** 输出页面底部（对应 page_footer()） */
export async function pageFooter(ctx: Ctx): Promise<string> {
  const icp = await ctx.settings.get('site_icp', '');
  const footerHtml = await ctx.settings.get('site_footer_html', '');
  // 版权声明：未保存过用默认文案；保存为空（trim 后）则不输出这一行
  const copyright = (await ctx.settings.get('site_copyright', DEFAULT_SITE_COPYRIGHT)).trim();
  let h = '\n</main>\n<footer class="site-footer">\n\t<div class="container">\n';
  if (copyright) h += '\t\t<p>' + sanitizeHtml(copyright) + '</p>\n';
  if (icp) h += `\t\t<p>${e(icp)}</p>\n`;
  h += '\t\t' + sanitizeHtml(footerHtml) + '\n';
  h += '\t</div>\n</footer>\n';
  h += '<div id="toast-container"></div>\n';
  h += '<div class="modal-overlay" id="modal-overlay"><div class="modal card" id="modal-box"></div></div>\n';
  const footerCustomJs = stripForbiddenFonts(await ctx.settings.get('site_custom_js', ''), true);
  if (footerCustomJs) {
    h += `<script>${footerCustomJs}</script>\n`;
  }
  h += '</body>\n</html>\n';
  return h;
}

/** 输出 flash 消息（对应 show_flash()：渲染后清除） */
export function showFlash(ctx: Ctx): string {
  const flash = ctx.readFlash();
  const types = Object.keys(flash);
  if (types.length === 0) return '';
  ctx.clearCookie(FLASH_COOKIE);
  let out = '';
  for (const type of types) {
    for (const msg of flash[type] ?? []) {
      out += `<div class="flash ${e(type)}">${e(msg)}</div>`;
    }
  }
  return out;
}
