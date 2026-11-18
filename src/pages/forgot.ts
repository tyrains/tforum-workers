/** 找回密码页（对应 pages/forgot.php） */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';
import { t } from '../lib/i18n';
import { showFlash } from '../lib/layout';

export async function renderForgot(ctx: Ctx): Promise<string> {
  let h = showFlash(ctx) + '\n';
  h += '<div class="auth-wrap">\n\t<div class="auth-card card">\n';
  h += '\t\t<div class="auth-deco">🔑</div>\n';
  h += `\t\t<h1>${e(t(ctx, 'forgotPassword', {}, '找回密码'))}</h1>\n`;
  h += '\t\t<p class="subtitle">输入注册邮箱，我们会发送重置链接</p>\n';
  h += '\t\t<form data-ajax="auth/forgot-password" data-method="POST">\n';
  h += '\t\t\t<div class="field">\n\t\t\t\t<label for="forgot-email">📧 邮箱</label>\n\t\t\t\t<input class="input" type="email" id="forgot-email" name="email" required placeholder="you@example.com">\n\t\t\t</div>\n';
  h += '\t\t\t<button class="btn btn-primary btn-lg btn-block" type="submit">📨 发送重置链接</button>\n';
  h += '\t\t</form>\n\t\t<div class="auth-links" style="justify-content:center;margin-top:18px"><a href="/login">← 返回登录</a></div>\n';
  h += '\t</div>\n</div>\n';
  return h;
}
