/** 用户设置页（对应 pages/settings.php；上传提示按统一 5MB 决策更新） */
import type { Ctx } from '../lib/ctx';
import { assetUrl, e } from '../lib/core';
import { pageRequireUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { resolveTheme, showFlash } from '../lib/layout';
import { themeDisplayName, themeEnabledIds, themeMeta } from '../lib/theme-registry';

export async function renderSettings(ctx: Ctx): Promise<string> {
  const user = await pageRequireUser(ctx);
  const curTheme = await resolveTheme(ctx);
  const val = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

  let h = showFlash(ctx) + '\n';
  h += `<div class="page-heading"><h1>⚙️ ${e(t(ctx, 'settings', {}, '账号设置'))}</h1></div>\n\n`;
  h += '<div class="settings-layout">\n\t<nav class="settings-nav card">\n';
  h += '\t\t<button class="active" data-tab="profile" data-tab-group="settings">👤 个人资料</button>\n';
  h += '\t\t<button data-tab="security" data-tab-group="settings">🔐 安全设置</button>\n';
  h += '\t\t<button data-tab="account" data-tab-group="settings">⚠️ 账号管理</button>\n';
  h += '\t\t<button data-tab="appearance" data-tab-group="settings">🎨 界面主题</button>\n\t</nav>\n\n';
  h += '\t<div class="settings-panel card">\n';
  // 个人资料
  h += '\t\t<section class="settings-section active" data-panel-group="settings" id="panel-profile">\n\t\t\t<h2>👤 个人资料</h2>\n';
  h += '\t\t\t<form data-ajax="user/profile" data-method="POST" data-reload="1">\n\t\t\t\t<div class="avatar-edit">\n';
  h += `\t\t\t\t\t<img src="${e(assetUrl(user.avatar_url ? String(user.avatar_url) : '/api/avatar?id=' + Number(user.id)))}" alt="avatar">\n`;
  h += '\t\t\t\t\t<div>\n\t\t\t\t\t\t<label class="btn btn-sm btn-outline" for="avatar-file">更换头像</label>\n\t\t\t\t\t\t<input type="file" id="avatar-file" accept="image/*" style="display:none">\n\t\t\t\t\t\t<div class="hint" style="margin-top:6px">支持 JPG/PNG/GIF/WebP，最大 5MB</div>\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n';
  h += '\t\t\t\t<div class="form-grid">\n';
  h += `\t\t\t\t\t<div class="field"><label>昵称</label><input class="input" name="nickname" value="${e(val(user.nickname))}" maxlength="30"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>用户名</label><input class="input" value="${e(user.username)}" disabled><span class="hint">用户名暂不支持自助修改</span></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>年龄</label><input class="input" type="number" name="age" min="1" max="150" value="${e(val(user.age))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>性别</label><select class="select" name="gender"><option value="">保密</option><option value="male" ${val(user.gender) === 'male' ? 'selected' : ''}>男</option><option value="female" ${val(user.gender) === 'female' ? 'selected' : ''}>女</option></select></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>生日</label><input class="input" type="date" name="birthday" value="${e(val(user.birthday))}"></div>\n`;
  h += `\t\t\t\t\t<div class="field"><label>邮箱</label><input class="input" value="${e(user.email)}" disabled><button type="button" class="btn btn-sm btn-outline" id="change-email-btn" style="margin-top:8px">修改邮箱</button></div>\n`;
  h += '\t\t\t\t</div>\n';
  h += `\t\t\t\t<div class="field"><label>个人简介</label><textarea class="textarea" name="bio" maxlength="500" placeholder="介绍一下自己吧～">${e(val(user.bio))}</textarea></div>\n`;
  h += `\t\t\t\t<label class="checkbox"><input type="checkbox" name="email_notifications" value="1" ${Number(user.email_notifications) === 1 ? 'checked' : ''}> 接收邮件通知</label>\n`;
  h += '\t\t\t\t<div style="margin-top:20px"><button class="btn btn-primary" type="submit">💾 保存资料</button></div>\n\t\t\t</form>\n';
  h += '\t\t\t<hr style="border:0;border-top:1px solid var(--border);margin:26px 0">\n\t\t\t<h3 style="font-size:15px">🖼️ 个人主页背景</h3>\n';
  h += '\t\t\t<form data-ajax="user/upload-bg" data-method="POST" data-formdata="1" data-reload="1">\n\t\t\t\t<input type="file" name="image" accept="image/*" class="input" required>\n\t\t\t\t<button class="btn btn-outline btn-sm" type="submit" style="margin-top:10px">上传背景图</button>\n\t\t\t</form>\n\t\t</section>\n\n';
  // 安全设置
  h += '\t\t<section class="settings-section" data-panel-group="settings" id="panel-security">\n\t\t\t<h2>🔐 安全设置</h2>\n';
  h += '\t\t\t<h3 class="form-section-title">修改密码</h3>\n\t\t\t<form data-ajax="user/change-password" data-method="POST">\n';
  h += '\t\t\t\t<div class="field"><label>原密码</label><input class="input" type="password" name="old_password" required></div>\n';
  h += '\t\t\t\t<div class="field"><label>新密码（8～16 位）</label><input class="input" type="password" name="new_password" required minlength="8" maxlength="16"></div>\n';
  h += '\t\t\t\t<button class="btn btn-primary" type="submit">修改密码</button>\n\t\t\t</form>\n\n';
  h += '\t\t\t<h3 class="form-section-title">双因素认证 (2FA)</h3>\n';
  if (Number(user.totp_enabled) === 1) {
    h += '\t\t\t<div class="flash success">✅ 双因素认证已开启</div>\n';
    h += '\t\t\t<button class="btn btn-outline" data-admin-action="user/totp/disable" data-ask="确定关闭双因素认证吗？">关闭双因素认证</button>\n';
  } else {
    h += '\t\t\t<p style="color:var(--muted-foreground);font-size:13px">开启后，登录时需要输入验证器 App 的 6 位动态码。</p>\n';
    h += '\t\t\t<button class="btn btn-outline" id="totp-setup-btn">开启双因素认证</button>\n';
    h += '\t\t\t<div id="totp-box" style="display:none;margin-top:16px;padding:18px;border:1px dashed var(--border);border-radius:var(--radius-sm)">\n';
    h += '\t\t\t\t<p><strong>1.</strong> 在验证器 App（如 Google Authenticator）中手动添加账号，密钥如下：</p>\n';
    h += '\t\t\t\t<code id="totp-secret" style="display:block;padding:10px;background:var(--muted);border-radius:8px;font-size:16px;letter-spacing:2px;user-select:all"></code>\n';
    h += '\t\t\t\t<p style="margin-top:12px"><strong>2.</strong> 输入 App 显示的 6 位验证码确认开启：</p>\n';
    h += '\t\t\t\t<form data-ajax="user/totp/verify" data-method="POST" data-reload="1">\n';
    h += '\t\t\t\t\t<input class="input" name="code" maxlength="6" inputmode="numeric" placeholder="000000" required style="width:160px">\n';
    h += '\t\t\t\t\t<button class="btn btn-primary btn-sm" type="submit" style="margin-left:8px">确认开启</button>\n\t\t\t\t</form>\n\t\t\t</div>\n';
  }
  h += '\t\t</section>\n\n';
  // 账号管理
  h += '\t\t<section class="settings-section" data-panel-group="settings" id="panel-account">\n\t\t\t<h2>⚠️ 账号管理</h2>\n';
  h += '\t\t\t<div class="flash error">以下操作不可撤销，请谨慎操作。</div>\n';
  h += '\t\t\t<h3 class="form-section-title">注销账号</h3>\n';
  h += '\t\t\t<p style="font-size:13px;color:var(--muted-foreground)">选择「匿名化」将删除你的个人信息但保留帖子；选择「完全删除」将删除账号及所有内容。</p>\n';
  h += '\t\t\t<button class="btn btn-danger" id="delete-account-btn">注销我的账号</button>\n\t\t</section>\n\n';
  // 界面主题
  h += '\t\t<section class="settings-section" data-panel-group="settings" id="panel-appearance">\n\t\t\t<h2>🎨 界面主题</h2>\n';
  h += '\t\t\t<p style="font-size:13px;color:var(--muted-foreground);margin:0 0 16px">切换后立即生效并记住你的选择；也可以直接点顶栏的切换按钮依次浏览所有主题。</p>\n';
  h += '\t\t\t<div class="theme-grid">\n';
  // 主题清单由注册表生成：色块取注册表的 [底色, 强调色]，与顶栏循环顺序一致
  for (const id of themeEnabledIds()) {
    const meta = themeMeta(id)!;
    const swatchStyle = `background:linear-gradient(135deg,${meta.swatch[0]} 50%,${meta.swatch[1]} 50%)`;
    h += `\t\t\t\t<button type="button" class="theme-chip ${curTheme === id ? 'active' : ''}" data-theme="${e(id)}" title="${e(themeDisplayName(ctx, id))}"><span class="theme-chip-swatch" style="${e(swatchStyle)}"></span><span class="theme-chip-name">${e(themeDisplayName(ctx, id))}</span></button>\n`;
  }
  h += '\t\t\t</div>\n\t\t</section>\n\t</div>\n</div>\n\n';
  h += `<script>
// 头像上传
document.getElementById('avatar-file')?.addEventListener('change', async e => {
	const file = e.target.files[0]; if (!file) return;
	const fd = new FormData(); fd.append('image', file);
	toast('上传中…');
	try { const res = await api('user/upload-avatar', { method: 'POST', form: fd }); location.reload(); }
	catch (err) { toast(err.message, 'error'); }
});
// 修改邮箱
document.getElementById('change-email-btn')?.addEventListener('click', () => {
	showModal(\`<h3>📧 修改邮箱</h3><p style="font-size:13px;color:var(--muted-foreground)">验证邮件将发送到新邮箱，确认后生效。</p>
		<form id="email-form"><div class="field"><label>新邮箱</label><input class="input" type="email" name="email" required></div>
		<div class="modal-foot"><button type="button" class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-primary" type="submit">发送验证邮件</button></div></form>\`);
	document.getElementById('email-form').addEventListener('submit', async ev => {
		ev.preventDefault();
		try { const res = await api('user/change-email', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); closeModal(); toast(res.message || '验证邮件已发送'); }
		catch (err) { toast(err.message, 'error'); }
	});
});
// 2FA 设置
document.getElementById('totp-setup-btn')?.addEventListener('click', async () => {
	try {
		const res = await api('user/totp/setup', { method: 'POST' });
		document.getElementById('totp-secret').textContent = res.data.secret;
		document.getElementById('totp-box').style.display = 'block';
	} catch (e) { toast(e.message, 'error'); }
});
// 注销账号
document.getElementById('delete-account-btn')?.addEventListener('click', () => {
	showModal(\`<h3>⚠️ 注销账号</h3><p style="font-size:13px">此操作不可撤销，请选择注销方式：</p>
		<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">取消</button>
		<button class="btn btn-outline" data-admin-action="user/delete" data-payload='{"mode":"anonymize"}'>匿名化（保留内容）</button>
		<button class="btn btn-danger" data-admin-action="user/delete" data-payload='{"mode":"delete"}'>完全删除</button></div>\`);
	// 重新绑定新插入的按钮事件
	$$('#modal-box [data-admin-action]').forEach(btn => btn.addEventListener('click', async () => {
		try { await api(btn.dataset.adminAction, { method: 'POST', body: JSON.parse(btn.dataset.payload || '{}') }); location.href = '/'; }
		catch (e) { toast(e.message, 'error'); }
	}));
});
</script>\n`;
  return h;
}
