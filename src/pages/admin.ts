/** 管理后台页（对应 pages/admin.php：概览/用户/帖子/评论/分类/站点设置/文件清理/审计日志） */
import type { Ctx } from '../lib/ctx';
import { DEFAULT_SITE_COPYRIGHT, DEFAULT_SITE_TITLE, e, mbSubstr, timeAgo } from '../lib/core';
import { pageRequireAdmin } from '../lib/auth';
import { t } from '../lib/i18n';
import { themeDisplayName, themeEnabledIds, themeIsValid, themeMeta } from '../lib/theme-registry';
import { markdownExcerpt, postSelectSql } from '../lib/content';
import { showFlash } from '../lib/layout';
import type { Row } from '../lib/db';

export async function renderAdmin(ctx: Ctx): Promise<string> {
  await pageRequireAdmin(ctx);

  const stats = {
    users: Number(await ctx.db.val('SELECT COUNT(*) FROM users')) || 0,
    posts: Number(await ctx.db.val('SELECT COUNT(*) FROM posts')) || 0,
    comments: Number(await ctx.db.val('SELECT COUNT(*) FROM comments')) || 0,
    likes: Number(await ctx.db.val('SELECT COUNT(*) FROM likes')) || 0,
    pending: Number(await ctx.db.val('SELECT COUNT(*) FROM users WHERE verified = 0')) || 0,
    hidden: Number(await ctx.db.val('SELECT COUNT(*) FROM posts WHERE status = "hidden"')) || 0,
  };
  const categories = await ctx.db.all('SELECT * FROM categories ORDER BY CASE name WHEN "技术" THEN 0 WHEN "灌水" THEN 1 WHEN "其他" THEN 2 ELSE 3 END, id') as Row[];
  const users = await ctx.db.all('SELECT id, email, username, nickname, role, status, verified, avatar_url, created_at FROM users ORDER BY id DESC LIMIT 50') as Row[];
  const posts = await ctx.db.all(postSelectSql() + ' ORDER BY posts.created_at DESC LIMIT 50') as Row[];
  const comments = await ctx.db.all(
    `SELECT comments.*, users.username, posts.title as post_title FROM comments
	 JOIN users ON comments.author_id = users.id JOIN posts ON comments.post_id = posts.id
	 ORDER BY comments.created_at DESC LIMIT 50`,
  ) as Row[];
  const settings = await ctx.settings.allMap();
  const logs = await ctx.db.all('SELECT audit_logs.*, users.username FROM audit_logs LEFT JOIN users ON audit_logs.user_id = users.id ORDER BY audit_logs.id DESC LIMIT 50') as Row[];
  const sv = (k: string): string => settings[k] ?? '';

  let h = showFlash(ctx) + '\n\n';
  h += `<div class="page-heading"><h1>🛡️ ${e(t(ctx, 'adminPanel', {}, '管理后台'))}</h1><div class="sub">站点管理与数据概览</div></div>\n\n`;
  h += '<div class="admin-layout">\n\t<nav class="admin-sidebar card">\n';
  h += '\t\t<button class="active" data-tab="dashboard" data-tab-group="admin">📊 概览</button>\n';
  h += `\t\t<button data-tab="users" data-tab-group="admin">👥 用户管理 ${stats.pending ? `<span class="badge primary">${stats.pending}</span>` : ''}</button>\n`;
  h += '\t\t<button data-tab="posts" data-tab-group="admin">📝 帖子管理</button>\n';
  h += '\t\t<button data-tab="comments" data-tab-group="admin">💬 评论管理</button>\n';
  h += '\t\t<button data-tab="categories" data-tab-group="admin">🏷️ 分类管理</button>\n';
  h += '\t\t<h3>系统</h3>\n';
  h += '\t\t<button data-tab="site" data-tab-group="admin">⚙️ 站点设置</button>\n';
  h += '\t\t<button data-tab="cleanup" data-tab-group="admin">🧹 文件清理</button>\n';
  h += '\t\t<button data-tab="logs" data-tab-group="admin">📜 审计日志</button>\n\t</nav>\n\n';
  h += '\t<div class="admin-main">\n';
  // 概览
  h += '\t\t<section class="admin-panel card active" data-panel-group="admin" id="panel-dashboard">\n\t\t\t<div class="stat-grid">\n';
  const statCards: Array<[string, number, string]> = [
    ['👥', stats.users, '注册用户'], ['📝', stats.posts, '帖子总数'], ['💬', stats.comments, '评论总数'],
    ['❤️', stats.likes, '点赞总数'], ['⏳', stats.pending, '待验证用户'], ['🙈', stats.hidden, '隐藏帖子'],
  ];
  for (const [icon, num, label] of statCards) {
    h += `\t\t\t\t<div class="stat-card card"><div class="stat-icon">${icon}</div><div><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div></div>\n`;
  }
  h += '\t\t\t</div>\n\t\t\t<h3 style="font-size:15px;margin:24px 0 12px">最近帖子</h3>\n';
  h += '\t\t\t<div class="table-scroll"><table class="data-table">\n\t\t\t\t<thead><tr><th>ID</th><th>标题</th><th>作者</th><th>状态</th><th>时间</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const p of posts.slice(0, 8)) {
    h += `\t\t\t\t<tr><td>#${Number(p.id)}</td><td><a href="/post/${Number(p.id)}">${e(mbSubstr(String(p.title), 0, 30))}</a></td><td>${e(p.author_name)}</td><td><span class="badge">${e(p.status)}</span></td><td>${e(timeAgo(String(p.created_at)))}</td></tr>\n`;
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table></div>\n\t\t</section>\n\n';
  // 用户管理
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-users">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">👥 用户管理</h3>\n';
  h += '\t\t\t<div class="table-scroll"><table class="data-table">\n\t\t\t\t<thead><tr><th>ID</th><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const u of users) {
    h += '\t\t\t\t<tr>\n';
    h += `\t\t\t\t\t<td>#${Number(u.id)}</td>\n`;
    h += `\t\t\t\t\t<td><a href="/profile?id=${Number(u.id)}">${e(u.nickname ? u.nickname : u.username)}</a></td>\n`;
    h += `\t\t\t\t\t<td style="font-size:12px">${e(u.email)}</td>\n`;
    h += `\t\t\t\t\t<td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${e(u.role)}</span></td>\n`;
    h += '\t\t\t\t\t<td>';
    if (Number(u.verified) !== 1) h += '<span class="badge locked">未验证</span>';
    else if (u.status === 'banned') h += '<span class="badge locked">已封禁</span>';
    else h += '<span class="badge primary">正常</span>';
    h += '</td>\n\t\t\t\t\t<td><div class="row-actions">\n';
    if (Number(u.verified) !== 1) {
      h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/users/${Number(u.id)}/verify">通过验证</button>\n`;
    }
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/users/${Number(u.id)}/role" data-payload='{"role":"${u.role === 'admin' ? 'user' : 'admin'}"}' data-ask="确定切换角色？">${u.role === 'admin' ? '降为用户' : '设为管理员'}</button>\n`;
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/users/${Number(u.id)}/action" data-payload='{"action":"${u.status === 'banned' ? 'unban' : 'ban'}"}'>${u.status === 'banned' ? '解封' : '封禁'}</button>\n`;
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-danger" data-confirm="确定删除该用户及其所有内容？" data-delete="admin/users/${Number(u.id)}">删除</button>\n`;
    h += '\t\t\t\t\t</div></td>\n\t\t\t\t</tr>\n';
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table></div>\n\t\t</section>\n\n';
  // 帖子管理
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-posts">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">📝 帖子管理</h3>\n';
  h += '\t\t\t<div class="table-scroll"><table class="data-table">\n\t\t\t\t<thead><tr><th>ID</th><th>标题</th><th>作者</th><th>状态</th><th>置顶</th><th>操作</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const p of posts) {
    h += '\t\t\t\t<tr>\n';
    h += `\t\t\t\t\t<td>#${Number(p.id)}</td>\n`;
    h += `\t\t\t\t\t<td><a href="/post/${Number(p.id)}">${e(mbSubstr(String(p.title), 0, 32))}</a></td>\n`;
    h += `\t\t\t\t\t<td>${e(p.author_name)}</td>\n`;
    h += `\t\t\t\t\t<td><span class="badge ${p.status !== 'normal' ? 'locked' : 'primary'}">${e(p.status)}</span></td>\n`;
    h += `\t\t\t\t\t<td>${Number(p.is_pinned) === 1 ? '📌' : '—'}</td>\n`;
    h += '\t\t\t\t\t<td><div class="row-actions">\n';
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/posts/${Number(p.id)}/pin" data-payload='{"pinned":${Number(p.is_pinned) === 1 ? 0 : 1}}'>${Number(p.is_pinned) === 1 ? '取消置顶' : '置顶'}</button>\n`;
    if (p.status === 'normal') {
      h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/posts/${Number(p.id)}/action" data-payload='{"action":"hidden"}'>隐藏</button>\n`;
      h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/posts/${Number(p.id)}/action" data-payload='{"action":"locked"}'>锁定</button>\n`;
    } else {
      h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/posts/${Number(p.id)}/action" data-payload='{"action":"normal"}'>恢复</button>\n`;
    }
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-danger" data-confirm="删除帖子及全部评论？" data-delete="admin/posts/${Number(p.id)}">删除</button>\n`;
    h += '\t\t\t\t\t</div></td>\n\t\t\t\t</tr>\n';
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table></div>\n\t\t</section>\n\n';
  // 评论管理
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-comments">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">💬 评论管理</h3>\n';
  h += '\t\t\t<div class="table-scroll"><table class="data-table">\n\t\t\t\t<thead><tr><th>ID</th><th>评论内容</th><th>作者</th><th>帖子</th><th>状态</th><th>操作</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const c of comments) {
    h += '\t\t\t\t<tr>\n';
    h += `\t\t\t\t\t<td>#${Number(c.id)}</td>\n`;
    h += `\t\t\t\t\t<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(markdownExcerpt(String(c.content), 50))}</td>\n`;
    h += `\t\t\t\t\t<td>${e(c.username)}</td>\n`;
    h += `\t\t\t\t\t<td>${e(mbSubstr(String(c.post_title), 0, 20))}</td>\n`;
    h += `\t\t\t\t\t<td><span class="badge ${c.status !== 'normal' ? 'locked' : 'primary'}">${e(c.status)}</span></td>\n`;
    h += '\t\t\t\t\t<td><div class="row-actions">\n';
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-admin-action="admin/comments/${Number(c.id)}/action" data-payload='{"action":"${c.status === 'hidden' ? 'show' : 'hide'}"}'>${c.status === 'hidden' ? '显示' : '隐藏'}</button>\n`;
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-danger" data-confirm="删除评论？" data-delete="admin/comments/${Number(c.id)}">删除</button>\n`;
    h += '\t\t\t\t\t</div></td>\n\t\t\t\t</tr>\n';
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table></div>\n\t\t</section>\n\n';
  // 分类管理
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-categories">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">🏷️ 分类管理</h3>\n';
  h += '\t\t\t<form id="add-category-form" class="field" style="flex-direction:row;gap:8px;max-width:400px">\n\t\t\t\t<input class="input" name="name" placeholder="新分类名称" required maxlength="30">\n\t\t\t\t<button class="btn btn-primary" type="submit">添加</button>\n\t\t\t</form>\n';
  h += '\t\t\t<table class="data-table" style="margin-top:18px">\n\t\t\t\t<thead><tr><th>ID</th><th>分类名</th><th>操作</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const cat of categories) {
    h += '\t\t\t\t<tr>\n';
    h += `\t\t\t\t\t<td>#${Number(cat.id)}</td>\n`;
    h += `\t\t\t\t\t<td><input class="input" value="${e(cat.name)}" data-cat-name="${Number(cat.id)}" style="max-width:200px"></td>\n`;
    h += '\t\t\t\t\t<td><div class="row-actions">\n';
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-outline" data-cat-save="${Number(cat.id)}">保存</button>\n`;
    h += `\t\t\t\t\t\t<button class="btn btn-sm btn-danger" data-confirm="删除该分类？帖子将变为未分类" data-delete="admin/categories/${Number(cat.id)}">删除</button>\n`;
    h += '\t\t\t\t\t</div></td>\n\t\t\t\t</tr>\n';
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table>\n\t\t</section>\n\n';
  // 站点设置
  const adminTheme = themeIsValid(sv('site_theme')) ? sv('site_theme') : 'tool';
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-site">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">⚙️ 站点设置</h3>\n\t\t\t<form id="settings-form-admin">\n';
  h += '\t\t\t\t<div class="form-section-title">基础信息</div>\n\t\t\t\t<div class="form-grid">\n';
  h += `\t\t\t\t\t<div class="field"><label>${e(t(ctx, 'siteNameLabel', {}, '站点名称'))}</label><input class="input" name="site_title" maxlength="20" value="${e(sv('site_title') || DEFAULT_SITE_TITLE)}"><span class="hint">${e(t(ctx, 'siteNameHint', {}, '显示在全站顶部和浏览器标题，1–20 个字符，留空恢复为 TForum'))}</span></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>主题色</label><input class="input" type="color" name="site_primary_color" value="${e(sv('site_primary_color') || '#4f46e5')}"><span class="hint">${e(t(ctx, 'themeColorHint', {}, '仅对默认两套主题生效'))}</span></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>站点描述</label><input class="input" name="site_description" value="${e(sv('site_description'))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>首页每页帖子数</label><input class="input" type="number" name="posts_per_page" min="1" max="100" step="1" value="${e(sv('posts_per_page') || '10')}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>帖子正文字数上限</label><input class="input" type="number" name="post_max_length" min="1" max="1000000" step="1" value="${e(sv('post_max_length') || '20000')}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>评论字数上限</label><input class="input" type="number" name="comment_max_length" min="1" max="1000000" step="1" value="${e(sv('comment_max_length') || '500')}"></div>\n`;
  h += '\t\t\t\t\t<div class="field"><label>默认界面主题</label><select class="select" name="site_theme">\n';
  for (const id of themeEnabledIds()) {
    const meta = themeMeta(id)!;
    const label = themeDisplayName(ctx, id) + (meta.mode === 'dark' ? ' · 暗' : '');
    h += `\t\t\t\t\t\t<option value="${e(id)}" ${adminTheme === id ? 'selected' : ''}>${e(label)}</option>\n`;
  }
  h += '\t\t\t\t\t</select></div>\n';
  h += `\t\t\t\t\t<div class="field"><label>Logo URL（留空用默认）</label><input class="input" name="site_logo_url" value="${e(sv('site_logo_url'))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>Favicon URL</label><input class="input" name="site_favicon_url" value="${e(sv('site_favicon_url'))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>背景图 URL</label><input class="input" name="site_bg_image" value="${e(sv('site_bg_image'))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>ICP 备案号</label><input class="input" name="site_icp" value="${e(sv('site_icp'))}"></div>\n`;
  h += '\t\t\t\t</div>\n';
  h += `\t\t\t\t<div class="field"><label>公告（支持 HTML）</label><textarea class="textarea" name="site_announcement" style="min-height:70px">${e(sv('site_announcement'))}</textarea></div>\n`;
  h += `\t\t\t\t<div class="field"><label>页脚 HTML</label><textarea class="textarea" name="site_footer_html" style="min-height:70px">${e(sv('site_footer_html'))}</textarea></div>\n`;
  h += `\t\t\t\t<div class="field"><label>版权声明</label><textarea class="textarea" name="site_copyright" style="min-height:70px">${e(sv('site_copyright') || DEFAULT_SITE_COPYRIGHT)}</textarea><span class="hint">显示在页脚，支持 HTML；留空则不显示这一行</span></div>\n\n`;
  h += '\t\t\t\t<div class="form-section-title">内容策略</div>\n\t\t\t\t<div class="form-grid">\n';
  h += `\t\t\t\t\t<div class="field"><label>发帖频率限制（JSON）</label><input class="input" name="site_post_rate_limit" value="${e(sv('site_post_rate_limit'))}" placeholder='{"count":3,"unit":"minute","window":1}'></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>评论频率限制（JSON）</label><input class="input" name="site_comment_rate_limit" value="${e(sv('site_comment_rate_limit'))}" placeholder='{"count":5,"unit":"minute","window":1}'></div>\n`;
  h += '\t\t\t\t</div>\n';
  h += `\t\t\t\t<div class="field"><label>违禁关键词（每行一个，命中则进入审核）</label><textarea class="textarea" name="site_keyword_filter" style="min-height:80px">${e(sv('site_keyword_filter'))}</textarea></div>\n`;
  h += `\t\t\t\t<div class="field"><label>用户协议（Markdown）</label><textarea class="textarea" name="site_terms" style="min-height:100px">${e(sv('site_terms'))}</textarea></div>\n`;
  h += `\t\t\t\t<div class="field"><label>隐私政策（Markdown）</label><textarea class="textarea" name="site_privacy" style="min-height:100px">${e(sv('site_privacy'))}</textarea></div>\n\n`;
  h += '\t\t\t\t<div class="form-section-title">高级</div>\n';
  h += `\t\t\t\t<div class="field"><label>自定义 CSS（改 UI 也可以直接改 assets/css/style.css）</label><textarea class="textarea" name="site_custom_css" style="min-height:100px;font-family:monospace">${e(sv('site_custom_css'))}</textarea></div>\n`;
  h += `\t\t\t\t<div class="field"><label>自定义 JS</label><textarea class="textarea" name="site_custom_js" style="min-height:80px;font-family:monospace">${e(sv('site_custom_js'))}</textarea></div>\n`;
  h += `\t\t\t\t<label class="checkbox" style="margin-bottom:10px"><input type="checkbox" name="force_login" value="1" ${sv('force_login') === '1' ? 'checked' : ''}> 强制登录（未登录无法浏览）</label>\n\n`;
  h += '\t\t\t\t<div style="margin-top:20px"><button class="btn btn-primary btn-lg" type="submit">💾 保存所有设置</button></div>\n\t\t\t</form>\n\t\t</section>\n\n';
  // 文件清理
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-cleanup">\n';
  h += '\t\t\t<h3 style="margin:0 0 10px;font-size:17px">🧹 孤立图片清理</h3>\n';
  h += '\t\t\t<p style="font-size:13px;color:var(--muted-foreground)">扫描 uploads 目录，找出未被任何帖子、评论、头像引用的图片。</p>\n';
  h += '\t\t\t<button class="btn btn-outline" id="analyze-files">🔍 扫描孤立文件</button>\n';
  h += '\t\t\t<div id="cleanup-result" style="margin-top:16px"></div>\n\t\t</section>\n\n';
  // 审计日志
  h += '\t\t<section class="admin-panel card" data-panel-group="admin" id="panel-logs">\n\t\t\t<h3 style="margin:0 0 16px;font-size:17px">📜 审计日志</h3>\n';
  h += '\t\t\t<div class="table-scroll"><table class="data-table">\n\t\t\t\t<thead><tr><th>ID</th><th>操作</th><th>用户</th><th>资源</th><th>详情</th><th>时间</th></tr></thead>\n\t\t\t\t<tbody>\n';
  for (const log of logs) {
    h += `\t\t\t\t<tr><td>#${Number(log.id)}</td><td><span class="badge">${e(log.action)}</span></td><td>${e(log.username ? log.username : '系统')}</td><td>${e((log.resource_type ?? '') + ' ' + (log.resource_id ?? ''))}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(log.details ?? '')}</td><td>${e(log.created_at)}</td></tr>\n`;
  }
  h += '\t\t\t\t</tbody>\n\t\t\t</table></div>\n\t\t</section>\n\t</div>\n</div>\n\n';
  h += `<script>
// 添加分类
document.getElementById('add-category-form')?.addEventListener('submit', async e => {
	e.preventDefault();
	try { await api('admin/categories', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('已添加'); setTimeout(() => location.reload(), 400); }
	catch (err) { toast(err.message, 'error'); }
});
// 保存分类名
$$('[data-cat-save]').forEach(btn => btn.addEventListener('click', async () => {
	const id = btn.dataset.catSave;
	const name = document.querySelector(\`[data-cat-name="\${id}"]\`).value;
	try { await api('admin/categories/' + id, { method: 'PUT', body: { name } }); toast('已保存'); }
	catch (e) { toast(e.message, 'error'); }
}));
// 文件扫描
document.getElementById('analyze-files')?.addEventListener('click', async () => {
	const box = document.getElementById('cleanup-result');
	box.innerHTML = '<span class="loading"></span> 扫描中…';
	try {
		const res = await api('admin/cleanup/analyze');
		if (!res.data.count) { box.innerHTML = '<div class="flash success">✅ 没有发现孤立文件</div>'; return; }
		box.innerHTML = \`<div class="flash error">发现 \${res.data.count} 个孤立文件</div>
			<div style="max-height:220px;overflow:auto;font:11px monospace;background:var(--muted);padding:12px;border-radius:8px">\${res.data.orphans.map(esc).join('<br>')}</div>
			<button class="btn btn-danger" id="do-cleanup" style="margin-top:12px">确认清理 \${res.data.count} 个文件</button>\`;
		document.getElementById('do-cleanup').addEventListener('click', async () => {
			const r = await api('admin/cleanup/execute', { method: 'POST' });
			toast(r.message); setTimeout(() => location.reload(), 500);
		});
	} catch (e) { box.innerHTML = '<div class="flash error">' + esc(e.message) + '</div>'; }
});
</script>\n`;
  return h;
}
