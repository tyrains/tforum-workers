/** Cloudflare Workers 绑定与环境变量类型（对应 wrangler.jsonc）。 */
export interface Env {
  /** D1 数据库（tforum-db） */
  DB: D1Database;
  /** R2 存储桶（tforum-uploads）：用户上传图片 */
  R2: R2Bucket;
  /** Workers Static Assets：public/ 静态资源 */
  ASSETS: Fetcher;
  /** 可选：站点绝对地址覆盖（如 https://tforum.example.com），邮件链接用；缺省取请求 Origin */
  SITE_URL?: string;
}
