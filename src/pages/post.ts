/** 帖子详情页：正文 + 点赞 + 楼中楼评论（对应 pages/post.php，链接改干净路径） */
import type { Ctx } from '../lib/ctx';
import { assetUrl, e, formatDatetime, fmtDateTime } from '../lib/core';
import { currentUser } from '../lib/auth';
import { postSelectSql, renderMarkdown } from '../lib/content';
import type { Row } from '../lib/db';

export async function renderPost(ctx: Ctx, postId: number): Promise<string> {
  const post = postId ? await ctx.db.one(postSelectSql() + ' WHERE posts.id = ?', [postId]) : null;
  const viewer = await currentUser(ctx);
  const viewerId = viewer ? Number(viewer.id) : -1;

  if (!post || ((post as Row).status === 'hidden' && viewerId !== Number((post as Row).author_id) && (viewer?.role ?? '') !== 'admin')) {
    return '<div class="empty card"><div class="empty-icon">😕</div><p>帖子不存在或已被隐藏</p><a class="btn" href="/">返回首页</a></div>';
  }
  const p = post as Row;
  const commentMax = await ctx.settings.strictInt('comment_max_length', 500, 1, 1000000);

  await ctx.db.run('UPDATE posts SET view_count = COALESCE(view_count,0) + 1 WHERE id = ?', [postId]);
  p.view_count = Number(p.view_count) + 1;
  const liked = viewer
    ? Boolean(Number(await ctx.db.val('SELECT COUNT(*) FROM likes WHERE post_id = ? AND user_id = ?', [postId, viewerId])) || 0)
    : false;
  const comments = await ctx.db.all(
    `SELECT comments.*, users.username, users.avatar_url, users.role FROM comments
		 JOIN users ON comments.author_id = users.id
		 WHERE comments.post_id = ? AND comments.status != "hidden" ORDER BY comments.created_at ASC`,
    [postId],
  ) as Row[];
  const likers = await ctx.db.all(
    'SELECT users.id, users.username FROM likes JOIN users ON likes.user_id = users.id WHERE likes.post_id = ? ORDER BY likes.created_at DESC LIMIT 20',
    [postId],
  ) as Row[];
  const canEdit = Boolean(viewer) && (Number(p.author_id) === viewerId || viewer?.role === 'admin');

  let h = '';
  h += '<div class="detail-page">\n\t<div class="detail-container">\n';
  h += '\t\t<a class="detail-back" href="/">← 返回</a>\n';
  h += '\t\t<div class="detail-grid">\n\t\t\t<div class="detail-main">\n';
  if (p.category_name) h += `\t\t\t\t<div class="detail-cat">${e(p.category_name)}</div>\n`;
  h += `\t\t\t\t<h1 class="detail-title">${e(p.title)}</h1>\n`;
  h += '\t\t\t\t<div class="detail-meta">\n';
  h += `\t\t\t\t\t<span>${e(p.author_name)}</span>\n`;
  h += `\t\t\t\t\t<span>${e(fmtDateTime(String(p.created_at)))}</span>\n`;
  h += `\t\t\t\t\t<span>♡ ${Number(p.like_count)}</span>\n`;
  h += `\t\t\t\t\t<span>◉ ${Number(p.view_count)}</span>\n`;
  if (canEdit) h += `\t\t\t\t\t<a class="detail-edit" href="/post-edit?id=${postId}" title="编辑">✎</a>\n`;
  h += '\t\t\t\t</div>\n\n';
  h += `\t\t\t\t<div class="detail-body markdown">${renderMarkdown(String(p.content))}</div>\n\n`;
  h += '\t\t\t\t<div class="detail-actions">\n';
  h += `\t\t\t\t\t<button class="like-btn ${liked ? 'liked' : ''}" data-post="${postId}">\n`;
  h += `\t\t\t\t\t\t<span class="heart">${liked ? '❤️' : '🤍'}</span>\n`;
  h += `\t\t\t\t\t\t<span class="like-count">${Number(p.like_count)}</span> 赞\n`;
  h += '\t\t\t\t\t</button>\n';
  if (likers.length) {
    h += `\t\t\t\t\t<span class="detail-likers">点赞者：${e(likers.map((l) => String(l.username)).join('、'))}</span>\n`;
  }
  h += '\t\t\t\t\t<span style="flex:1"></span>\n';
  if (canEdit) {
    h += `\t\t\t\t\t<button class="detail-delete" data-confirm="确定删除这个帖子？" data-delete="posts/${postId}">删除</button>\n`;
  }
  h += '\t\t\t\t</div>\n\n';
  h += '\t\t\t\t<section class="comments-section detail-comments">\n';
  h += `\t\t\t\t\t<h2 class="comments-title">评论 <span class="badge">${comments.length}</span></h2>\n\n`;
  if (comments.length === 0) {
    h += '\t\t\t\t\t<p class="comments-empty">还没有评论。</p>\n';
  }
  for (const c of comments) {
    if (c.parent_id) continue;
    const children = comments.filter((child) => Number(child.parent_id) === Number(c.id));
    h += `\t\t\t\t\t<div class="comment-item card" id="comment-${Number(c.id)}">\n`;
    h += '\t\t\t\t\t\t<div class="comment-main">\n';
    h += `\t\t\t\t\t\t\t<div class="comment-text markdown">${renderMarkdown(String(c.content))}</div>\n`;
    h += '\t\t\t\t\t\t\t<div class="comment-actions">\n';
    if (viewer && p.status !== 'locked') {
      h += `\t\t\t\t\t\t\t\t<button data-reply="${Number(c.id)}">↩ 回复</button>\n`;
    }
    if (canEdit || (viewer && Number(c.author_id) === viewerId)) {
      h += `\t\t\t\t\t\t\t\t<button data-confirm="删除这条评论？" data-delete="comments/${Number(c.id)}">🗑 删除</button>\n`;
    }
    h += '\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t</div>\n';
    h += '\t\t\t\t\t\t<div class="comment-author">\n';
    h += `\t\t\t\t\t\t\t<a href="/profile?id=${Number(c.author_id)}"><strong>${e(c.username)}</strong></a>\n`;
    h += `\t\t\t\t\t\t\t<span class="comment-time">${e(formatDatetime(String(c.created_at)))}</span>\n`;
    h += '\t\t\t\t\t\t</div>\n';
    if (children.length) {
      h += '\t\t\t\t\t\t<div class="comment-children">\n';
      for (const child of children) {
        h += `\t\t\t\t\t\t\t<div class="comment-item card" id="comment-${Number(child.id)}">\n`;
        h += '\t\t\t\t\t\t\t\t<div class="comment-main">\n';
        h += `\t\t\t\t\t\t\t\t\t<div class="comment-text markdown">${renderMarkdown(String(child.content))}</div>\n`;
        h += '\t\t\t\t\t\t\t\t\t<div class="comment-actions">\n';
        if (viewer && p.status !== 'locked') {
          h += `\t\t\t\t\t\t\t\t\t\t<button data-reply="${Number(c.id)}">↩ 回复</button>\n`;
        }
        h += '\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t</div>\n';
        h += '\t\t\t\t\t\t\t\t<div class="comment-author">\n';
        h += `\t\t\t\t\t\t\t\t\t<a href="/profile?id=${Number(child.author_id)}"><strong>${e(child.username)}</strong></a>\n`;
        h += `\t\t\t\t\t\t\t\t\t<span class="comment-time">${e(formatDatetime(String(child.created_at)))}</span>\n`;
        h += '\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t</div>\n';
      }
      h += '\t\t\t\t\t\t</div>\n';
    }
    h += '\t\t\t\t\t</div>\n';
  }
  h += '\n';
  if (viewer && p.status !== 'locked') {
    h += `\t\t\t\t\t<form id="comment-form" class="comment-compose" data-ajax="posts/${postId}/comments" data-method="POST" data-reload="1">\n`;
    h += '\t\t\t\t\t\t<input type="hidden" name="parent_id" value="">\n';
    h += `\t\t\t\t\t\t<textarea class="textarea" name="content" required maxlength="${commentMax}" placeholder="写下你的评论……"></textarea>\n`;
    h += '\t\t\t\t\t\t<div class="comment-compose-foot">\n\t\t\t\t\t\t\t<span class="hint">支持 Markdown</span>\n\t\t\t\t\t\t\t<button class="btn btn-primary" type="submit">发布评论</button>\n\t\t\t\t\t\t</div>\n\t\t\t\t\t</form>\n';
  } else if (!viewer) {
    h += '\t\t\t\t\t<div class="comment-login">登录后即可参与评论　<a class="btn btn-primary btn-sm" href="/login">去登录</a></div>\n';
  } else {
    h += '\t\t\t\t\t<div class="flash error" style="margin-top:18px">🔒 该帖子已锁定，无法发表评论</div>\n';
  }
  h += '\t\t\t\t</section>\n\t\t\t</div>\n\n';
  h += '\t\t\t<aside class="detail-toc">\n\t\t\t\t<div class="toc-title">目录</div>\n\t\t\t\t<div id="toc-list"></div>\n\t\t\t</aside>\n';
  h += '\t\t</div>\n\t</div>\n</div>\n';
  return h;
}
