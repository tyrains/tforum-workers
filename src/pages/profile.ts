/** 个人主页（对应 pages/profile.php，链接改干净路径） */
import type { Ctx } from '../lib/ctx';
import { assetUrl, e, fmtDate, timeAgo } from '../lib/core';
import { currentUser } from '../lib/auth';
import { markdownExcerpt, postSelectSql } from '../lib/content';
import type { Row } from '../lib/db';

/** nl2br(e($bio)) 的等价实现 */
function nl2br(s: string): string {
  return s.replace(/\n/g, '<br>\n');
}

export async function renderProfile(ctx: Ctx): Promise<string> {
  const uid = ctx.intParam('id', 0);
  const target = uid ? await ctx.db.one('SELECT * FROM users WHERE id = ?', [uid]) : null;
  if (!target) {
    return '<div class="empty card"><p>用户不存在</p></div>';
  }
  const u = target as Row;
  const avatar = assetUrl(u.avatar_url ? String(u.avatar_url) : '/api/avatar?id=' + uid);
  const postCount = Number(await ctx.db.val('SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = "normal"', [uid])) || 0;
  const commentCount = Number(await ctx.db.val('SELECT COUNT(*) FROM comments WHERE author_id = ?', [uid])) || 0;
  const likeCount = Number(await ctx.db.val('SELECT COUNT(*) FROM likes WHERE user_id = ?', [uid])) || 0;
  const posts = await ctx.db.all(postSelectSql() + ' WHERE posts.author_id = ? AND posts.status = "normal" ORDER BY posts.created_at DESC LIMIT 20', [uid]) as Row[];
  const self = await currentUser(ctx);

  let h = '';
  h += '<div class="card" style="overflow:hidden;margin-top:24px">\n';
  h += `\t<div class="profile-banner" ${u.bg_image ? `style="background-image:url(${e(assetUrl(String(u.bg_image)))})"` : ''}></div>\n`;
  h += '\t<div class="profile-card">\n';
  h += `\t\t<img class="profile-avatar" src="${e(avatar)}" alt="avatar">\n`;
  h += `\t\t<h1 class="profile-name">${e(u.nickname ? u.nickname : u.username)}\n`;
  if (u.role === 'admin') h += '\t\t\t<span class="badge admin">🛡️ 管理员</span>\n';
  h += '\t\t</h1>\n';
  h += `\t\t<div style="color:var(--muted-foreground);font-size:12px">@${e(u.username)} · 加入于 ${e(fmtDate(String(u.created_at)))}</div>\n`;
  if (u.bio) {
    h += `\t\t<p class="profile-bio">${nl2br(e(String(u.bio)))}</p>\n`;
  } else {
    h += '\t\t<div style="height:14px"></div>\n';
  }
  h += '\t\t<div class="profile-stats">\n';
  h += `\t\t\t<div><strong>${postCount}</strong><span>帖子</span></div>\n`;
  h += `\t\t\t<div><strong>${commentCount}</strong><span>评论</span></div>\n`;
  h += `\t\t\t<div><strong>${likeCount}</strong><span>点赞</span></div>\n`;
  h += '\t\t</div>\n\t\t<div style="display:flex;gap:8px">\n';
  if (self && Number(self.id) === uid) {
    h += '\t\t\t<a class="btn btn-primary btn-sm" href="/settings">✏️ 编辑资料</a>\n';
  }
  h += '\t\t\t<a class="btn btn-outline btn-sm" href="/">← 返回首页</a>\n';
  h += '\t\t</div>\n\t</div>\n</div>\n\n';
  h += '<h2 style="display:flex;align-items:center;gap:8px;font-family:var(--font-sans);font-weight:700;margin:28px 0 14px;font-size:20px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>TA 的帖子</h2>\n';
  if (posts.length === 0) {
    h += '<div class="empty card">还没有发表过帖子</div>\n';
  } else {
    h += '<div class="post-list">\n';
    for (const p of posts) {
      h += '\t<article class="post-item card">\n\t\t<div class="post-main">\n';
      h += `\t\t\t<h3 class="post-title"><a href="/post/${Number(p.id)}">${e(p.title)}</a></h3>\n`;
      h += `\t\t\t<p class="post-excerpt">${e(markdownExcerpt(String(p.content), 140))}</p>\n`;
      h += `\t\t\t<div class="post-meta"><span class="cat">${e(p.category_name ? p.category_name : '未分类')}</span><span>${e(timeAgo(String(p.created_at)))}</span></div>\n`;
      h += '\t\t</div>\n';
      h += `\t\t<div class="post-stats"><span>❤ ${Number(p.like_count)}</span><span>💬 ${Number(p.comment_count)}</span></div>\n\t</article>\n`;
    }
    h += '</div>\n';
  }
  return h;
}
