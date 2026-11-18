/**
 * Turnstile 组件注入（决策项：补回执行逻辑、默认关闭）。
 * 仅当 settings.turnstile_enabled=1 且配置了 site_key 时，登录/注册页才输出官方组件；
 * 服务端校验在 api/auth.ts 的 verifyTurnstile()（secret 为空时同样跳过）。
 */
import type { Ctx } from '../lib/ctx';
import { e } from '../lib/core';

export async function turnstileWidget(ctx: Ctx): Promise<string> {
  if (!(await ctx.settings.bool('turnstile_enabled'))) return '';
  const siteKey = await ctx.settings.get('turnstile_site_key', '');
  if (siteKey === '') return '';
  return '\t\t\t<div class="field"><div class="cf-turnstile" data-sitekey="' + e(siteKey) + '"></div></div>\n'
    + '\t\t\t<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n';
}
