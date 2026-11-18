/** 重置密码页（对应 pages/reset.php） */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';
import { t } from '../lib/i18n';
import { showFlash } from '../lib/layout';

export async function renderReset(ctx: Ctx): Promise<string> {
  const token = ctx.strParam('token', '');
  let h = showFlash(ctx) + '\n';
  h += '<div class="auth-wrap">\n\t<div class="auth-card card">\n';
  h += '\t\t<div class="auth-deco">🔐</div>\n';
  h += `\t\t<h1>${e(t(ctx, 'resetPassword', {}, '重置密码'))}</h1>\n`;
  h += '\t\t<p class="subtitle">请设置新的登录密码</p>\n';
  if (!token) {
    h += '\t\t<div class="flash error">缺少重置令牌，请从邮件中的链接进入。</div>\n';
  } else {
    h += '\t\t<form data-ajax="auth/reset-password" data-method="POST" data-redirect="/login">\n';
    h += `\t\t\t<input type="hidden" name="token" value="${e(token)}">\n`;
    h += '\t\t\t<div class="field">\n\t\t\t\t<label for="new-pass">🔒 新密码</label>\n\t\t\t\t<input class="input" type="password" id="new-pass" name="password" required minlength="8" maxlength="16" placeholder="8～16 位">\n\t\t\t</div>\n';
    h += '\t\t\t<div class="field">\n\t\t\t\t<label for="new-pass2">🔒 确认新密码</label>\n\t\t\t\t<input class="input" type="password" id="new-pass2" name="password2" required minlength="8" maxlength="16">\n\t\t\t</div>\n';
    h += '\t\t\t<button class="btn btn-primary btn-lg btn-block" type="submit">✅ 确认重置</button>\n';
    h += '\t\t</form>\n';
    h += `\t\t<script>
		document.querySelector('form[data-ajax="auth/reset-password"]')?.addEventListener('submit', e => {
			if (document.getElementById('new-pass').value !== document.getElementById('new-pass2').value) {
				e.preventDefault(); e.stopImmediatePropagation(); toast('两次输入的密码不一致', 'error');
			}
		});
		</script>\n`;
  }
  h += '\t</div>\n</div>\n';
  return h;
}
