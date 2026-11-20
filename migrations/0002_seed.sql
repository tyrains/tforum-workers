-- TForum D1 种子数据（0002）
-- 与 PHP 版 lib/db.php init_db() 的播种行为等价：全部使用 INSERT OR IGNORE，可重复执行不报错、不覆盖已有数据。
-- 包含：32 个默认 settings 键（与 db.php $defaults 逐键一致）+ 3 个一次性迁移标记键
--      （brand_migrated / theme_migrated / categories_seeded，PHP 版用它们防止每次请求重复播种；
--        预置为 1 表示「已处理」，与随包数据库的实际状态一致）
--      + 3 个默认分类 + 初始管理员。

INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_title', 'TForum');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_description', '一个基于 PHP + SQLite 的现代化社区论坛');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_primary_color', '#4f46e5');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_favicon_url', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_logo_url', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_announcement', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_icp', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_footer_html', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_copyright', 'Powered by <a class="powered-link" href="https://github.com/tyrains" target="_blank" rel="noopener noreferrer">tyrains</a>');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_bg_image', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_bg_opacity', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_custom_css', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_custom_js', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_terms', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_privacy', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_theme', 'tool');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_allowed_regions', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_blocked_regions', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_post_rate_limit', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_comment_rate_limit', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('posts_per_page', '10');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('post_max_length', '20000');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('comment_max_length', '500');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('site_keyword_filter', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('force_login', '0');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('turnstile_enabled', '0');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('turnstile_site_key', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('notify_on_user_delete', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('notify_on_username_change', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('notify_on_avatar_change', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('notify_on_manual_verify', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('notify_on_role_change', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('resend_key', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('resend_from', '');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('resend_from_name', 'TForum');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('brand_migrated', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('theme_migrated', '1');
INSERT OR IGNORE INTO settings ("key", value) VALUES ('categories_seeded', '1');

-- 默认分类（PHP 版仅在空表时播种一次；此处 INSERT OR IGNORE 保证已有同名分类时不重复）
INSERT OR IGNORE INTO categories (name) VALUES ('技术');
INSERT OR IGNORE INTO categories (name) VALUES ('灌水');
INSERT OR IGNORE INTO categories (name) VALUES ('其他');

-- 初始管理员：用户名 admin / 邮箱 admin@example.com / 密码 admin123（首次登录后请立即修改）
-- 密码为 PBKDF2-SHA256 100000 次迭代哈希（与 PHP 版 hash_password() 同格式），登录后请立即修改。
INSERT OR IGNORE INTO users (email, username, password, role, verified, nickname, avatar_url)
VALUES ('admin@example.com', 'admin', 'pbkdf2:100000:d8dfc2d52c8c233a949b3531f0b60d55:c38206c84f6770f8651de768ba297795cf5deb3b000d96db841258c81326000b', 'admin', 1, 'admin', 'assets/img/default-avatar.svg');
