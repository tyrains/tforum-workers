/**
 * 认证与用户相关 API：对应 PHP 版 lib/api_auth.php，逐函数平移。
 * 响应格式、参数名、状态码、中文文案与 PHP 版完全一致。
 * 差异点（决策记录已定）：验证/改邮箱令牌加 24 小时过期；totp-qr 端点加登录鉴权。
 */
import type { Ctx } from '../lib/ctx';
import {
  auditLog, DEFAULT_SITE_TITLE, e, err, mbLen, ok, publicUser, randomToken, rateLimit, validEmail, validateUsername,
} from '../lib/core';
import {
  currentUser, hashPassword, loginAs, logoutNow, requireCsrf, requireUser,
  totpGenerateSecret, totpUri, totpVerify, verifyPassword,
} from '../lib/auth';
import { deleteImageFile, extractImageUrls, handleImageUpload } from '../lib/content';
import { emailTemplate, sendEmail } from '../lib/mail';
import { currentLocale, locales } from '../lib/i18n';
import type { Row } from '../lib/db';

/** PHP 真值判断（'0'、''、0、false、null 为假） */
function phpTruthy(v: unknown): boolean {
  return !(v === null || v === undefined || v === false || v === 0 || v === '' || v === '0');
}

const TOKEN_24H = 24 * 3600;

/** 当前站点公开配置 */
export async function apiConfig(ctx: Ctx): Promise<void> {
  const user = await currentUser(ctx);
  ok({
    site_title: await ctx.settings.get('site_title', DEFAULT_SITE_TITLE),
    site_description: await ctx.settings.get('site_description', ''),
    site_primary_color: await ctx.settings.get('site_primary_color', '#4f46e5'),
    site_favicon_url: await ctx.settings.get('site_favicon_url', ''),
    site_logo_url: await ctx.settings.get('site_logo_url', ''),
    site_announcement: await ctx.settings.get('site_announcement', ''),
    site_icp: await ctx.settings.get('site_icp', ''),
    site_footer_html: await ctx.settings.get('site_footer_html', ''),
    site_bg_image: await ctx.settings.get('site_bg_image', ''),
    site_bg_opacity: await ctx.settings.get('site_bg_opacity', '1'),
    site_custom_css: await ctx.settings.get('site_custom_css', ''),
    site_custom_js: await ctx.settings.get('site_custom_js', ''),
    site_terms: await ctx.settings.get('site_terms', ''),
    site_privacy: await ctx.settings.get('site_privacy', ''),
    site_theme: await ctx.settings.get('site_theme', 'tool'),
    force_login: await ctx.settings.bool('force_login'),
    turnstile_enabled: await ctx.settings.bool('turnstile_enabled'),
    turnstile_site_key: await ctx.settings.get('turnstile_site_key', ''),
    locale: currentLocale(ctx),
    locales: locales(),
    user: user ? publicUser(user) : null,
  });
}

/** 登录状态检查 */
export async function apiAuthCheck(ctx: Ctx): Promise<void> {
  const user = await currentUser(ctx);
  if (!user) err('未登录', 401);
  ok({ user: publicUser(user as Row), authenticated: true });
}

/** Turnstile 服务端校验（settings 开启时才调用；secret 取 settings.turnstile_secret_key） */
export async function verifyTurnstile(ctx: Ctx): Promise<void> {
  if (!(await ctx.settings.bool('turnstile_enabled'))) return;
  const secret = await ctx.settings.get('turnstile_secret_key', '');
  if (secret === '') return;
  const token = ctx.strParam('cf-turnstile-response', '');
  let passed = false;
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    passed = data.success === true;
  } catch {
    passed = false;
  }
  if (!passed) err('人机验证失败，请重试', 403);
}

/** 登录 */
export async function apiLogin(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  await verifyTurnstile(ctx);
  const account = String(ctx.param('email', ctx.param('username', '')) ?? '').trim();
  const password = ctx.strParam('password', '');
  const totpCode = ctx.strParam('totp_code', '').trim();

  if (account === '' || password === '') err('请输入用户名/邮箱和密码');
  await rateLimit(ctx, 'login', 10, 300);

  // 同时支持邮箱和用户名登录
  const user = await ctx.db.one('SELECT * FROM users WHERE email = ? OR username = ?', [account, account]);
  if (!user) err('账号或密码错误', 401);
  const [valid, isLegacy] = await verifyPassword(password, String((user as Row).password));
  if (!valid) err('账号或密码错误', 401);
  if (isLegacy) {
    await ctx.db.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), (user as Row).id]);
  }
  if (Number((user as Row).verified) !== 1) err('请先验证邮箱后再登录', 403);
  if ((user as Row).status === 'banned') err('账号已被封禁，如有疑问请联系管理员', 403);
  if (Number((user as Row).totp_enabled) === 1) {
    if (totpCode === '') err('TOTP_REQUIRED', 403);
    if (!(await totpVerify(String((user as Row).totp_secret), totpCode))) err('验证码错误', 401);
  }

  await loginAs(ctx, Number((user as Row).id));
  await auditLog(ctx, 'LOGIN', 'user', String((user as Row).id), '邮箱登录', Number((user as Row).id));
  const fresh = await currentUser(ctx);
  ok({ user: publicUser(fresh as Row) }, '登录成功');
}

/** 退出登录 */
export async function apiLogout(ctx: Ctx): Promise<void> {
  const user = await currentUser(ctx);
  await auditLog(ctx, 'LOGOUT', 'user', null, null, user ? Number(user.id) : null);
  await logoutNow(ctx);
  ok({}, '已退出登录');
}

/** 注册 */
export async function apiRegister(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  await verifyTurnstile(ctx);
  const email = ctx.strParam('email', '').trim().toLowerCase();
  const username = ctx.strParam('username', '').trim();
  const password = ctx.strParam('password', '');

  if (!validEmail(email)) err('邮箱格式不正确');
  const usernameError = validateUsername(username);
  if (usernameError) err(usernameError);
  if (mbLen(password) < 8 || mbLen(password) > 16) err('密码长度需为 8～16 位');
  await rateLimit(ctx, 'register', 5, 3600);

  const exists = await ctx.db.one('SELECT email, username FROM users WHERE email = ? OR username = ?', [email, username]);
  if (exists) {
    err((exists as Row).email === email ? '该邮箱已被注册' : '该用户名已被占用', 409);
  }

  const token = randomToken(24);
  const html = await emailTemplate(ctx, '验证你的邮箱',
    '<p>你好，' + e(username) + '！</p>'
    + '<p>请点击下方按钮完成邮箱验证：</p>'
    + '<p style="text-align:center;margin:28px 0;"><a href="' + e(ctx.origin + '/verify?token=' + token)
    + '" style="display:inline-block;padding:12px 28px;background:#f472b6;color:#fff;border-radius:999px;text-decoration:none;font-weight:bold;">验证邮箱</a></p>'
    + '<p style="color:#999;font-size:13px;">如果这不是你操作的，请忽略此邮件。</p>');
  await sendEmail(ctx, email, '请验证您的邮箱', html);

  await ctx.db.run(
    'INSERT INTO users (email, username, password, role, verified, verification_token, verification_token_expires, nickname, avatar_url) VALUES (?, ?, ?, "user", 0, ?, ?, ?, ?)',
    [email, username, await hashPassword(password), token, Math.floor(Date.now() / 1000) + TOKEN_24H, username, ''],
  );
  await auditLog(ctx, 'REGISTER', 'user', email, '新用户注册');
  ok({}, '注册成功，请前往邮箱完成验证');
}

/** 邮箱验证（24 小时内有效；历史导入的无过期时间令牌按未过期处理，兼容旧数据） */
export async function apiVerifyEmail(ctx: Ctx): Promise<void> {
  const token = ctx.strParam('token', '').trim();
  if (token === '') err('缺少验证令牌');
  const user = await ctx.db.one('SELECT id, email, verification_token_expires FROM users WHERE verification_token = ?', [token]);
  if (!user) err('验证链接无效或已过期');
  const expires = (user as Row).verification_token_expires;
  if (expires !== null && expires !== undefined && Number(expires) < Math.floor(Date.now() / 1000)) {
    err('验证链接无效或已过期');
  }
  await ctx.db.run('UPDATE users SET verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?', [(user as Row).id]);
  await auditLog(ctx, 'VERIFY_EMAIL', 'user', String((user as Row).id), '邮箱验证通过', Number((user as Row).id));
  ok({}, '邮箱验证成功，现在可以登录了');
}

/** 忘记密码 */
export async function apiForgotPassword(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const email = ctx.strParam('email', '').trim().toLowerCase();
  if (!validEmail(email)) err('邮箱格式不正确');
  await rateLimit(ctx, 'forgot', 5, 3600);
  const user = await ctx.db.one('SELECT id, email, username FROM users WHERE email = ?', [email]);
  if (!user) {
    // 不暴露邮箱是否存在
    ok({}, '如果该邮箱已注册，重置链接已发送');
  }
  const u = user as Row;
  const token = randomToken(24);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  await ctx.db.run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [token, expires, u.id]);

  const html = await emailTemplate(ctx, '重置密码',
    '<p>你好，' + e(u.username) + '！</p>'
    + '<p>我们收到了重置密码的请求，请点击下方按钮设置新密码（链接 1 小时内有效）：</p>'
    + '<p style="text-align:center;margin:28px 0;"><a href="' + e(ctx.origin + '/reset?token=' + token)
    + '" style="display:inline-block;padding:12px 28px;background:#a78bfa;color:#fff;border-radius:999px;text-decoration:none;font-weight:bold;">重置密码</a></p>'
    + '<p style="color:#999;font-size:13px;">如果这不是你操作的，请忽略此邮件。</p>');
  await sendEmail(ctx, email, '重置密码', html);
  await auditLog(ctx, 'FORGOT_PASSWORD', 'user', String(u.id), '申请重置密码', Number(u.id));
  ok({}, '如果该邮箱已注册，重置链接已发送');
}

/** 重置密码 */
export async function apiResetPassword(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const token = ctx.strParam('token', '');
  const password = ctx.strParam('password', '');
  if (token === '') err('缺少重置令牌');
  if (mbLen(password) < 8 || mbLen(password) > 16) err('密码长度需为 8～16 位');
  const user = await ctx.db.one('SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > ?', [
    token,
    Math.floor(Date.now() / 1000),
  ]);
  if (!user) err('重置链接无效或已过期', 400);
  await ctx.db.run('UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [
    await hashPassword(password),
    (user as Row).id,
  ]);
  await auditLog(ctx, 'RESET_PASSWORD', 'user', String((user as Row).id), '完成密码重置', Number((user as Row).id));
  ok({}, '密码已重置，请重新登录');
}

/** 修改密码（需登录） */
export async function apiChangePassword(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const oldPw = ctx.strParam('old_password', '');
  const newPw = ctx.strParam('new_password', '');
  const [valid] = await verifyPassword(oldPw, String(user.password));
  if (!valid) err('原密码不正确', 401);
  if (mbLen(newPw) < 8 || mbLen(newPw) > 16) err('新密码长度需为 8～16 位');
  await ctx.db.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(newPw), user.id]);
  await auditLog(ctx, 'CHANGE_PASSWORD', 'user', String(user.id), null, Number(user.id));
  ok({}, '密码已修改');
}

/** 申请修改邮箱 */
export async function apiChangeEmail(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const email = ctx.strParam('email', '').trim().toLowerCase();
  if (!validEmail(email)) err('邮箱格式不正确');
  if (await ctx.db.one('SELECT id FROM users WHERE email = ? AND id != ?', [email, user.id])) {
    err('该邮箱已被使用', 409);
  }
  const token = randomToken(24);
  await ctx.db.run('UPDATE users SET pending_email = ?, email_change_token = ?, email_change_token_expires = ? WHERE id = ?', [
    email,
    token,
    Math.floor(Date.now() / 1000) + TOKEN_24H,
    user.id,
  ]);

  const html = await emailTemplate(ctx, '确认修改邮箱',
    '<p>你好，' + e(user.username) + '！</p>'
    + '<p>请点击下方按钮，将账号邮箱改为 <strong>' + e(email) + '</strong>：</p>'
    + '<p style="text-align:center;margin:28px 0;"><a href="' + e(ctx.origin + '/verify-email-change?token=' + token)
    + '" style="display:inline-block;padding:12px 28px;background:#38bdf8;color:#fff;border-radius:999px;text-decoration:none;font-weight:bold;">确认修改</a></p>');
  await sendEmail(ctx, email, '确认修改邮箱', html);
  ok({}, '验证邮件已发送至新邮箱');
}

/** 确认邮箱修改（24 小时内有效，规则同邮箱验证） */
export async function apiVerifyEmailChange(ctx: Ctx): Promise<void> {
  const token = ctx.strParam('token', '').trim();
  const user = await ctx.db.one('SELECT id, pending_email, email_change_token_expires FROM users WHERE email_change_token = ?', [token]);
  if (!user || !(user as Row).pending_email) err('链接无效或已过期');
  const expires = (user as Row).email_change_token_expires;
  if (expires !== null && expires !== undefined && Number(expires) < Math.floor(Date.now() / 1000)) {
    err('链接无效或已过期');
  }
  await ctx.db.run('UPDATE users SET email = ?, pending_email = NULL, email_change_token = NULL, email_change_token_expires = NULL WHERE id = ?', [
    (user as Row).pending_email,
    (user as Row).id,
  ]);
  ok({}, '邮箱修改成功');
}

/** 更新个人资料 */
export async function apiUpdateProfile(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const fields = ['nickname', 'bio', 'age', 'gender', 'birthday', 'avatar_url', 'bg_image', 'email_notifications'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (ctx.param(f, null) !== null) {
      let value: unknown = ctx.param(f);
      if (f === 'email_notifications') {
        value = phpTruthy(value) ? 1 : 0;
      } else if (f === 'age') {
        value = value === '' ? null : Math.trunc(Number(value));
      } else {
        value = String(value).trim();
        if (mbLen(value as string) > 2000) err(f + ' 内容过长');
      }
      sets.push(f + ' = ?');
      vals.push(value);
    }
  }
  if (sets.length) {
    vals.push(user.id);
    await ctx.db.run('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', vals);
    await auditLog(ctx, 'UPDATE_PROFILE', 'user', String(user.id), fields.join(','), Number(user.id));
  }
  const fresh = await ctx.db.one('SELECT * FROM users WHERE id = ?', [user.id]);
  ok({ user: publicUser(fresh as Row) }, '资料已保存');
}

/** 查看他人资料 */
export async function apiGetProfile(ctx: Ctx, id: number): Promise<void> {
  const user = await ctx.db.one('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) err('用户不存在', 404);
  const posts = await ctx.db.all(
    'SELECT id, title, created_at, view_count FROM posts WHERE author_id = ? AND status = "normal" ORDER BY created_at DESC LIMIT 20',
    [id],
  );
  ok({
    user: publicUser(user),
    post_count: Number(await ctx.db.val('SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = "normal"', [id])) || 0,
    comment_count: Number(await ctx.db.val('SELECT COUNT(*) FROM comments WHERE author_id = ?', [id])) || 0,
    recent_posts: posts,
  });
}

/** 上传并设置某个图片字段（头像/背景共用，对应 api_upload_avatar()/api_upload_bg()） */
async function uploadAndSetField(
  ctx: Ctx,
  field: 'avatar_url' | 'bg_image',
  prefix: string,
  message: string,
): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const file = ctx.file('image');
  if (!file) err('请选择图片');
  const result = await handleImageUpload(ctx, file, Number(user.id), prefix);
  if (!result.ok) err(result.error as string);
  if (user[field]) {
    await deleteImageFile(ctx, String(user[field]));
  }
  await ctx.db.run(`UPDATE users SET ${field} = ? WHERE id = ?`, [result.url, user.id]);
  ok({ url: result.url }, message);
}

/** 上传背景图 */
export async function apiUploadBg(ctx: Ctx): Promise<void> {
  await uploadAndSetField(ctx, 'bg_image', 'bg', '背景图已更新');
}

/** 上传头像 */
export async function apiUploadAvatar(ctx: Ctx): Promise<void> {
  await uploadAndSetField(ctx, 'avatar_url', 'avatar', '头像已更新');
}

/** 通用图片上传 */
export async function apiUpload(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const file = ctx.file('image');
  if (!file) err('请选择图片');
  const result = await handleImageUpload(ctx, file, Number(user.id), 'post');
  if (!result.ok) err(result.error as string);
  ok({ url: result.url });
}

/** 注销账号（匿名化 / 完全删除，对应 api_delete_account()） */
export async function apiDeleteAccount(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const mode = ctx.strParam('mode', 'delete'); // delete | anonymize
  const uid = Number(user.id);

  const contentIds = (await ctx.db.all('SELECT id FROM posts WHERE author_id = ?', [uid])).map((r) => Number(r.id));
  for (const pid of contentIds) {
    for (const c of await ctx.db.all('SELECT content FROM comments WHERE post_id = ?', [pid])) {
      for (const url of extractImageUrls(String(c.content))) {
        await deleteImageFile(ctx, url);
      }
    }
  }
  for (const p of await ctx.db.all('SELECT content FROM posts WHERE author_id = ?', [uid])) {
    for (const url of extractImageUrls(String(p.content))) {
      await deleteImageFile(ctx, url);
    }
  }

  try {
    if (mode === 'anonymize') {
      await ctx.db.batch([
        {
          sql: 'UPDATE users SET email = ?, username = ?, nickname = ?, password = ?, status = "banned", avatar_url = "", bio = "" WHERE id = ?',
          params: ['deleted_' + uid + '@example.invalid', '已注销用户' + uid, '已注销用户', await hashPassword(randomToken(16)), uid],
        },
        { sql: 'UPDATE posts SET title = "[已注销]", content = "[该内容已删除]" WHERE author_id = ?', params: [uid] },
        { sql: 'UPDATE comments SET content = "[该评论已删除]" WHERE author_id = ?', params: [uid] },
      ]);
    } else {
      const stmts: { sql: string; params?: unknown[] }[] = [];
      for (const pid of contentIds) {
        stmts.push({ sql: 'DELETE FROM comments WHERE post_id = ?', params: [pid] });
      }
      stmts.push({ sql: 'DELETE FROM likes WHERE user_id = ?', params: [uid] });
      stmts.push({ sql: 'DELETE FROM comments WHERE author_id = ?', params: [uid] });
      stmts.push({ sql: 'DELETE FROM posts WHERE author_id = ?', params: [uid] });
      stmts.push({ sql: 'DELETE FROM users WHERE id = ?', params: [uid] });
      await ctx.db.batch(stmts);
    }
  } catch (ex) {
    err('注销失败：' + (ex as Error).message, 500);
  }
  await auditLog(ctx, 'DELETE_ACCOUNT', 'user', String(uid), mode);
  await logoutNow(ctx);
  ok({}, '账号已注销');
}

/** TOTP 开启：生成密钥和二维码链接 */
export async function apiTotpSetup(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  if (Number(user.totp_enabled) === 1) {
    err('双因素认证已开启，请先关闭后再重新设置', 409);
  }
  const secret = totpGenerateSecret();
  await ctx.db.run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, user.id]);
  const uri = totpUri(secret, String(user.email), await ctx.settings.get('site_title', 'TForum'));
  ok({ secret, uri, qr: '/api/totp-qr?secret=' + encodeURIComponent(secret) });
}

/** TOTP 验证开启 */
export async function apiTotpVerify(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  const code = ctx.strParam('code', '');
  if (!user.totp_secret) err('请先获取密钥');
  if (!(await totpVerify(String(user.totp_secret), code))) err('验证码错误', 401);
  await ctx.db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', [user.id]);
  await auditLog(ctx, 'ENABLE_TOTP', 'user', String(user.id), null, Number(user.id));
  ok({}, '双因素认证已开启');
}

/** 关闭 TOTP */
export async function apiTotpDisable(ctx: Ctx): Promise<void> {
  await requireCsrf(ctx);
  const user = await requireUser(ctx);
  await ctx.db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [user.id]);
  ok({}, '双因素认证已关闭');
}

/** 用户列表（供 @提及等使用） */
export async function apiUsers(ctx: Ctx): Promise<void> {
  await requireUser(ctx);
  const limit = Math.min(ctx.intParam('limit', 50), 100);
  const rows = await ctx.db.all(
    'SELECT id, username, nickname, avatar_url, status FROM users WHERE status = "normal" ORDER BY id LIMIT ' + limit,
  );
  ok({
    users: rows.map((u) => publicUser({ ...u, email: '', role: 'user', status: 'normal', verified: 1, created_at: '' })),
  });
}

/** 我点赞的帖子 */
export async function apiMyLikes(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const limit = Math.min(ctx.intParam('limit', 20), 100);
  const offset = Math.max(ctx.intParam('offset', 0), 0);
  const rows = await ctx.db.all(
    `SELECT posts.*, users.username as author_name, categories.name as category_name,
			(SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
			(SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
		 FROM likes
		 JOIN posts ON likes.post_id = posts.id
		 JOIN users ON posts.author_id = users.id
		 LEFT JOIN categories ON posts.category_id = categories.id
		 WHERE likes.user_id = ? AND posts.status = "normal"
		 ORDER BY likes.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [user.id],
  );
  ok({ posts: rows });
}

/** TOTP 二维码：返回 otpauth 链接的图片化展示（含可复制密钥）。新版要求登录后才可访问（报告已定修复项）。 */
export async function apiTotpQr(ctx: Ctx): Promise<Response> {
  const user = await currentUser(ctx);
  if (!user) err('请先登录', 401);
  const secret = ctx.strParam('secret', '');
  const safe = e(secret);
  const uri = e(totpUri(secret, 'user', await ctx.settings.get('site_title', 'TForum')));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="210" viewBox="0 0 420 210">'
    + '<rect width="420" height="210" rx="16" fill="#fdf2f8"/>'
    + '<text x="210" y="42" font-size="16" text-anchor="middle" fill="#9d174d" font-family="sans-serif">请在验证器 App 中手动添加</text>'
    + '<text x="210" y="76" font-size="13" text-anchor="middle" fill="#555" font-family="sans-serif">密钥（Base32）：</text>'
    + '<text x="210" y="110" font-size="20" text-anchor="middle" fill="#111" font-family="monospace" letter-spacing="2">' + safe + '</text>'
    + '<text x="210" y="148" font-size="12" text-anchor="middle" fill="#666" font-family="sans-serif">下方为 otpauth 链接，可复制到验证器：</text>'
    + '<foreignObject x="20" y="160" width="380" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="font:11px monospace;word-break:break-all;color:#555;">' + uri + '</div></foreignObject>'
    + '</svg>';
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** SVG 默认头像（按用户 ID 生成稳定的渐变色） */
export async function apiAvatar(ctx: Ctx): Promise<Response> {
  const id = ctx.intParam('id', 0);
  const colors: [string, string][] = [['#f472b6', '#a78bfa'], ['#38bdf8', '#6366f1'], ['#fb923c', '#f43f5e'], ['#34d399', '#38bdf8']];
  const [c1, c2] = colors[Math.abs(id) % colors.length];
  const letter = String(ctx.param('id', '') ?? '').slice(0, 1).toUpperCase();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0%" stop-color="' + c1 + '"/><stop offset="100%" stop-color="' + c2 + '"/>'
    + '</linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#g)"/>'
    + '<text x="50" y="64" font-size="44" font-family="sans-serif" fill="#fff" text-anchor="middle">' + letter + '</text></svg>';
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
