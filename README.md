# TForum（Cloudflare Workers 原生版）

由 PHP 版 TForum 完整迁移：单 Worker（TypeScript）+ D1 数据库 + R2 文件存储 + Workers Static Assets 静态资源。
页面 UI、class 名、API 契约（路径 / 参数 / 响应 JSON / 中文文案）与 PHP 版保持一致；页面 URL 改为干净路径，旧链接自动兼容跳转。

> **PHP 版下载声明**：本仓库是 Cloudflare Workers 版；TForum 另有 PHP 原版（PHP + SQLite，免构建、上传即用），已打包发布在本仓库的 [Releases](https://github.com/tyrains/tforum-workers/releases/tag/php-v4) 中（文件 `tforum_php_v4.zip`）。想用传统 PHP 空间部署的同学，不必部署本仓库，直接去 Releases 下载 PHP 版，解压后上传到服务器即可运行。

## 目录结构

```
tforum/
├─ src/
│  ├─ index.ts          # Worker 入口：路由分发（页面 / API / 上传文件 / 旧链接兼容）
│  ├─ env.ts            # 绑定类型（DB / R2 / ASSETS / SITE_URL）
│  ├─ lib/              # 基础设施：上下文、DB、会话、内容处理（Markdown/净化）、邮件、i18n、布局
│  ├─ api/              # API 处理函数（auth / content / admin），与 PHP 版 lib/api_*.php 一一对应
│  └─ pages/            # 页面 SSR 模板，与 PHP 版 pages/*.php 一一对应
├─ public/assets/       # 静态资源（style.css 与 PHP 版原样一致；app.js 仅改 API 基址与链接）
├─ migrations/          # D1 迁移：0001_schema.sql（表结构）、0002_seed.sql（默认设置/分类/管理员）
├─ tools/import-sqlite.mjs  # 旧 SQLite 数据导入脚本
├─ wrangler.jsonc       # Worker 配置（部署前填 database_id）
└─ package.json
```

## 部署步骤

以下命令在本目录执行。先决条件：Node.js ≥ 18、已注册 Cloudflare 账号。

### 1. 安装依赖并登录

```bash
npm install
npx wrangler login
```

### 2. 创建 D1 数据库与 R2 存储桶

```bash
npx wrangler d1 create tforum-db        # 记下输出的 database_id
npx wrangler r2 bucket create tforum-uploads
```

把 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`（当前是全零占位符，不填无法部署）。

### 3. 执行数据库迁移（建表 + 种子数据）

```bash
npm run migrate:remote
```

迁移可重复执行（全部 `IF NOT EXISTS` / `INSERT OR IGNORE`），不会重复建表或重复写种子。

种子内容：34 个默认站点设置、3 个默认分类（技术 / 灌水 / 其他）、初始管理员账号（见下）。

### 4. 部署 Worker

```bash
npm run deploy
```

部署成功后 wrangler 会输出 `https://tforum.<你的子域>.workers.dev`，打开即是论坛首页。
如需绑定自定义域名，在 Cloudflare 后台 Workers → tforum → Settings → Domains & Routes 添加。

### 5. 初始管理员与安全提醒

- 初始管理员：邮箱 `admin@example.com`，用户名 `admin`，密码 `admin123`。**首次登录后请立即在「设置」中修改密码。**
- **首次登录后请立即在「设置 → 安全设置」修改密码**，并按需开启双因素认证。
- 该账号在种子里已是已验证 + 管理员状态，可直接进 `/admin` 管理后台。

## 旧数据导入（从 PHP 版 forum.sqlite 迁移）

```bash
# 1) 先完成上面的建库与 migrations
# 2) 生成导入 SQL（需要 Node ≥ 22.5，使用内置 node:sqlite）
node tools/import-sqlite.mjs /path/to/forum.sqlite ./import.sql
# 3) 导入到远程 D1
npx wrangler d1 execute tforum-db --remote --file=./import.sql
```

脚本会打印源库逐表行数，导入后逐表 `SELECT COUNT(*)` 核对即可。
注意：导入会清空并替换种子数据（包括初始管理员——以旧库账号为准）；旧 PHP 会话不迁移，用户重新登录即可；旧上传图片文件需另行上传到 R2（Key 为去掉 `uploads/` 前缀的相对路径，如 DB 存 `uploads/usr/1/avatar_xxx.png` → R2 Key `usr/1/avatar_xxx.png`），可用 `npx wrangler r2 object put tforum-uploads/<key> --file=<本地文件>` 逐个上传，或在后台用 R2 批量工具。

## 本地开发 / 测试

```bash
npm run migrate:local   # 给本地 D1 建表（只需一次）
npm run dev             # 启动本地开发服务器（默认 http://localhost:8787）
npm run typecheck       # TypeScript 类型检查
```

本地 R2/D1 均为模拟环境，数据互不影响线上。

## 配置说明

### 密钥与 Secrets

本项目**没有必需的环境 Secret**。所有业务配置都在 D1 的 `settings` 表中，部署后通过管理后台 API 保存：

| 配置 | settings 键 | 说明 |
|---|---|---|
| Resend API Key | `resend_key` | 邮件发送；为空时进入「日志模式」（不真发、记录到审计日志，接口照常返回成功） |
| 发件人 | `resend_from` / `resend_from_name` | Resend 已验证域名下的地址 |
| Turnstile | `turnstile_enabled` / `turnstile_site_key` / `turnstile_secret_key` | 默认关闭；开启后登录/注册页出现人机验证组件，服务端自动校验 |

保存方式（示例，管理员登录后在浏览器控制台或用 curl 带 Cookie 与 CSRF 头执行）：

```js
await api('admin/settings', { method: 'POST', body: { resend_key: 're_xxx', resend_from: 'no-reply@example.com' } });
```

安全约定：后台读取设置时 `resend_key`、`turnstile_secret_key` 只回掩码 `********`，保存时提交掩码表示不修改、提交空串表示清空。

### 可选环境变量

- `SITE_URL`（wrangler.jsonc 的 `vars` 或 `.dev.vars`）：固定站点域名，邮件中的链接用它拼接；不设则取每次请求的 Origin，一般无需设置。

### 功能开关（settings，均在管理后台/API 修改）

- `force_login`：`1` 时未登录用户只能访问登录/注册/找回/验证/协议页。
- `site_allowed_regions` / `site_blocked_regions`：区域限制，逗号或换行分隔的国家代码（如 `CN,US`）；都为空 = 不限制（默认）。判断依据为 Cloudflare 的 `request.cf.country`。
- `site_theme`：默认界面主题 `editorial`（杂志编辑风）/ `tool`（默认工具风）；用户个人选择存 Cookie `cforum_theme`。
- 上传大小上限统一 5MB（头像、背景、正文图片一致）。

## 与 PHP 版的主要差异（行为等价，仅实现载体不同）

- 会话：PHP Session → D1 `sessions` 表 + Cookie `cforum_session`（HttpOnly/Secure/SameSite=Lax，7 天）；游客 CSRF 令牌用 `cforum_csrf` Cookie 双提交。
- 邮件日志模式：PHP 版写 `data/mail.log` 文件 → 新版写一条 `audit_logs` 记录（action=EMAIL_LOG）。
- 邮箱验证 / 改邮箱令牌有效期 24 小时（新增 `verification_token_expires`、`email_change_token_expires` 两列）；密码重置仍为 1 小时。从旧库导入的令牌过期时间为 NULL，按未过期处理。
- 评论通知邮件按**帖子作者**的邮件通知开关判断（修复 PHP 版误读帖子字段的 bug）。
- `totp-qr` 接口新版要求登录后访问（PHP 版未校验）。
- 静态资源版本号为固定构建版本常量（PHP 版用 filemtime）；flash 消息改用 Cookie 传递。
- URL：页面为干净路径（`/post/123` 等）；旧 `index.php?p=...`、`index.php/post/1`、`/posts/1` 均 302 跳转新路径，`api.php?r=...` 直接按 API 路由处理（不跳转，POST 数据不丢失）。

## 维护

代码推送到 GitHub 后，可在 Cloudflare 后台为 Worker 配置 Git 自动部署，或继续用 `npm run deploy` 手动部署。修改样式优先改 `public/assets/css/style.css`（与 PHP 版同一份文件），或用管理后台的「自定义 CSS」在线调整。

## 开源协议

本项目以 [MIT](LICENSE) 协议开源。
