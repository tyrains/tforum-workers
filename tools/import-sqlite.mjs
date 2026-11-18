#!/usr/bin/env node
/**
 * 旧数据导入脚本：把 PHP 版 data/forum.sqlite 导出为可在 D1 执行的 import.sql。
 *
 * 用法：
 *   node tools/import-sqlite.mjs <forum.sqlite 路径> [输出文件，默认 ./import.sql]
 *
 * 说明：
 * - 依赖 Node ≥ 22.5 的内置 node:sqlite（DatabaseSync）。低版本 Node 请升级后再跑。
 * - 生成的 SQL 先按外键安全顺序清空目标表，再带显式 id 全量 INSERT；
 *   因此应在 `wrangler d1 migrations apply` 之后执行，种子管理员/默认分类会被导入数据替换。
 * - 只导入两边都存在的列：旧库 users 表没有 verification_token_expires /
 *   email_change_token_expires 两列（新版新增），导入后这两列为 NULL（旧令牌按未过期处理）。
 * - sessions（会话）与 nonces（死表）不迁移：旧 PHP 会话在新版无法复用，用户需重新登录。
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const srcPath = process.argv[2];
const outPath = process.argv[3] ?? 'import.sql';
if (!srcPath) {
  console.error('用法：node tools/import-sqlite.mjs <forum.sqlite 路径> [输出文件]');
  process.exit(1);
}

/** 目标表与列（与 migrations/0001_schema.sql 对齐；按外键安全顺序排列） */
const TABLES = {
  categories: ['id', 'name', 'created_at'],
  users: [
    'id', 'email', 'password', 'username', 'nickname', 'role', 'status', 'verified',
    'verification_token', 'verification_token_expires', 'reset_token', 'reset_token_expires',
    'pending_email', 'email_change_token', 'email_change_token_expires',
    'avatar_url', 'bg_image', 'bio', 'age', 'gender', 'birthday',
    'email_notifications', 'totp_secret', 'totp_enabled', 'created_at',
  ],
  settings: ['key', 'value'],
  posts: ['id', 'author_id', 'category_id', 'title', 'content', 'status', 'is_pinned', 'view_count', 'created_at'],
  comments: ['id', 'post_id', 'parent_id', 'author_id', 'content', 'status', 'created_at'],
  likes: ['id', 'post_id', 'user_id', 'created_at'],
  audit_logs: ['id', 'user_id', 'action', 'resource_type', 'resource_id', 'details', 'ip_address', 'created_at'],
};

/** 清空顺序：先子表后父表 */
const DELETE_ORDER = ['likes', 'comments', 'posts', 'audit_logs', 'sessions', 'rate_limits', 'users', 'categories', 'settings'];

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return "X'" + Buffer.from(v).toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const db = new DatabaseSync(srcPath, { readOnly: true });
const lines = [];
lines.push('-- TForum 旧数据导入（由 tools/import-sqlite.mjs 生成）');
lines.push('-- 执行顺序：先 wrangler d1 migrations apply，再执行本文件。');
lines.push('');

const counts = {};
for (const t of DELETE_ORDER) {
  lines.push(`DELETE FROM ${t};`);
}
lines.push('');

for (const [table, targetCols] of Object.entries(TABLES)) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!exists) {
    counts[table] = 0;
    lines.push(`-- 源库无表 ${table}，跳过`);
    continue;
  }
  const srcCols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  const cols = targetCols.filter((c) => srcCols.includes(c));
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  counts[table] = rows.length;
  for (const row of rows) {
    const values = cols.map((c) => sqlValue(row[c])).join(', ');
    lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values});`);
  }
  lines.push('');
}
db.close();

writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(`已生成 ${outPath}`);
console.log('');
console.log('源库逐表行数（导入后请在 D1 用右侧查询逐表核对，应完全一致）：');
for (const [table, n] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(12)} ${String(n).padStart(6)}   核对：SELECT COUNT(*) FROM ${table};`);
}
console.log('');
console.log('注意：sessions 未迁移（旧 PHP 会话作废，用户重新登录即可）；');
console.log('导入会清掉 migrations 写入的种子管理员与默认分类，以旧库数据为准。');
