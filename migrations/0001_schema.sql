-- TForum D1 结构迁移（0001）
-- 由 PHP 版 lib/db.php 的 SQLite 建表语句 1:1 平移，D1 同为 SQLite 方言。
-- 差异说明（均为任务书/决策记录已定事项，非静默改动）：
--   1. users 新增 verification_token_expires、email_change_token_expires 两列：
--      邮箱验证令牌、改邮箱令牌加 24 小时过期（决策点 5）；密码重置仍用原 reset_token_expires（1 小时）。
--   2. sessions 表按 Workers 服务端会话重新定义：PHP 版实际走 PHP 原生 Session、此表为原 Workers 版
--      JWT(jti) 吊销表遗留且零引用；新版正式启用为 D1 会话存储（id=会话ID，另存 csrf_token 便于双提交校验）。
--   3. nonces 表在 PHP 版中建表但全代码零引用（死表），不迁移。
--   4. 新增 rate_limits 表：替代 PHP 版 data/ratelimit/*.json 文件计数（登录/注册/找回限流），
--      bucket 形如 'login:1.2.3.4'，hit_at 为 unix 秒。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'normal',
  verified INTEGER DEFAULT 0,
  verification_token TEXT,
  verification_token_expires INTEGER,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  reset_token TEXT,
  reset_token_expires INTEGER,
  pending_email TEXT,
  email_change_token TEXT,
  email_change_token_expires INTEGER,
  avatar_url TEXT,
  nickname TEXT,
  email_notifications INTEGER DEFAULT 1,
  age INTEGER,
  gender TEXT,
  birthday TEXT,
  bio TEXT,
  bg_image TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category_id INTEGER,
  is_pinned INTEGER DEFAULT 0,
  status TEXT DEFAULT 'normal',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_id INTEGER,
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  hit_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket ON rate_limits(bucket, hit_at);
