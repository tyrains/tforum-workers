/**
 * 多语言：对应 PHP 版 lib/i18n.php。翻译数据在 translations.ts（由 translations.php 机械转换）。
 * 语言解析顺序：?lang=（写 Cookie）→ Cookie cforum_locale → Accept-Language → 默认 zh-CN。
 * （PHP 版在 ?lang= 与 Cookie 之间还有一层 Session，Workers 版用 Cookie 承载，行为等价。）
 */
import type { Ctx } from './ctx';
import { TRANSLATIONS } from './translations';

/** 支持的语言列表 */
export function locales(): Record<string, { label: string; flag: string }> {
  return {
    'zh-CN': { label: '简体中文', flag: '🇨🇳' },
    'zh-TW': { label: '繁體中文', flag: '🇹🇼' },
    en: { label: 'English', flag: '🇺🇸' },
    ja: { label: '日本語', flag: '🇯🇵' },
    ko: { label: '한국어', flag: '🇰🇷' },
  };
}

/** 当前语言 */
export function currentLocale(ctx: Ctx): string {
  if (ctx.localeValue) return ctx.localeValue;
  let result: string | null = null;
  const langParam = ctx.query.get('lang');
  if (langParam && Object.prototype.hasOwnProperty.call(TRANSLATIONS, langParam)) {
    ctx.setCookie('cforum_locale', langParam, { maxAge: 365 * 86400, httpOnly: false });
    result = langParam;
  }
  if (!result) {
    const cookieLang = ctx.cookies.get('cforum_locale');
    if (cookieLang && Object.prototype.hasOwnProperty.call(TRANSLATIONS, cookieLang)) result = cookieLang;
  }
  if (!result) {
    const accept = (ctx.request.headers.get('Accept-Language') ?? '').toLowerCase();
    if (accept.includes('zh-tw') || accept.includes('zh-hk') || accept.includes('zh-mo')) result = 'zh-TW';
    else if (accept.includes('zh')) result = 'zh-CN';
    else if (accept.includes('ja')) result = 'ja';
    else if (accept.includes('ko')) result = 'ko';
    else result = 'zh-CN';
  }
  ctx.localeValue = result;
  return result;
}

/** 翻译。用法：t(ctx, 'loading') 或 t(ctx, 'pageInfo', {cur: 1, total: 5}) */
export function t(ctx: Ctx, key: string, vars: Record<string, unknown> = {}, def = ''): string {
  const lang = currentLocale(ctx);
  let str = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS['zh-CN']?.[key] ?? (def !== '' ? def : key);
  for (const [name, value] of Object.entries(vars)) {
    str = str.split('{{' + name + '}}').join(String(value));
  }
  return str;
}
