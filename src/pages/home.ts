/** 首页：帖子列表 + 分类筛选 + 搜索 + 排序（对应 pages/home.php，链接改干净路径） */
import type { Ctx } from '../lib/ctx';
import { e, fmtCnDateTime, fmtDateTime } from '../lib/core';
import { currentUser } from '../lib/auth';
import { postSelectSql } from '../lib/content';
import type { Row } from '../lib/db';

export async function renderHome(ctx: Ctx): Promise<string> {
  // 每页帖子数由后台「首页每页帖子数」控制；非法/越界回落 10，防止异常值导致分页除零或超大查询
  const limit = await ctx.settings.strictInt('posts_per_page', 10, 1, 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const categoryId = ctx.strParam('category_id', '');
  const q = ctx.strParam('q', '').trim();
  const sortBy = ctx.strParam('sort_by', 'time');
  const sortDir = ctx.strParam('sort_dir', 'desc');

  const user = await currentUser(ctx);
  const uid = user ? Number(user.id) : -1;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (uid > 0) {
    conditions.push('(posts.status = "normal" OR (posts.author_id = ? AND posts.status = "hidden"))');
    params.push(uid);
  } else {
    conditions.push('posts.status = "normal"');
  }
  if (categoryId !== '' && categoryId !== 'uncategorized') {
    conditions.push('posts.category_id = ?');
    params.push(Number(categoryId));
  } else if (categoryId === 'uncategorized') {
    conditions.push('posts.category_id IS NULL');
  }
  if (q !== '') {
    conditions.push('(posts.title LIKE ? OR posts.content LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortExpr =
    sortBy === 'likes' ? 'like_count ' + dir :
    sortBy === 'comments' ? 'comment_count ' + dir :
    sortBy === 'views' ? 'posts.view_count ' + dir :
    'posts.created_at ' + dir;
  const sql = postSelectSql() + where + ' ORDER BY is_pinned DESC, ' + sortExpr + ', posts.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset;
  const posts = await ctx.db.all(sql, params);
  const total = Number(await ctx.db.val('SELECT COUNT(*) FROM posts' + where, params)) || 0;
  const categories = await ctx.db.all(
    'SELECT categories.*, (SELECT COUNT(*) FROM posts WHERE category_id = categories.id AND status = "normal") as post_count FROM categories ORDER BY CASE name WHEN "技术" THEN 0 WHEN "灌水" THEN 1 WHEN "其他" THEN 2 ELSE 3 END, id',
  );

  const buildLink = (overrides: Record<string, string | number | null>): string => {
    const p = new Map<string, string>();
    if (q !== '') p.set('q', q);
    if (categoryId !== '') p.set('category_id', categoryId);
    p.set('sort_by', sortBy);
    p.set('sort_dir', sortDir);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    const qs = new URLSearchParams([...p.entries()]).toString();
    return e(qs ? '/?' + qs : '/');
  };
  const catLink = (id: string) => buildLink({ category_id: id, offset: null });

  let h = '';
  h += '<div class="forum-page">\n';
  h += '\t<div class="forum-toolbar">\n\t\t<nav class="forum-tabs">\n';
  h += `\t\t\t<a href="${catLink('')}" class="${categoryId === '' ? 'active' : ''}">全部</a>\n`;
  for (const cat of categories as Row[]) {
    h += `\t\t\t<a href="${catLink(String(cat.id))}" class="${categoryId === String(cat.id) ? 'active' : ''}">${e(cat.name)}</a>\n`;
  }
  h += '\t\t</nav>\n\t</div>\n\n';
  h += '\t<div class="forum-table">\n';
  h += '\t\t<div class="forum-row forum-thead">\n\t\t\t<span>板块</span><span>标题</span><span>发帖人</span><span>发布时间</span><span class="th-num">点赞</span><span class="th-num">点击</span><span class="th-num">评论</span>\n\t\t</div>\n';
  if (posts.length === 0) {
    h += '\t\t<div class="forum-empty">暂无帖子，快来发第一帖吧</div>\n';
  } else {
    for (const post of posts as Row[]) {
      h += `\t\t<a class="forum-row" href="/post/${Number(post.id)}">\n`;
      h += `\t\t\t<span class="cell-cat">${e(post.category_name ? post.category_name : '未分类')}</span>\n`;
      h += `\t\t\t<span class="cell-title">${Number(post.is_pinned) === 1 ? '<span class="pin-dot">●</span>' : ''}${e(post.title)}</span>\n`;
      h += `\t\t\t<span class="cell-author">${e(post.author_name)}</span>\n`;
      h += `\t\t\t<span class="cell-date"><span class="date-iso">${e(fmtDateTime(String(post.created_at)))}</span><span class="date-cn">${e(fmtCnDateTime(String(post.created_at)))}</span></span>\n`;
      h += `\t\t\t<span class="cell-num"><span class="num-ico">♡</span><span class="num-val">${Number(post.like_count)}</span></span>\n`;
      h += `\t\t\t<span class="cell-num"><span class="num-ico">◉</span><span class="num-val">${Number(post.view_count)}</span></span>\n`;
      h += `\t\t\t<span class="cell-num"><span class="num-ico">▭</span><span class="num-val">${Number(post.comment_count)}</span></span>\n`;
      h += '\t\t</a>\n';
    }
  }
  h += '\t</div>\n\n';
  const pagesCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  h += '\t<div class="forum-pagination">\n';
  if (currentPage > 1) h += `\t\t<a href="${buildLink({ offset: (currentPage - 2) * limit })}">上一页</a>`;
  h += `\t\t<span>第 ${currentPage} / ${Math.max(pagesCount, 1)} 页</span>\n`;
  if (currentPage < pagesCount) h += `\t\t<a href="${buildLink({ offset: currentPage * limit })}">下一页</a>`;
  h += '\n\t</div>\n</div>\n';
  return h;
}
