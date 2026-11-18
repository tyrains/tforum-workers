/** 用户协议 / 隐私政策（对应 pages/legal.php，两个干净路径共用） */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';
import { t } from '../lib/i18n';
import { renderMarkdown } from '../lib/content';

export async function renderLegal(ctx: Ctx, isTerms: boolean): Promise<string> {
  const title = isTerms ? t(ctx, 'terms', {}, '用户协议') : t(ctx, 'privacy', {}, '隐私政策');
  const content = await ctx.settings.get(isTerms ? 'site_terms' : 'site_privacy', '');
  let h = `<div class="page-heading"><h1>📜 ${e(title)}</h1></div>\n`;
  h += '<div class="card" style="padding:28px;min-height:280px">\n';
  if (content.trim() === '') {
    h += `\t<div class="empty" style="padding:40px"><p>管理员尚未发布${e(title)}内容。</p></div>\n`;
  } else {
    h += `\t<div class="markdown">${renderMarkdown(content)}</div>\n`;
  }
  h += '</div>\n';
  return h;
}
