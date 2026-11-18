/**
 * 邮件：对应 PHP 版 content.php 的 email_template()/send_email()。
 * 发送通道改为 Resend API（原 Workers 版即用 Resend，settings 中保留 resend_* 三键）：
 * - resend_key 非空：fetch 调用 https://api.resend.com/emails 真实发送；
 * - resend_key 为空：「日志模式」，不真发、返回 sent=true 且 log=true，并写一条 audit_logs 记录
 *   （对应 PHP 版 MAIL_ENABLED=false 时写 data/mail.log 的调试语义；Workers 无本地文件，改落审计表）。
 */
import type { Ctx } from './ctx';
import { auditLog, e, validEmail } from './core';

export interface SendResult {
  sent: boolean;
  log: boolean;
}

/** 邮件 HTML 模板（与 PHP 版逐字一致） */
export async function emailTemplate(ctx: Ctx, title: string, contentHtml: string): Promise<string> {
  const site = e(await ctx.settings.get('site_title', 'TForum'));
  return '<!doctype html><html><body style="margin:0;padding:24px;background:#f3e8ee;font-family:Arial,sans-serif;">'
    + '<div style="max-width:520px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.08);">'
    + '<div style="padding:28px;background:linear-gradient(135deg,#f472b6,#a78bfa);color:#fff;">'
    + '<h1 style="margin:0;font-size:22px;">' + site + '</h1></div>'
    + '<div style="padding:28px;color:#333;line-height:1.7;">'
    + '<h2 style="margin-top:0;font-size:18px;">' + e(title) + '</h2>' + contentHtml
    + '</div><div style="padding:16px;text-align:center;color:#999;font-size:12px;">此邮件由系统自动发送，请勿直接回复。</div>'
    + '</div></body></html>';
}

/** 发送邮件（对应 send_email()；返回值扩展为 {sent, log} 以支撑 test-email 接口的原有语义） */
export async function sendEmail(ctx: Ctx, to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = await ctx.settings.get('resend_key', '');
  const logMode = apiKey === '';
  if (!validEmail(to)) return { sent: false, log: logMode };
  if (logMode) {
    await auditLog(ctx, 'EMAIL_LOG', 'email', to, subject);
    return { sent: true, log: true };
  }
  const fromAddr = await ctx.settings.get('resend_from', '');
  const fromName = await ctx.settings.get('resend_from_name', '');
  const from = fromName !== '' ? `${fromName} <${fromAddr}>` : fromAddr;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return { sent: res.ok, log: false };
  } catch {
    return { sent: false, log: false };
  }
}
