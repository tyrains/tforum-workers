/**
 * 管理后台 API：对应 PHP 版 lib/api_admin.php，逐函数平移。
 * 差异点（报告已定修复项）：GET 设置时密钥类键（resend_key、turnstile_secret_key）不回明文，
 * 只回掩码占位 ********；保存时提交掩码值表示「不修改」，提交空串表示清空。
 */
import type { Ctx } from '../lib/ctx';
import { auditLog, DEFAULT_SITE_TITLE, e, err, mbLen, ok, randomToken, validEmail } from '../lib/core';
import { strictIntValue } from '../lib/db';
import { t } from '../lib/i18n';
import { themeIsValid } from '../lib/theme-registry';
import { requireAdmin, requireCsrf } from '../lib/auth';
import { deleteImageFile, extractImageUrls, findOrphanImages, markdownExcerpt, postSelectSql, stripForbiddenFonts } from '../lib/content';
import { emailTemplate, sendEmail } from '../lib/mail';
import type { Row } from '../lib/db';

/** 密钥掩码占位（GET 返回、POST 识别） */
export const SECRET_MASK = '********';
const SECRET_KEYS = ['resend_key', 'turnstile_secret_key'];

/** 站点设置（GET）：密钥只回掩码 */
export async function apiAdminGetSettings(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const settings = await ctx.settings.allMap();
  for (const key of SECRET_KEYS) {
    if (settings[key]) settings[key] = SECRET_MASK;
  }
  ok({ settings });
}

/** 保存站点设置 */
export async function apiAdminSaveSettings(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const body = ctx.body;
  const allowed = [
    'site_title', 'site_description', 'site_primary_color', 'site_favicon_url', 'site_logo_url',
    'site_announcement', 'site_icp', 'site_footer_html', 'site_copyright', 'site_bg_image', 'site_bg_opacity',
    'site_custom_css', 'site_custom_js', 'site_terms', 'site_privacy', 'site_theme',
    'site_allowed_regions', 'site_blocked_regions', 'site_post_rate_limit', 'site_comment_rate_limit',
    'posts_per_page', 'post_max_length', 'comment_max_length',
    'site_keyword_filter', 'force_login', 'turnstile_enabled', 'turnstile_site_key', 'turnstile_secret_key',
    'notify_on_user_delete', 'notify_on_username_change', 'notify_on_avatar_change',
    'notify_on_manual_verify', 'notify_on_role_change', 'resend_key', 'resend_from', 'resend_from_name',
  ];
  // 数值型设置：[最小, 最大, 非法时回落默认值]（键名沿用本站既有命名，对应 PHP v2 的同名语义项）。
  // 防止 0/负数导致分页除零、避免异常超大值；字符串必须是纯十进制整数，否则回落默认值。
  const intSettings: Record<string, [number, number, number]> = {
    posts_per_page: [1, 100, 10],
    post_max_length: [1, 1000000, 20000],
    comment_max_length: [1, 1000000, 500],
  };
  const saved: string[] = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const raw = body[key];
      // 密钥提交掩码 = 不修改（保持原值，不计入本次保存列表）
      if (SECRET_KEYS.includes(key) && raw === SECRET_MASK) continue;
      let value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : typeof raw === 'boolean' ? (raw ? '1' : '') : '';
      // 字体安全：自定义 CSS / JS、公告、页脚 HTML 一律剥离装饰字体注入
      if (key === 'site_custom_css' || key === 'site_custom_js') {
        value = stripForbiddenFonts(value, true);
      } else if (key === 'site_announcement' || key === 'site_footer_html' || key === 'site_copyright') {
        value = stripForbiddenFonts(value);
      } else if (key === 'site_theme' && !themeIsValid(value)) {
        // 只允许注册表里已实装的主题，非法值一律回落到默认工具风
        value = 'tool';
      } else if (key === 'site_title') {
        // 站点名称：去首尾空白（含全角空格）与换行；空值回退默认；上限 20 字符
        value = value.replace(/^[\s\u3000]+|[\s\u3000]+$/gu, '');
        if (value === '') {
          value = DEFAULT_SITE_TITLE;
        } else if (mbLen(value) > 20) {
          err(t(ctx, 'siteNameTooLong', {}, '站点名称不能超过 20 个字符'));
        }
      } else if (key in intSettings) {
        const [min, max, def] = intSettings[key];
        value = String(strictIntValue(value, def, min, max));
      }
      await ctx.settings.set(key, value);
      saved.push(key);
    }
  }
  await auditLog(ctx, 'UPDATE_SETTINGS', 'settings', null, saved.join(','), Number(admin.id));
  ok({}, '设置已保存');
}

/** 管理后台统计 */
export async function apiAdminStats(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  ok({
    users: Number(await ctx.db.val('SELECT COUNT(*) FROM users')) || 0,
    posts: Number(await ctx.db.val('SELECT COUNT(*) FROM posts')) || 0,
    comments: Number(await ctx.db.val('SELECT COUNT(*) FROM comments')) || 0,
    likes: Number(await ctx.db.val('SELECT COUNT(*) FROM likes')) || 0,
    pending_users: Number(await ctx.db.val('SELECT COUNT(*) FROM users WHERE verified = 0')) || 0,
    hidden_posts: Number(await ctx.db.val('SELECT COUNT(*) FROM posts WHERE status = "hidden"')) || 0,
    recent_posts: await ctx.db.all(postSelectSql() + ' ORDER BY posts.created_at DESC LIMIT 5'),
  });
}

/** 新增分类 */
export async function apiAdminAddCategory(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  await requireAdmin(ctx);
  const name = ctx.strParam('name', '').trim();
  if (name === '' || mbLen(name) > 30) err('分类名称需在 1～30 个字符之间');
  if (await ctx.db.one('SELECT id FROM categories WHERE name = ?', [name])) err('分类已存在', 409);
  const { lastRowId } = await ctx.db.run('INSERT INTO categories (name) VALUES (?)', [name]);
  ok({ id: lastRowId }, '已添加');
}

/** 修改分类 */
export async function apiAdminUpdateCategory(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  await requireAdmin(ctx);
  const name = ctx.strParam('name', '').trim();
  if (name === '' || mbLen(name) > 30) err('分类名称需在 1～30 个字符之间');
  if (await ctx.db.one('SELECT id FROM categories WHERE name = ? AND id != ?', [name, id])) err('分类已存在', 409);
  await ctx.db.run('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
  ok({}, '已保存');
}

/** 删除分类（帖子移为未分类） */
export async function apiAdminDeleteCategory(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  await requireAdmin(ctx);
  await ctx.db.run('UPDATE posts SET category_id = NULL WHERE category_id = ?', [id]);
  await ctx.db.run('DELETE FROM categories WHERE id = ?', [id]);
  ok({}, '已删除');
}

/** 用户列表 */
export async function apiAdminListUsers(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const limit = Math.min(Math.max(ctx.intParam('limit', 20), 1), 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const q = ctx.strParam('q', '').trim();
  let where = '';
  const params: unknown[] = [];
  if (q !== '') {
    where = ' WHERE username LIKE ? OR email LIKE ? OR nickname LIKE ?';
    const like = '%' + q + '%';
    params.push(like, like, like);
  }
  const users = await ctx.db.all(
    'SELECT id, email, username, nickname, role, status, verified, avatar_url, created_at FROM users'
    + where + ' ORDER BY id DESC LIMIT ' + limit + ' OFFSET ' + offset,
    params,
  );
  for (const u of users) {
    u.post_count = Number(await ctx.db.val('SELECT COUNT(*) FROM posts WHERE author_id = ?', [u.id])) || 0;
    u.comment_count = Number(await ctx.db.val('SELECT COUNT(*) FROM comments WHERE author_id = ?', [u.id])) || 0;
    u.verified = Number(u.verified) === 1;
  }
  ok({
    users,
    total: Number(await ctx.db.val('SELECT COUNT(*) FROM users' + where, params)) || 0,
  });
}

/** 管理员修改用户资料 */
export async function apiAdminUpdateUser(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const user = await ctx.db.one('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) err('用户不存在', 404);
  const fields = ['username', 'nickname', 'email', 'bio', 'age', 'gender', 'birthday', 'status', 'verified'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (ctx.param(f, null) !== null) {
      let value: unknown = ctx.param(f);
      if (f === 'verified' || f === 'age') {
        value = value === '' ? null : Math.trunc(Number(value)) || 0;
      } else {
        value = String(value).trim();
      }
      sets.push(f + ' = ?');
      vals.push(value);
    }
  }
  if (sets.length) {
    vals.push(id);
    await ctx.db.run('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  }
  await auditLog(ctx, 'ADMIN_UPDATE_USER', 'user', String(id), sets.join(','), Number(admin.id));
  ok({}, '已保存');
}

/** 设置用户角色 */
export async function apiAdminSetRole(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const role = ctx.param('role', '') === 'admin' ? 'admin' : 'user';
  if (Number(admin.id) === id && role !== 'admin') {
    err('不能取消自己的管理员权限');
  }
  await ctx.db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  await auditLog(ctx, 'SET_ROLE', 'user', String(id), role, Number(admin.id));
  ok({}, '角色已更新');
}

/** 手动验证用户 */
export async function apiAdminVerifyUser(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  await ctx.db.run('UPDATE users SET verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?', [id]);
  await auditLog(ctx, 'MANUAL_VERIFY', 'user', String(id), null, Number(admin.id));
  ok({}, '已验证');
}

/** 重发验证邮件 */
export async function apiAdminResendVerify(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const user = await ctx.db.one('SELECT id, email, username FROM users WHERE id = ?', [id]);
  if (!user) err('用户不存在', 404);
  const u = user as Row;
  const token = randomToken(24);
  await ctx.db.run('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?', [
    token,
    Math.floor(Date.now() / 1000) + 24 * 3600,
    id,
  ]);
  const html = await emailTemplate(ctx, '验证你的邮箱',
    '<p>你好，' + e(u.username) + '！</p><p>管理员已为你重新发送验证邮件：</p>'
    + '<p style="text-align:center;margin:28px 0;"><a href="' + e(ctx.origin + '/verify?token=' + token)
    + '" style="display:inline-block;padding:12px 28px;background:#f472b6;color:#fff;border-radius:999px;text-decoration:none;">验证邮箱</a></p>');
  await sendEmail(ctx, String(u.email), '请验证您的邮箱', html);
  await auditLog(ctx, 'RESEND_VERIFY', 'user', String(id), null, Number(admin.id));
  ok({}, '验证邮件已发送');
}

/** 封禁/解封用户 */
export async function apiAdminUserAction(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const action = ctx.strParam('action', '');
  if (action === 'ban') {
    await ctx.db.run('UPDATE users SET status = "banned" WHERE id = ?', [id]);
  } else if (action === 'unban') {
    await ctx.db.run('UPDATE users SET status = "normal" WHERE id = ?', [id]);
  } else {
    err('未知操作');
  }
  await auditLog(ctx, 'USER_ACTION', 'user', String(id), action, Number(admin.id));
  ok({}, '操作成功');
}

/** 删除用户 */
export async function apiAdminDeleteUser(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  if (id === Number(admin.id)) err('不能删除自己');
  const user = await ctx.db.one('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) err('用户不存在', 404);
  await ctx.db.run('DELETE FROM likes WHERE user_id = ?', [id]);
  await ctx.db.run('DELETE FROM comments WHERE author_id = ?', [id]);
  await ctx.db.run('DELETE FROM posts WHERE author_id = ?', [id]);
  await ctx.db.run('DELETE FROM users WHERE id = ?', [id]);
  await auditLog(ctx, 'DELETE_USER', 'user', String(id), null, Number(admin.id));
  ok({}, '已删除');
}

/** 管理端帖子列表（含隐藏/锁定） */
export async function apiAdminListPosts(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const limit = Math.min(Math.max(ctx.intParam('limit', 20), 1), 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const q = ctx.strParam('q', '').trim();
  let where = '';
  const params: unknown[] = [];
  if (q !== '') {
    where = ' WHERE posts.title LIKE ? OR posts.content LIKE ?';
    const like = '%' + q + '%';
    params.push(like, like);
  }
  const posts = await ctx.db.all(postSelectSql() + where + ' ORDER BY posts.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, params);
  for (const p of posts) {
    p.excerpt = markdownExcerpt(String(p.content), 100);
    delete p.content;
  }
  ok({
    posts,
    total: Number(await ctx.db.val('SELECT COUNT(*) FROM posts' + where, params)) || 0,
  });
}

/** 帖子操作：hidden / visible / locked / unlocked / normal */
export async function apiAdminPostAction(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const action = ctx.strParam('action', '');
  const map: Record<string, string> = {
    hidden: 'hidden', hide: 'hidden',
    visible: 'normal', show: 'normal', normal: 'normal',
    locked: 'locked', lock: 'locked',
    unlocked: 'normal', unlock: 'normal',
  };
  if (!(action in map)) err('未知操作');
  await ctx.db.run('UPDATE posts SET status = ? WHERE id = ?', [map[action], id]);
  await auditLog(ctx, 'POST_ACTION', 'post', String(id), action, Number(admin.id));
  ok({}, '操作成功');
}

/** 置顶 / 取消置顶 */
export async function apiAdminPinPost(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const raw = ctx.param('pinned', 0);
  const pinned = raw === true || raw === 1 || raw === '1' ? 1 : 0;
  await ctx.db.run('UPDATE posts SET is_pinned = ? WHERE id = ?', [pinned, id]);
  await auditLog(ctx, 'PIN_POST', 'post', String(id), String(pinned), Number(admin.id));
  ok({}, pinned ? '已置顶' : '已取消置顶');
}

/** 移动帖子分类 */
export async function apiAdminMovePost(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const categoryId = ctx.param('category_id', null);
  if (categoryId) {
    if (!(await ctx.db.one('SELECT id FROM categories WHERE id = ?', [Number(categoryId)]))) {
      err('分类不存在');
    }
  }
  const value = categoryId === null || categoryId === '' || categoryId === '0' || categoryId === 0 ? null : Number(categoryId);
  await ctx.db.run('UPDATE posts SET category_id = ? WHERE id = ?', [value, id]);
  await auditLog(ctx, 'MOVE_POST', 'post', String(id), categoryId === null || categoryId === undefined ? '' : String(categoryId), Number(admin.id));
  ok({}, '已移动');
}

/** 管理员删除帖子 */
export async function apiAdminDeletePost(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  for (const c of await ctx.db.all('SELECT content FROM comments WHERE post_id = ?', [id])) {
    for (const url of extractImageUrls(String(c.content))) await deleteImageFile(ctx, url);
  }
  const post = await ctx.db.one('SELECT content FROM posts WHERE id = ?', [id]);
  if (post) {
    for (const url of extractImageUrls(String((post as Row).content))) await deleteImageFile(ctx, url);
  }
  await ctx.db.run('DELETE FROM comments WHERE post_id = ?', [id]);
  await ctx.db.run('DELETE FROM likes WHERE post_id = ?', [id]);
  await ctx.db.run('DELETE FROM posts WHERE id = ?', [id]);
  await auditLog(ctx, 'ADMIN_DELETE_POST', 'post', String(id), null, Number(admin.id));
  ok({}, '已删除');
}

/** 管理端评论列表 */
export async function apiAdminListComments(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const limit = Math.min(Math.max(ctx.intParam('limit', 20), 1), 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const q = ctx.strParam('q', '').trim();
  let where = '';
  const params: unknown[] = [];
  if (q !== '') {
    where = ' WHERE comments.content LIKE ?';
    params.push('%' + q + '%');
  }
  const rows = await ctx.db.all(
    `SELECT comments.*, users.username, posts.title as post_title
		 FROM comments JOIN users ON comments.author_id = users.id JOIN posts ON comments.post_id = posts.id`
    + where + ' ORDER BY comments.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset,
    params,
  );
  ok({
    comments: rows,
    total: Number(await ctx.db.val('SELECT COUNT(*) FROM comments' + where, params)) || 0,
  });
}

/** 评论操作 */
export async function apiAdminCommentAction(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const action = ctx.strParam('action', '');
  const status = action === 'hide' || action === 'hidden' ? 'hidden' : 'normal';
  await ctx.db.run('UPDATE comments SET status = ? WHERE id = ?', [status, id]);
  await auditLog(ctx, 'COMMENT_ACTION', 'comment', String(id), action, Number(admin.id));
  ok({}, '操作成功');
}

/** 管理员删除评论 */
export async function apiAdminDeleteComment(ctx: Ctx, id: number): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  await ctx.db.run('DELETE FROM comments WHERE parent_id = ?', [id]);
  await ctx.db.run('DELETE FROM comments WHERE id = ?', [id]);
  await auditLog(ctx, 'ADMIN_DELETE_COMMENT', 'comment', String(id), null, Number(admin.id));
  ok({}, '已删除');
}

/** 分析孤立图片 */
export async function apiAdminCleanupAnalyze(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const orphans = await findOrphanImages(ctx);
  ok({ orphans, count: orphans.length });
}

/** 执行清理 */
export async function apiAdminCleanupExecute(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const orphans = await findOrphanImages(ctx);
  let deleted = 0;
  for (const url of orphans) {
    if (await deleteImageFile(ctx, url)) deleted++;
  }
  await auditLog(ctx, 'CLEANUP_FILES', 'file', null, '删除 ' + deleted + ' 个文件', Number(admin.id));
  ok({ deleted }, `已清理 ${deleted} 个文件`);
}

/** 测试邮件发送 */
export async function apiTestEmail(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const admin = await requireAdmin(ctx);
  const to = ctx.strParam('email', String(admin.email)).trim();
  if (!validEmail(to)) err('邮箱格式不正确');
  const html = await emailTemplate(ctx, '测试邮件',
    '<p>这是一封来自 ' + e(await ctx.settings.get('site_title', 'TForum')) + ' 的测试邮件。</p><p>如果你收到了它，说明邮件配置正确。</p>');
  const result = await sendEmail(ctx, to, '论坛测试邮件', html);
  ok({ sent: result.sent, log: result.log }, result.sent ? '邮件已发送（或已写入日志）' : '邮件发送失败');
}

/** 管理端分类列表 */
export async function apiAdminListCategories(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  const rows = await ctx.db.all(
    `SELECT categories.*, (SELECT COUNT(*) FROM posts WHERE posts.category_id = categories.id) as post_count FROM categories ORDER BY id ASC`,
  );
  ok({ categories: rows });
}
