/**
 * D1 数据层：对应 PHP 版 lib/db.php 的 q/one/all/val/run 封装。
 * 全部使用 Prepared Statements（bind 参数），与 PDO 预处理语义一致。
 */
export type Row = Record<string, any>;

export class Db {
  constructor(private d1: D1Database) {}

  /** 执行写操作，返回受影响行数与自增 ID（对应 PDOStatement::rowCount + lastInsertId） */
  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastRowId: number }> {
    const r = await this.d1.prepare(sql).bind(...params).run();
    return { changes: r.meta.changes ?? 0, lastRowId: Number(r.meta.last_row_id ?? 0) };
  }

  /** 取一行，无结果返回 null（对应 one()） */
  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    return await this.d1.prepare(sql).bind(...params).first<T>();
  }

  /** 取多行（对应 all()） */
  async all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.d1.prepare(sql).bind(...params).all<T>();
    return r.results ?? [];
  }

  /** 取单值（对应 val() 的 fetchColumn；无行返回 null） */
  async val(sql: string, params: unknown[] = []): Promise<any> {
    const row = await this.d1.prepare(sql).bind(...params).first<Row>();
    if (!row) return null;
    const keys = Object.keys(row);
    return keys.length ? row[keys[0]] : null;
  }

  /** 批量执行（D1 batch 为原子事务，对应 PHP 的 beginTransaction/commit） */
  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (statements.length === 0) return;
    const stmts = statements.map((s) => this.d1.prepare(s.sql).bind(...(s.params ?? [])));
    await this.d1.batch(stmts);
  }
}

/**
 * 严格整数解析（对应 PHP 的 FILTER_VALIDATE_INT 口径）：必须是纯十进制整数，
 * 非法或越界一律回落默认值——避免 "10abc" 被强转成 10、0/负数导致分页除零。
 */
export function strictIntValue(raw: string, def: number, min: number, max: number): number {
  const s = String(raw ?? '').trim();
  if (!/^[+-]?\d+$/.test(s)) return def;
  const n = parseInt(s, 10);
  return n < min || n > max ? def : n;
}

/**
 * 站点设置读写：对应 db.php 的 setting()/set_setting()/all_settings()。
 * 每个请求加载一次全量设置（约 34 行）并缓存。
 */
export class Settings {
  private cache = new Map<string, string>();
  private loaded = false;

  constructor(private db: Db) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const rows = await this.db.all('SELECT "key", value FROM settings');
    for (const r of rows) this.cache.set(String(r.key), r.value == null ? '' : String(r.value));
    this.loaded = true;
  }

  async get(key: string, def = ''): Promise<string> {
    await this.load();
    return this.cache.has(key) ? (this.cache.get(key) as string) : def;
  }

  async bool(key: string): Promise<boolean> {
    return (await this.get(key, '0')) === '1';
  }

  /** 整数型设置（每页帖子数、字数上限等后台可调数值共用）：解析失败回落默认值，结果钳制在 [min, max] */
  async int(key: string, def: number, min: number, max: number): Promise<number> {
    const n = parseInt(await this.get(key, String(def)), 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
  }

  /** 严格整数型设置（对应 PHP v2 的 FILTER_VALIDATE_INT 钳制读法）：非法/越界回落默认值，不钳边 */
  async strictInt(key: string, def: number, min: number, max: number): Promise<number> {
    return strictIntValue(await this.get(key, ''), def, min, max);
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run('INSERT OR REPLACE INTO settings ("key", value) VALUES (?, ?)', [key, value]);
    this.cache.set(key, value);
  }

  async allMap(): Promise<Record<string, string>> {
    await this.load();
    return Object.fromEntries(this.cache);
  }
}
