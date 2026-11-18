/** 登录页（对应 pages/login.php；已登录跳首页；Turnstile 开启时注入组件） */
import type { Ctx } from '../lib/ctx';
import { e, redirect } from '../lib/core';
import { currentUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { showFlash } from '../lib/layout';
import { turnstileWidget } from './turnstile';

export async function renderLogin(ctx: Ctx): Promise<string> {
  if (await currentUser(ctx)) redirect('/');
  let h = showFlash(ctx) + '\n';
  h += '<div class="auth-wrap">\n\t<div class="auth-card card">\n';
  h += '\t\t<div class="auth-deco">🌸</div>\n';
  h += `\t\t<h1>${e(t(ctx, 'login', {}, '欢迎回来'))}</h1>\n`;
  h += '\t\t<p class="subtitle">登录后可发帖、评论、点赞</p>\n';
  h += '\t\t<form data-ajax="login" data-method="POST" data-redirect="/">\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="email">👤 用户名或邮箱</label>\n\t\t\t\t<input class="input" type="text" id="email" name="email" required autocomplete="username" placeholder="用户名或邮箱">\n\t\t\t</div>\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="password">🔒 密码</label>\n\t\t\t\t<input class="input" type="password" id="password" name="password" required autocomplete="current-password" placeholder="输入密码">\n\t\t\t</div>\n';
  h += '\t\t\t<div class="field" id="totp-field" style="display:none">\n\t\t\t\t<label for="totp_code">🔐 双因素验证码</label>\n\t\t\t\t<input class="input" type="text" id="totp_code" name="totp_code" maxlength="6" inputmode="numeric" placeholder="6 位数字">\n\t\t\t</div>\n';
  h += await turnstileWidget(ctx);
  h += `\t\t\t<button class="btn btn-primary btn-lg btn-block" type="submit">🚀 ${e(t(ctx, 'login', {}, '登录'))}</button>\n`;
  h += '\t\t</form>\n\t\t<div class="auth-links">\n';
  h += `\t\t\t<a href="/forgot">${e(t(ctx, 'forgotPassword', {}, '忘记密码？'))}</a>\n`;
  h += `\t\t\t<a href="/register">${e(t(ctx, 'register', {}, '还没有账号？注册'))}</a>\n`;
  h += '\t\t</div>\n\t</div>\n</div>\n';
  h += `<script>
// 登录失败若提示需要 TOTP，则显示验证码输入框
document.querySelector('form[data-ajax="login"]')?.addEventListener('submit', async () => {
	setTimeout(() => {
		if (document.querySelector('#totp-field').style.display === 'none') {
			// 由 toast 错误触发时显示（简单处理：始终保留可选字段可见提示）
		}
	}, 800);
});
// 若 URL 带 totp=1 则展开
if (new URLSearchParams(location.search).get('totp') === '1') {
	document.getElementById('totp-field').style.display = '';
}
</script>\n`;
  return h;
}
