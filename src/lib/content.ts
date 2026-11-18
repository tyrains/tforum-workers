/**
 * 内容处理：对应 PHP 版 lib/content.php 与 api_content.php 中的内容规则函数。
 * Markdown 渲染、HTML 净化、禁用字体剥离、图片上传（R2）、TOTP 之外的全部内容逻辑。
 * 净化说明：PHP 版优先用 DOMDocument，Workers 无 DOM；此处以其正则退化路径为基线，
 * 并补齐 DOM 路径的危险标签/属性过滤规则（script/style/iframe 等整棵删除、
 * font 等旧式标签去壳留字、style/face 与 on 开头事件属性、srcdoc/formaction 属性及 javascript: 链接剥离）。
 */
import type { Ctx } from './ctx';
import { assetUrl, e, err, fmtFileStamp, fmtShanghai, mbLen, mbSubstr, randomToken } from './core';
import type { Row } from './db';

// ---------------- 字体安全：禁止装饰/手写字体（与 PHP 版名单一致） ----------------

export function forbiddenFontRe(): RegExp {
  return /ZCOOL|KuaiLe|Ma\s*\+?\s*Shan|MaShan|站酷快乐|马善政|毛笔体|快乐体/i;
}

/**
 * 从 CSS / JS / HTML 文本中彻底剥离装饰字体（对应 strip_forbidden_fonts()）：
 * 1) 删掉引用这些字体的 @import 与 @font-face
 * 2) cssMode 时把引用这些字体的 font / font-family 声明改写为站点正文字体
 * 3) 抹掉其余残留字体名，替换为 Noto Sans SC
 */
export function stripForbiddenFonts(text: string, cssMode = false): string {
  const re = forbiddenFontRe();
  let out = text.replace(/@import[^;]*;|@font-face\s*\{[^}]*\}/gi, (m) => (forbiddenFontRe().test(m) ? '' : m));
  if (cssMode) {
    out = out.replace(/\bfont(?:-family)?\s*:\s*[^;}>]*/gi, (m) => (forbiddenFontRe().test(m) ? 'font-family: var(--font-sans)' : m));
  }
  return out.replace(new RegExp(re.source, 'gi'), 'Noto Sans SC');
}

// ---------------- HTML 净化（对应 sanitize_html()） ----------------

export function sanitizeHtml(html: string): string {
  let out = html;
  // 危险标签连内容整棵删除
  out = out.replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // 危险标签的残余开/闭标签（含 link/meta/base 等无内容标签）
  out = out.replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '');
  // 旧式排版/字体标签只去壳、保留文字
  out = out.replace(/<\/?(font|big|center|marquee|blink|tt)\b[^>]*>/gi, '');
  // 属性级清洗：逐个标签解析属性并剔除危险项（对应 DOM 路径的属性规则）
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g,
    (_whole, tag: string, attrsRaw: string, selfClose: string) => {
      const kept: string[] = [];
      const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrsRaw)) !== null) {
        const name = m[1];
        const lname = name.toLowerCase();
        const rawValue = m[2] ?? '';
        const value = rawValue.replace(/^["']|["']$/g, '').trim();
        if (
          lname === 'style' || lname === 'face' ||
          lname.startsWith('on') ||
          lname === 'srcdoc' || lname === 'formaction' ||
          /^\s*javascript\s*:/i.test(value) ||
          /^\s*data\s*:\s*text\/html/i.test(value) ||
          /font-family|@font-face|@import/i.test(value) ||
          forbiddenFontRe().test(value)
        ) {
          continue;
        }
        kept.push(m[0]);
      }
      return '<' + tag + (kept.length ? ' ' + kept.join(' ') : '') + (selfClose ? '/' : '') + '>';
    });
  return out;
}

// ---------------- Markdown 渲染（对应 render_markdown()/md_inline()，逐行状态机平移） ----------------

/** 行内元素渲染 */
export function mdInline(s: string): string {
  let out = e(s);
  // 图片（站内路径归一化）
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi,
    (_m, alt: string, url: string) => '<img src="' + assetUrl(url) + '" alt="' + alt + '" loading="lazy">');
  // 链接
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi,
    (_m, text: string, url: string) => '<a href="' + assetUrl(url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>');
  // 行内代码
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // 粗体 / 斜体 / 删除线
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

/**
 * 轻量 Markdown → HTML。
 * 支持：标题、粗斜体、删除线、行内代码、围栏代码块、引用、列表、分割线、图片、链接、表格、换行。
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  const total = lines.length;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType !== null) {
      html.push('</' + listType + '>');
      listType = null;
    }
  };

  while (i < total) {
    const line = lines[i];

    // 围栏代码块
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const lang = fence[1] !== '' ? ' class="language-' + e(fence[1]) + '"' : '';
      const code: string[] = [];
      i++;
      while (i < total && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      html.push('<pre><code' + lang + '>' + e(code.join('\n')) + '</code></pre>');
      continue;
    }

    // 空行
    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      i++;
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>` + mdInline(heading[2]) + `</h${level}>`);
      i++;
      continue;
    }

    // 表格（表头 + 分隔行 + 数据行）
    if (i + 1 < total && line.includes('|') && /^\s*\|?[\s:\-]+\|[\s:\-|]+\|?\s*$/.test(lines[i + 1])) {
      closeList();
      const parseRow = (row: string): string[] => {
        let r = row.trim();
        r = r.replace(/^\|/, '').replace(/\|$/, '');
        return r.split('|').map((c) => c.trim());
      };
      const headers = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < total && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const t: string[] = ['<div class="md-table-wrap"><table><thead><tr>'];
      for (const h of headers) t.push('<th>' + mdInline(h) + '</th>');
      t.push('</tr></thead><tbody>');
      for (const row of rows) {
        t.push('<tr>');
        headers.forEach((_h, idx) => t.push('<td>' + mdInline(row[idx] ?? '') + '</td>'));
        t.push('</tr>');
      }
      t.push('</tbody></table></div>');
      html.push(t.join(''));
      continue;
    }

    // 引用（连续行合并）
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      const quoted: string[] = [quote[1]];
      i++;
      let q2: RegExpExecArray | null;
      while (i < total && (q2 = /^\s*>\s?(.*)$/.exec(lines[i])) !== null) {
        quoted.push(q2[1]);
        i++;
      }
      html.push('<blockquote>' + renderMarkdown(quoted.join('\n')) + '</blockquote>');
      continue;
    }

    // 列表
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const type = /^\d/.test(item[1]) ? 'ol' : 'ul';
      if (listType !== type) {
        closeList();
        html.push('<' + type + '>');
        listType = type;
      }
      html.push('<li>' + mdInline(item[2]) + '</li>');
      i++;
      continue;
    }

    // 普通段落（连续行合并）
    closeList();
    const para: string[] = [line];
    i++;
    while (
      i < total && lines[i].trim() !== '' &&
      !/^\s*(```|>|#{1,6}\s|[-*+]\s|\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push('<p>' + mdInline(para.join('\n')) + '</p>');
  }

  return sanitizeHtml(html.join('\n'));
}

/** Markdown 提取纯文本摘要（对应 markdown_excerpt()） */
export function markdownExcerpt(md: string, limit = 160): string {
  let text = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/[#*`~>\-]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return mbSubstr(text, 0, limit);
}

/** 提取 Markdown 中所有图片 URL（用于孤立文件清理） */
export function extractImageUrls(md: string): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) urls.push(m[1]);
  return urls;
}

// ---------------- 内容规则（对应 api_content.php 的两个检查函数） ----------------

/** 帖子列表 SQL 公共片段（对应 post_select_sql()） */
export function postSelectSql(): string {
  return `SELECT posts.*,
		users.username as author_name, users.avatar_url as author_avatar, users.role as author_role,
		categories.name as category_name,
		(SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
		(SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
	 FROM posts
	 JOIN users ON posts.author_id = users.id
	 LEFT JOIN categories ON posts.category_id = categories.id`;
}

/** 关键词过滤，返回内容状态（对应 apply_keyword_filter()） */
export async function applyKeywordFilter(ctx: Ctx, text: string): Promise<string> {
  const raw = await ctx.settings.get('site_keyword_filter', '');
  const keywords = raw.split('\n').map((k) => k.trim()).filter((k) => k !== '');
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return 'locked';
  }
  return 'normal';
}

/** 检查内容发布频率（对应 check_content_rate_limit()：按业务表实际计数，配置为后台 JSON） */
export async function checkContentRateLimit(
  ctx: Ctx,
  user: Row,
  settingKey: string,
  table: 'posts' | 'comments',
  message: string,
): Promise<void> {
  let config: any = null;
  try { config = JSON.parse(await ctx.settings.get(settingKey, '')); } catch { config = null; }
  if (!config || typeof config !== 'object' || !config.count) return;
  const count = Number(config.count);
  const unit = config.unit ?? 'minute';
  const window = Number(config.window ?? 1);
  const seconds = (unit === 'hour' ? 3600 : unit === 'day' ? 86400 : 60) * Math.max(window, 1);
  const since = fmtShanghai(Math.floor(Date.now() / 1000) - seconds);
  const recent = Number(await ctx.db.val(
    `SELECT COUNT(*) FROM ${table} WHERE author_id = ? AND created_at > ?`,
    [user.id, since],
  )) || 0;
  if (recent >= count) err(message, 429);
}

// ---------------- 图片上传（R2，对应 handle_image_upload()/delete_image_file()/find_orphan_images()） ----------------

/** 上传大小上限：统一 5MB（决策点 2；PHP 版 config 标注 5MB 但函数写死 2MB，此处按决策统一） */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** 按文件头魔数判断图片类型（对应 PHP finfo 的 MIME 检测） */
export function sniffImageMime(buf: Uint8Array): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

export interface UploadResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * 保存上传图片到 R2（对应 handle_image_upload()）。
 * 对象 Key：usr/<userId>/<prefix>_<日期>_<随机>.<ext>；返回值 url 为 uploads/usr/... 相对路径，与 PHP 版落盘路径同构。
 */
export async function handleImageUpload(ctx: Ctx, file: File | null, userId: number, prefix = 'img'): Promise<UploadResult> {
  if (!file || (file.size === 0 && file.name === '')) {
    return { ok: false, error: '请选择文件' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: '图片不能超过 5MB' };
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(data);
  if (!mime || !MIME_EXT[mime]) {
    return { ok: false, error: '仅支持 JPG / PNG / GIF / WebP 图片' };
  }
  const name = prefix + '_' + fmtFileStamp(Math.floor(Date.now() / 1000)) + '_' + randomToken(6) + '.' + MIME_EXT[mime];
  const key = 'usr/' + userId + '/' + name;
  try {
    await ctx.env.R2.put(key, data, { httpMetadata: { contentType: mime } });
  } catch {
    return { ok: false, error: '保存文件失败，请稍后重试' };
  }
  return { ok: true, url: 'uploads/' + key };
}

/** 删除一张 R2 图片（传入 DB 中存的相对 URL，仅允许 uploads/ 前缀，防路径穿越） */
export async function deleteImageFile(ctx: Ctx, url: string): Promise<boolean> {
  const prefix = 'uploads/';
  if (!url || !url.startsWith(prefix)) return false;
  const key = url.slice(prefix.length);
  if (key === '' || key.includes('..')) return false;
  try {
    const head = await ctx.env.R2.head(key);
    if (!head) return false;
    await ctx.env.R2.delete(key);
    return true;
  } catch {
    return false;
  }
}

/** 扫描未被引用的上传文件（对应 find_orphan_images()；比对范围另纳入 settings 的 logo/favicon/背景图——报告已定的修复项） */
export async function findOrphanImages(ctx: Ctx): Promise<string[]> {
  let references = '';
  for (const row of await ctx.db.all('SELECT content FROM posts UNION ALL SELECT content FROM comments')) {
    references += (row.content ?? '') + '\n';
  }
  for (const row of await ctx.db.all('SELECT avatar_url, bg_image FROM users')) {
    references += (row.avatar_url ?? '') + '\n' + (row.bg_image ?? '') + '\n';
  }
  for (const key of ['site_logo_url', 'site_favicon_url', 'site_bg_image']) {
    references += (await ctx.settings.get(key, '')) + '\n';
  }
  const orphans: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const listed = await ctx.env.R2.list({ prefix: 'usr/', cursor });
    for (const obj of listed.objects) {
      const rel = 'uploads/' + obj.key;
      if (!references.includes(rel)) orphans.push(rel);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return orphans;
}

/** 帖子/评论正文长度（供 API 层引用 mb_strlen 语义） */
export function contentLength(s: string): number {
  return mbLen(s);
}
