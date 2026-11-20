/**
 * 帖子、评论、点赞、分类相关 API：对应 PHP 版 lib/api_content.php，逐函数平移。
 * 唯一有意修复：评论通知邮件改为按帖子作者的 email_notifications 判断（PHP 版误读帖子字段，恒为开启）。
 */
import type { Ctx } from '../lib/ctx';
import { auditLog, e, err, hasControlChars, hasInvisibleChars, mbLen, ok } from '../lib/core';
import { currentUser, requireCsrf, requireUser } from '../lib/auth';
import {
  applyKeywordFilter, checkContentRateLimit, deleteImageFile, extractImageUrls,
  markdownExcerpt, postSelectSql, renderMarkdown, stripForbiddenFonts,
} from '../lib/content';
import { emailTemplate, sendEmail } from '../lib/mail';
import type { Row } from '../lib/db';
import { themeIsValid } from '../lib/theme-registry';

/**
 * 后台可配置的字数上限读取（集中钳制，避免异常值）。
 * 对应 PHP v2 的 post_max_chars()/comment_max_chars()；键名沿用本站既有的
 * post_max_length / comment_max_length（线上正在用，不改名），默认值与范围对齐 PHP：
 * post 默认 20000、comment 默认 500，两者都限制在 1～1000000，非法值回落默认。
 */
export async function postMaxChars(ctx: Ctx): Promise<number> {
  return ctx.settings.strictInt('post_max_length', 20000, 1, 1000000);
}
export async function commentMaxChars(ctx: Ctx): Promise<number> {
  return ctx.settings.strictInt('comment_max_length', 500, 1, 1000000);
}

/** 帖子列表 */
export async function apiListPosts(ctx: Ctx): Promise<void> {
  // 未显式传 limit 时，跟随后台「首页每页帖子数」，保证页面与接口分页一致
  const defaultLimit = await ctx.settings.strictInt('posts_per_page', 10, 1, 100);
  const limit = Math.min(Math.max(ctx.intParam('limit', defaultLimit), 1), 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const categoryId = ctx.param('category_id', '');
  const q = ctx.strParam('q', ctx.strParam('query', '')).trim();
  const sortBy = ctx.strParam('sort_by', 'time');
  const sortDir = ctx.strParam('sort_dir', 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

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
  if (categoryId !== '' && categoryId !== null && categoryId !== undefined) {
    if (categoryId === 'uncategorized') {
      conditions.push('posts.category_id IS NULL');
    } else {
      conditions.push('posts.category_id = ?');
      params.push(Number(categoryId));
    }
  }
  if (q !== '') {
    conditions.push('(posts.title LIKE ? OR posts.content LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like);
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const sortExpr =
    sortBy === 'likes' ? 'like_count ' + sortDir :
    sortBy === 'comments' ? 'comment_count ' + sortDir :
    sortBy === 'views' ? 'posts.view_count ' + sortDir :
    'posts.created_at ' + sortDir;

  const sql = postSelectSql() + where
    + ' ORDER BY is_pinned DESC, ' + sortExpr + ', posts.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset;
  const posts = await ctx.db.all(sql, params);
  const total = Number(await ctx.db.val('SELECT COUNT(*) FROM posts' + where, params)) || 0;

  for (const p of posts) {
    p.excerpt = markdownExcerpt(String(p.content), 160);
    delete p.content; // 列表不返回正文，减小体积
  }

  ok({ posts, total });
}

/** 帖子详情 */
export async function apiGetPost(ctx: Ctx, id: number): Promise<void> {
  const post = await ctx.db.one(postSelectSql() + ' WHERE posts.id = ?', [id]);
  if (!post) err('帖子不存在', 404);
  const p = post as Row;
  const user = await currentUser(ctx);
  const uid = user ? Number(user.id) : -1;
  if (p.status === 'hidden' && uid !== Number(p.author_id) && (user?.role ?? '') !== 'admin') {
    err('帖子不存在', 404);
  }
  // 浏览量 +1
  await ctx.db.run('UPDATE posts SET view_count = COALESCE(view_count,0) + 1 WHERE id = ?', [id]);
  p.view_count = Number(p.view_count) + 1;
  p.liked = false;
  if (uid > 0) {
    p.liked = Boolean(Number(await ctx.db.val('SELECT COUNT(*) FROM likes WHERE post_id = ? AND user_id = ?', [id, uid])) || 0);
  }
  ok({ post: p });
}

/** 分类参数转存储值（'' / '0' / null → NULL，与 PHP $categoryId ?: null 一致） */
function categoryValue(categoryId: unknown): number | null {
  if (categoryId === null || categoryId === undefined || categoryId === '' || categoryId === '0' || categoryId === 0) return null;
  return Number(categoryId);
}

/** 发帖 */
export async function apiCreatePost(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const title = ctx.strParam('title', '').trim();
  const content = stripForbiddenFonts(ctx.strParam('content', '').trim());
  const categoryId = ctx.param('category_id', null);

  if (title === '' || content === '') err('标题和内容不能为空');
  if (mbLen(title) > 30) err('标题不能超过 30 个字符');
  const maxPost = await postMaxChars(ctx);
  if (mbLen(content) > maxPost) err('内容不能超过 ' + maxPost + ' 个字符');
  if (hasInvisibleChars(title + content) || hasControlChars(title + content)) err('内容包含非法字符');
  if (categoryId) {
    if (!(await ctx.db.one('SELECT id FROM categories WHERE id = ?', [Number(categoryId)]))) {
      err('分类不存在');
    }
  }

  // 频率限制（后台可配置 JSON：{"count":3,"unit":"minute","window":1}）
  await checkContentRateLimit(ctx, user, 'site_post_rate_limit', 'posts', '发帖过于频繁，请稍后再试');
  const status = await applyKeywordFilter(ctx, title + ' ' + content);

  const { lastRowId } = await ctx.db.run(
    'INSERT INTO posts (author_id, title, content, category_id, status) VALUES (?, ?, ?, ?, ?)',
    [user.id, title, content, categoryValue(categoryId), status],
  );
  await auditLog(ctx, 'CREATE_POST', 'post', String(lastRowId), '标题长度 ' + mbLen(title), Number(user.id));

  ok({ id: lastRowId }, status === 'locked' ? '发布成功，内容含敏感词正在审核' : '发布成功');
}

/** 编辑帖子（作者或管理员） */
export async function apiUpdatePost(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const post = await ctx.db.one('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) err('帖子不存在', 404);
  const p = post as Row;
  if (Number(p.author_id) !== Number(user.id) && user.role !== 'admin') {
    err('无权编辑此帖子', 403);
  }
  const title = ctx.strParam('title', String(p.title)).trim();
  const content = stripForbiddenFonts(ctx.strParam('content', String(p.content)).trim());
  const categoryId = ctx.param('category_id', p.category_id);
  if (title === '' || mbLen(title) > 30) err('标题需在 1～30 个字符之间');
  const maxPost = await postMaxChars(ctx);
  if (mbLen(content) > maxPost) err('内容不能超过 ' + maxPost + ' 个字符');
  await ctx.db.run('UPDATE posts SET title = ?, content = ?, category_id = ? WHERE id = ?', [
    title,
    content,
    categoryValue(categoryId),
    id,
  ]);
  await auditLog(ctx, 'UPDATE_POST', 'post', String(id), null, Number(user.id));
  ok({}, '已保存');
}

/** 删除帖子（作者或管理员） */
export async function apiDeletePost(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const post = await ctx.db.one('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) err('帖子不存在', 404);
  const p = post as Row;
  if (Number(p.author_id) !== Number(user.id) && user.role !== 'admin') {
    err('无权删除此帖子', 403);
  }
  // 清理图片
  for (const c of await ctx.db.all('SELECT content FROM comments WHERE post_id = ?', [id])) {
    for (const url of extractImageUrls(String(c.content))) await deleteImageFile(ctx, url);
  }
  for (const url of extractImageUrls(String(p.content))) await deleteImageFile(ctx, url);
  await ctx.db.run('DELETE FROM comments WHERE post_id = ?', [id]);
  await ctx.db.run('DELETE FROM likes WHERE post_id = ?', [id]);
  await ctx.db.run('DELETE FROM posts WHERE id = ?', [id]);
  await auditLog(ctx, 'DELETE_POST', 'post', String(id), null, Number(user.id));
  ok({}, '已删除');
}

/** 评论列表 */
export async function apiListComments(ctx: Ctx, postId: number): Promise<void> {
  const rows = await ctx.db.all(
    `SELECT comments.*, users.username, users.avatar_url, users.role
		 FROM comments JOIN users ON comments.author_id = users.id
		 WHERE post_id = ? AND comments.status != "hidden"
		 ORDER BY created_at ASC`,
    [postId],
  );
  // 附加楼层序号
  for (const c of rows) {
    c.floor = Number(await ctx.db.val('SELECT COUNT(*) FROM comments WHERE post_id = ? AND id <= ?', [postId, c.id])) || 0;
  }
  ok({ comments: rows });
}

/** 发表评论 */
export async function apiCreateComment(ctx: Ctx, postId: number): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const content = stripForbiddenFonts(ctx.strParam('content', '').trim());
  const parentId = ctx.param('parent_id', null);

  if (content === '') err('评论内容不能为空');
  const maxComment = await commentMaxChars(ctx);
  if (mbLen(content) > maxComment) err('评论不能超过 ' + maxComment + ' 个字符');
  if (hasInvisibleChars(content) || hasControlChars(content)) err('内容包含非法字符');
  const post = await ctx.db.one('SELECT id, status FROM posts WHERE id = ?', [postId]);
  if (!post) err('帖子不存在', 404);
  if ((post as Row).status === 'locked') err('该帖子已锁定，无法评论', 403);
  await checkContentRateLimit(ctx, user, 'site_comment_rate_limit', 'comments', '评论过于频繁，请稍后再试');
  const status = await applyKeywordFilter(ctx, content);

  const parentValue = parentId === null || parentId === '' || parentId === '0' || parentId === 0 ? null : Number(parentId);
  const { lastRowId } = await ctx.db.run(
    'INSERT INTO comments (post_id, parent_id, author_id, content, status) VALUES (?, ?, ?, ?, ?)',
    [postId, parentValue, user.id, content, status],
  );
  await auditLog(ctx, 'CREATE_COMMENT', 'comment', String(lastRowId), null, Number(user.id));

  // 邮件通知帖主（按帖子作者的 email_notifications 开关判断——修复 PHP 版误读帖子字段的问题）
  if (parentValue === null) {
    const owner = await ctx.db.one(
      'SELECT u.email, u.username, u.email_notifications FROM users u JOIN posts p ON p.author_id = u.id WHERE p.id = ?',
      [postId],
    );
    if (owner && Number((owner as Row).email_notifications) === 1 && (owner as Row).email !== user.email) {
      const html = await emailTemplate(ctx, '你的帖子收到了新评论',
        '<p>' + e((owner as Row).username) + '，你的帖子收到了 ' + e(user.username) + ' 的新评论：</p>'
        + '<blockquote style="border-left:3px solid #f472b6;padding-left:12px;color:#555;">' + e(markdownExcerpt(content, 200)) + '</blockquote>'
        + '<p><a href="' + e(ctx.origin + '/post/' + postId) + '" style="color:#f472b6;">查看评论</a></p>');
      await sendEmail(ctx, String((owner as Row).email), '你的帖子收到了新评论', html);
    }
  }
  ok({ id: lastRowId }, status === 'locked' ? '评论包含违禁词，正在审核中' : '评论成功');
}

/** 删除评论（作者或管理员，连同子评论） */
export async function apiDeleteComment(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const comment = await ctx.db.one('SELECT * FROM comments WHERE id = ?', [id]);
  if (!comment) err('评论不存在', 404);
  if (Number((comment as Row).author_id) !== Number(user.id) && user.role !== 'admin') {
    err('无权删除此评论', 403);
  }
  for (const c of await ctx.db.all('SELECT content, author_id FROM comments WHERE id = ? OR parent_id = ?', [id, id])) {
    for (const url of extractImageUrls(String(c.content))) await deleteImageFile(ctx, url);
  }
  await ctx.db.run('DELETE FROM comments WHERE parent_id = ?', [id]);
  await ctx.db.run('DELETE FROM comments WHERE id = ?', [id]);
  await auditLog(ctx, 'DELETE_COMMENT', 'comment', String(id), null, Number(user.id));
  ok({}, '已删除');
}

/** 点赞 / 取消点赞 */
export async function apiToggleLike(ctx: Ctx, postId: number): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const existing = await ctx.db.one('SELECT id FROM likes WHERE post_id = ? AND user_id = ?', [postId, user.id]);
  if (existing) {
    await ctx.db.run('DELETE FROM likes WHERE id = ?', [(existing as Row).id]);
    ok({ liked: false });
  }
  await ctx.db.run('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', [postId, user.id]);
  ok({ liked: true });
}

/** 点赞状态 */
export async function apiLikeStatus(ctx: Ctx, postId: number): Promise<void> {
  const user = await currentUser(ctx);
  if (!user) ok({ liked: false });
  const liked = Boolean(Number(await ctx.db.val('SELECT COUNT(*) FROM likes WHERE post_id = ? AND user_id = ?', [postId, (user as Row).id])) || 0);
  ok({ liked });
}

/** 点赞用户列表 */
export async function apiPostLikers(ctx: Ctx, postId: number): Promise<void> {
  const rows = await ctx.db.all(
    `SELECT users.id, users.username, users.nickname, users.avatar_url
		 FROM likes JOIN users ON likes.user_id = users.id
		 WHERE likes.post_id = ? ORDER BY likes.created_at DESC`,
    [postId],
  );
  ok({ users: rows });
}

/** 分类列表（含每类帖子数） */
export async function apiListCategories(ctx: Ctx): Promise<void> {
  const rows = await ctx.db.all(
    `SELECT categories.*, (SELECT COUNT(*) FROM posts WHERE posts.category_id = categories.id AND posts.status = "normal") as post_count
		 FROM categories ORDER BY id ASC`,
  );
  ok({ categories: rows });
}

/** Markdown 预览渲染：上限跟随正文字数上限，避免写了正文却无法预览 */
export async function apiMarkdownRender(ctx: Ctx): Promise<void> {
  const content = stripForbiddenFonts(ctx.strParam('content', ''));
  if (mbLen(content) > (await postMaxChars(ctx))) err('内容过长');
  ok({ html: renderMarkdown(content) });
}

/** 切换个人主题（保存到 Cookie）；合法主题由注册表统一判定 */
export async function apiSetTheme(ctx: Ctx): Promise<void> {
  const theme = ctx.strParam('theme', 'tool');
  if (!themeIsValid(theme)) err('未知主题');
  ctx.setCookie('cforum_theme', theme, { maxAge: 365 * 86400, httpOnly: false });
  ok({}, '主题已保存');
}
