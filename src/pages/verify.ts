/** 邮箱验证 / 邮箱修改确认页（对应 pages/verify.php，两个干净路径共用） */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';
import { t } from '../lib/i18n';

export async function renderVerify(ctx: Ctx, isChange: boolean): Promise<string> {
  const token = ctx.strParam('token', '');
  const route = isChange ? 'verify-email-change' : 'verify';
  let h = '';
  h += '<div class="auth-wrap">\n\t<div class="auth-card card" style="text-align:center">\n';
  h += '\t\t<div class="auth-deco">📬</div>\n';
  h += `\t\t<h1>${e(isChange ? '确认邮箱修改' : t(ctx, 'verifyEmail', {}, '邮箱验证'))}</h1>\n`;
  h += '\t\t<p class="subtitle" id="verify-status">正在验证，请稍候…</p>\n';
  h += '\t\t<div id="verify-result"></div>\n\t</div>\n</div>\n';
  h += `<script>
(async () => {
	const result = document.getElementById('verify-result');
	const status = document.getElementById('verify-status');
	if (!${JSON.stringify(token)}) { status.textContent = '链接无效'; result.innerHTML = '<a class="btn" href="/">返回首页</a>'; return; }
	try {
		const res = await api(${JSON.stringify(route)} + '?token=' + encodeURIComponent(${JSON.stringify(token)}));
		status.textContent = res.message || '验证成功！';
		result.innerHTML = '<a class="btn btn-primary" href="/login">去登录</a>';
	} catch (e) {
		status.textContent = e.message;
		result.innerHTML = '<a class="btn btn-outline" href="/">返回首页</a>';
	}
})();
</script>\n`;
  return h;
}
