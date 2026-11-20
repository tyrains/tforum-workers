/**
 * 主题注册表（唯一真相源）：对应 PHP 版 v2 新增的 lib/theme-registry.php，逐项平移。
 * ------------------------------------------------------------------
 * 论坛原有 2 套内置主题 editorial / tool 的元数据与样式都保持原样，
 * 本文件只做「登记」：把 12 个主题的 id / 名称 / 明暗 / 样式文件 / 缩略色块
 * 收拢到一处，供切换入口、白名单校验、后台默认主题设置共用。
 *
 * 字段说明：
 *   name      中文显示名（新主题只提供简中，其余语言由 t() 回退到中文）
 *   nameKey   翻译键；内置两套沿用旧键以保留 5 语言行为，新主题留空
 *   mode      light / dark，供后台与 THEMES.md 标注
 *   css       额外样式文件（相对站点根）；内置两套为 null，表示完全沿用旧样式
 *   swatch    [底色, 强调色]，用于设置页色块预览
 *   ready     true 表示已实装、可切换。当前 11 套启用；Bento 便当格按用户要求停用（CSS 文件保留，可随时恢复）
 *   builtin   true 表示论坛原有内置主题，行为/外观不得改动
 */
import type { Ctx } from './ctx';
import { t } from './i18n';

export interface ThemeMeta {
  name: string;
  nameKey: string;
  mode: 'light' | 'dark';
  css: string | null;
  swatch: [string, string];
  ready: boolean;
  builtin: boolean;
}

/** 全部主题登记（顺序即顶栏「依次切换」的顺序，与 PHP 注册表一致） */
export const THEME_REGISTRY: Record<string, ThemeMeta> = {
  'editorial': { name: '杂志编辑风', nameKey: 'theme_editorial', mode: 'light', css: null, swatch: ['#fbf9f4', '#b44630'], ready: true, builtin: true },
  'tool': { name: '默认工具风', nameKey: 'theme_tool', mode: 'light', css: null, swatch: ['#ffffff', '#4f46e5'], ready: true, builtin: true },
  'editorial-poster-ui': { name: '编辑海报', nameKey: '', mode: 'light', css: 'assets/css/themes/editorial-poster-ui.css', swatch: ['#f6f1e7', '#a83a1c'], ready: true, builtin: false },
  'asymmetric-zinc-ui': { name: '不对称锌色', nameKey: '', mode: 'light', css: 'assets/css/themes/asymmetric-zinc-ui.css', swatch: ['#fafaf8', '#8f4f16'], ready: true, builtin: false },
  'bento-grid-ui': { name: 'Bento 便当格', nameKey: '', mode: 'light', css: 'assets/css/themes/bento-grid-ui.css', swatch: ['#f4f4f6', '#0b4bc0'], ready: false, builtin: false },
  'linear-style-ui': { name: 'Linear 暗色', nameKey: '', mode: 'dark', css: 'assets/css/themes/linear-style-ui.css', swatch: ['#0f1011', '#5e6ad2'], ready: true, builtin: false },
  'zinc-spotlight-ui': { name: 'Zinc 聚光', nameKey: '', mode: 'dark', css: 'assets/css/themes/zinc-spotlight-ui.css', swatch: ['#09090b', '#a3e635'], ready: true, builtin: false },
  'liquid-glass-ui': { name: '液态玻璃', nameKey: '', mode: 'light', css: 'assets/css/themes/liquid-glass-ui.css', swatch: ['#dceeff', '#0066cc'], ready: true, builtin: false },
  'botanical-garden-ui': { name: '植物花园', nameKey: '', mode: 'light', css: 'assets/css/themes/botanical-garden-ui.css', swatch: ['#f3f5ec', '#2f5233'], ready: true, builtin: false },
  'classic-tokens-ui': { name: '经典令牌', nameKey: '', mode: 'light', css: 'assets/css/themes/classic-tokens-ui.css', swatch: ['#fbfbf8', '#0b7285'], ready: true, builtin: false },
  'agency-luxury-ui': { name: '高端代理', nameKey: '', mode: 'dark', css: 'assets/css/themes/agency-luxury-ui.css', swatch: ['#0d0b09', '#c8a24b'], ready: true, builtin: false },
  'strict-guidelines-ui': { name: '规范严格', nameKey: '', mode: 'light', css: 'assets/css/themes/strict-guidelines-ui.css', swatch: ['#ffffff', '#0057c2'], ready: true, builtin: false },
};

/** 全部主题 id（顺序即顶栏「依次切换」的顺序） */
export function themeIds(readyOnly = false): string[] {
  return Object.keys(THEME_REGISTRY).filter((id) => !readyOnly || THEME_REGISTRY[id].ready);
}

/** 当前已实装、可切换的主题 id（排除 ready=false 的主题） */
export function themeEnabledIds(): string[] {
  return themeIds(true);
}

/** 主题是否可切换（未实装的 id 一律视为非法，回落默认工具风） */
export function themeIsValid(id: string): boolean {
  return themeEnabledIds().includes(id);
}

/** 取单个主题元数据；不存在返回 null */
export function themeMeta(id: string): ThemeMeta | null {
  return THEME_REGISTRY[id] ?? null;
}

/** 显示名：内置两套走翻译键保留多语言，新主题只显示简中 */
export function themeDisplayName(ctx: Ctx, id: string): string {
  const meta = themeMeta(id);
  if (!meta) return '默认工具风';
  return meta.nameKey !== '' ? t(ctx, meta.nameKey, {}, meta.name) : meta.name;
}

/** 显示名映射（注入给前端 Toast 使用） */
export function themeNamesMap(ctx: Ctx, readyOnly = true): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of themeIds(readyOnly)) map[id] = themeDisplayName(ctx, id);
  return map;
}

/** 依次循环取下一个可切换主题 */
export function themeNext(id: string): string {
  const ids = themeEnabledIds();
  if (ids.length === 0) return 'tool';
  const pos = ids.indexOf(id);
  return ids[(pos === -1 ? 0 : pos + 1) % ids.length];
}

/** 主题额外样式路径（内置两套返回 null） */
export function themeCssPath(id: string): string | null {
  const meta = themeMeta(id);
  return meta && meta.css ? meta.css : null;
}
