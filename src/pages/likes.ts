/** 我的点赞（对应 pages/likes.php，链接改干净路径） */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';
import { pageRequireUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { markdownExcerpt } from '../lib/content';
import { showFlash } from '../lib/layout';
import type { Row } from '../lib/db';

export async function renderLikes(ctx: Ctx): Promise<string> {
  const user = await pageRequireUser(ctx);
  const limit = 20;
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const posts = await ctx.db.all(
    `SELECT posts.*, users.username as author_name, categories.name as category_name,
		(SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
		(SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
	 FROM likes JOIN posts ON likes.post_id = posts.id
	 JOIN users ON posts.author_id = users.id LEFT JOIN categories ON posts.category_id = categories.id
	 WHERE likes.user_id = ? AND posts.status = "normal"
	 ORDER BY likes.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [user.id],
  ) as Row[];

  let h = `<div class="page-heading"><h1>❤️ ${e(t(ctx, 'myLikes', {}, '我的点赞'))}</h1></div>\n`;
  h += showFlash(ctx) + '\n';
  if (posts.length === 0) {
    h += '<div class="empty card"><div class="empty-icon">💝</div><p>还没有点赞过任何帖子</p><a class="btn" href="/">去逛逛</a></div>\n';
  } else {
    h += '<div class="post-list">\n';
    for (const p of posts) {
      h += '\t<article class="post-item card">\n\t\t<div class="post-main">\n';
      h += `\t\t\t<h3 class="post-title"><a href="/post/${Number(p.id)}">${e(p.title)}</a></h3>\n`;
      h += `\t\t\t<p class="post-excerpt">${e(markdownExcerpt(String(p.content), 140))}</p>\n`;
      h += `\t\t\t<div class="post-meta"><span class="cat">${e(p.category_name ? p.category_name : '未分类')}</span><span>👤 ${e(p.author_name)}</span></div>\n`;
      h += '\t\t</div>\n';
      h += `\t\t<div class="post-stats"><span>❤ ${Number(p.like_count)}</span><span>💬 ${Number(p.comment_count)}</span></div>\n\t</article>\n`;
    }
    h += '</div>\n';
  }
  return h;
}
