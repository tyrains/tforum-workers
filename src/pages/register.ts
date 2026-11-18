/** 注册页（对应 pages/register.php；已登录跳首页；Turnstile 开启时注入组件） */
import type { Ctx } from '../lib/ctx';
import { e, redirect } from '../lib/core';
import { currentUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { showFlash } from '../lib/layout';
import { turnstileWidget } from './turnstile';

export async function renderRegister(ctx: Ctx): Promise<string> {
  if (await currentUser(ctx)) redirect('/');
  let h = showFlash(ctx) + '\n';
  h += '<div class="auth-wrap">\n\t<div class="auth-card card">\n';
  h += '\t\t<div class="auth-deco">✨</div>\n';
  h += `\t\t<h1>${e(t(ctx, 'register', {}, '加入我们'))}</h1>\n`;
  h += '\t\t<p class="subtitle">注册后需前往邮箱验证</p>\n';
  h += '\t\t<form data-ajax="register" data-method="POST" data-redirect="/login">\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="reg-username">👤 用户名</label>\n\t\t\t\t<input class="input" type="text" id="reg-username" name="username" required maxlength="20" autocomplete="username" placeholder="2～20 个字符">\n\t\t\t</div>\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="reg-email">📧 邮箱</label>\n\t\t\t\t<input class="input" type="email" id="reg-email" name="email" required autocomplete="email" placeholder="you@example.com">\n\t\t\t</div>\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="reg-password">🔒 密码</label>\n\t\t\t\t<input class="input" type="password" id="reg-password" name="password" required minlength="8" maxlength="16" autocomplete="new-password" placeholder="8～16 位">\n\t\t\t</div>\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="reg-password2">🔒 确认密码</label>\n\t\t\t\t<input class="input" type="password" id="reg-password2" name="password2" required minlength="8" maxlength="16" autocomplete="new-password" placeholder="再输入一次密码">\n\t\t\t</div>\n';
  h += await turnstileWidget(ctx);
  h += `\t\t\t<button class="btn btn-primary btn-lg btn-block" type="submit">🎉 ${e(t(ctx, 'register', {}, '注册'))}</button>\n`;
  h += '\t\t</form>\n\t\t<div class="auth-links" style="justify-content:center">\n\t\t\t<a href="/login">已有账号？去登录 →</a>\n\t\t</div>\n\t</div>\n</div>\n';
  h += `<script>
document.querySelector('form[data-ajax="register"]')?.addEventListener('submit', e => {
	const a = document.getElementById('reg-password').value;
	const b = document.getElementById('reg-password2').value;
	if (a !== b) { e.preventDefault(); e.stopImmediatePropagation(); toast('两次输入的密码不一致', 'error'); }
});
</script>\n`;
  return h;
}
