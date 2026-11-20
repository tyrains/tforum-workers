/* ============================================================
 * TForum PHP 版 · 前端交互
 * 所有 API 请求走 /api/xxx，统一 JSON 响应 {ok, data, error}
 * ============================================================ */

const CF = window.CFORUM || { base: '', locale: 'zh-CN', user: null };
const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

/* ---------- 通用工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

/** Toast 提示 */
function toast(msg, type = 'success') {
	const box = document.createElement('div');
	box.className = 'toast ' + (type === 'error' ? 'error' : '');
	box.textContent = msg;
	$('#toast-container')?.appendChild(box);
	setTimeout(() => { box.style.opacity = '0'; box.style.transform = 'translateX(30px)'; }, 3000);
	setTimeout(() => box.remove(), 3350);
}

/** API 请求 */
async function api(route, options = {}) {
	const { method = 'GET', body, form } = options;
	const config = { method, headers: { 'X-CSRF-Token': CSRF, 'Accept': 'application/json' } };
	if (form) {
		config.body = form;
	} else if (body !== undefined) {
		config.headers['Content-Type'] = 'application/json';
		config.body = JSON.stringify(body);
	}
	try {
		const res = await fetch('/api/' + route, config);
		const data = await res.json();
		if (!data.ok) {
			const error = new Error(data.error || '请求失败');
			error.status = res.status;
			error.data = data;
			throw error;
		}
		return data;
	} catch (e) {
		if (e instanceof SyntaxError) throw new Error('服务器响应异常，请检查 PHP 配置');
		throw e;
	}
}

/** 按钮加载态 */
function busy(btn, state) {
	if (!btn) return;
	if (state) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="loading"></span> 处理中…'; }
	else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

/** 弹窗 */
function showModal(html) {
	$('#modal-box').innerHTML = html;
	$('#modal-overlay').classList.add('show');
}
function closeModal() { $('#modal-overlay').classList.remove('show'); }
/* ---------- 页面就绪后统一绑定交互（保证页面内联脚本可先调用 api/toast/$$） ---------- */
document.addEventListener('DOMContentLoaded', () => {
$('#modal-overlay')?.addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

/* ---------- 头部交互 ---------- */
function togglePopover(id) {
	const el = document.getElementById(id);
	$$('.popover, .dropdown').forEach(p => { if (p !== el) p.classList.remove('show'); });
	el?.classList.toggle('show');
}
/* ---------- 主题切换：已实装主题按顺序依次循环 ----------
 * 顶栏按钮每点一次切到「下一个」主题；设置页卡片可直接指定主题。
 * 主题清单、顺序、样式表路径均由服务端注册表注入，前端不写死任何主题名。
 */
const THEME_NAMES = CF.themes || { editorial: '杂志编辑风', tool: '默认工具风' };
const THEME_ORDER = Array.isArray(CF.themeOrder) && CF.themeOrder.length ? CF.themeOrder : ['editorial', 'tool'];
const THEME_CSS = CF.themeCss || {};
function currentTheme() {
	// 优先读 body 上现存的 theme-* 类，兼容 bfcache 与外部脚本改写
	for (const id of THEME_ORDER) {
		if (document.body.classList.contains('theme-' + id)) return id;
	}
	const meta = document.querySelector('meta[name="theme"]')?.content;
	return THEME_ORDER.includes(meta) ? meta : (THEME_ORDER.includes(CF.theme) ? CF.theme : 'tool');
}
function nextTheme(id) {
	const pos = THEME_ORDER.indexOf(id);
	return THEME_ORDER[(pos + 1) % THEME_ORDER.length];
}
/** 无刷新切换主题样式表：有专属 CSS 就加载，内置主题则移除 */
function swapThemeStyle(id) {
	const href = THEME_CSS[id] || '';
	let link = document.getElementById('theme-style');
	if (!href) {
		if (link) link.remove();
		return;
	}
	if (!link) {
		link = document.createElement('link');
		link.id = 'theme-style';
		link.rel = 'stylesheet';
		document.head.appendChild(link);
	}
	if (link.getAttribute('href') !== href) link.href = href;
}
function applyTheme(theme, announce = true) {
	if (!THEME_ORDER.includes(theme)) theme = 'tool';
	// 移除全部已知主题类，再加目标类（数量固定且极小，性能无碍）
	THEME_ORDER.forEach(id => document.body.classList.remove('theme-' + id));
	document.body.classList.add('theme-' + theme);
	swapThemeStyle(theme);
	// 立即写 Cookie，保证刷新前后一致；同时走 API 做服务端校验与持久化
	document.cookie = 'cforum_theme=' + theme + ';path=/;max-age=31536000;samesite=Lax';
	CF.theme = theme; // 保持内部状态与页面一致，避免后续判断拿到旧值
	$$('.theme-chip').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
	const meta = document.querySelector('meta[name="theme"]');
	if (meta) meta.content = theme;
	const next = nextTheme(theme);
	const tip = '切换主题 · 当前：' + (THEME_NAMES[theme] || theme) + '（点击切换为 ' + (THEME_NAMES[next] || next) + '）';
	const btn = $('#theme-toggle');
	if (btn) {
		btn.title = tip;
		btn.setAttribute('aria-label', tip);
		btn.dataset.themeTarget = next;
		// 链接兜底地址始终指向「下一个主题」：万一 JS 失效，点击照样能切换
		try {
			const u = new URL(btn.href, location.href);
			u.searchParams.set('theme', next);
			btn.href = u.pathname + u.search + u.hash;
		} catch (_) {}
	}
	api('user/theme', { method: 'POST', body: { theme } }).catch(() => {});
	if (announce) toast('已切换为「' + (THEME_NAMES[theme] || theme) + '」');
}
$('#theme-toggle')?.addEventListener('click', e => {
	e.preventDefault(); // JS 可用时无刷新切换；不可用时链接交给服务端兜底
	e.stopPropagation();
	const target = nextTheme(currentTheme());
	applyTheme(target);
	// 极端情况（脚本被外部注入打断、DOM 未更新）时，退回整页跳转保证一定生效
	const btn = $('#theme-toggle');
	if (btn && !document.body.classList.contains('theme-' + target)) {
		location.href = btn.href;
	}
	$$('.popover, .dropdown').forEach(p => p.classList.remove('show'));
});
// 顶栏用户菜单：点击展开，点击页面其他地方收起（语言切换按钮已移除，全站仅用简体中文）
$('#user-toggle')?.addEventListener('click', e => { e.stopPropagation(); togglePopover('user-dropdown'); });
document.addEventListener('click', () => $$('.popover, .dropdown').forEach(p => p.classList.remove('show')));
$$('.theme-chip').forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

// 帖子详情：根据正文二级标题生成右侧目录
const tocList = document.getElementById('toc-list');
if (tocList) {
	$$('.detail-body h2').forEach((h, i) => {
		h.id = 'toc-' + i;
		const a = document.createElement('a');
		a.href = '#toc-' + i;
		a.textContent = h.textContent.trim();
		tocList.appendChild(a);
	});
}
$$('[data-action="logout"]').forEach(btn => btn.addEventListener('click', async () => {
	try { await api('logout', { method: 'POST' }); location.href = '/'; } catch (e) { toast(e.message, 'error'); }
}));

/* ---------- 通用表单提交 ---------- */
$$('form[data-ajax]').forEach(form => form.addEventListener('submit', async e => {
	e.preventDefault();
	const btn = form.querySelector('[type="submit"]');
	busy(btn, true);
	try {
		const route = form.dataset.ajax;
		const method = form.dataset.method || 'POST';
		let res;
		if (form.dataset.formdata === '1') {
			res = await api(route, { method, form: new FormData(form) });
		} else {
			const payload = Object.fromEntries(new FormData(form).entries());
			res = await api(route, { method, body: payload });
		}
		const redirect = form.dataset.redirect;
		if (redirect) {
			location.href = redirect.replace('{id}', res.data?.id ?? '');
		} else if (form.dataset.reload === '1') {
			location.reload();
		} else {
			toast(res.message || '操作成功');
		}
	} catch (err) {
		toast(err.message, 'error');
	} finally {
		busy(btn, false);
	}
}));

/* ---------- 帖子列表：点赞 ---------- */
$$('.like-btn').forEach(btn => btn.addEventListener('click', async () => {
	const postId = btn.dataset.post;
	if (!CF.user) { location.href = '/login'; return; }
	try {
		const res = await api(`posts/${postId}/like`, { method: 'POST' });
		const liked = res.data.liked;
		btn.classList.toggle('liked', liked);
		btn.querySelector('.heart')?.classList.add('heart');
		const countEl = btn.querySelector('.like-count');
		if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent) + (liked ? 1 : -1));
	} catch (e) { toast(e.message, 'error'); }
}));

/* ---------- Markdown 编辑器 ---------- */
function initEditor() {
	const textarea = $('#editor-textarea');
	if (!textarea) return;
	const wrapText = (before, after = before, placeholder = '文字') => {
		const start = textarea.selectionStart, end = textarea.selectionEnd;
		const selected = textarea.value.slice(start, end) || placeholder;
		textarea.value = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
		textarea.focus();
		textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
		updatePreview();
	};
	$$('[data-md]').forEach(btn => btn.addEventListener('click', () => {
		const actions = {
			bold: ['**', '**', '粗体'], italic: ['*', '*', '斜体'], strike: ['~~', '~~', '删除线'],
			code: ['`', '`', '代码'], h2: ['## ', '', '标题'], quote: ['> ', '', '引用'],
			ul: ['- ', '', '列表'], link: ['[', '](https://)', '链接文字'],
			image: ['![', '](图片地址)', '图片描述']
		};
		const a = actions[btn.dataset.md];
		if (a) wrapText(a[0], a[1], a[2]);
	}));
	let previewTimer;
	const updatePreview = () => {
		clearTimeout(previewTimer);
		previewTimer = setTimeout(async () => {
			const target = $('#editor-preview');
			if (!target) return;
			if (!textarea.value.trim()) { target.innerHTML = '<span style="color:var(--muted-foreground)">预览区</span>'; return; }
			try {
				const res = await api('markdown/render', { method: 'POST', body: { content: textarea.value } });
				target.innerHTML = res.data.html;
			} catch { target.textContent = textarea.value.slice(0, 500); }
		}, 350);
	};
	textarea.addEventListener('input', updatePreview);
	$('#editor-upload')?.addEventListener('change', async e => {
		const file = e.target.files[0]; if (!file) return;
		const fd = new FormData(); fd.append('image', file);
		toast('上传中…');
		try {
			const res = await api('upload', { method: 'POST', form: fd });
			wrapText('![图片](' + res.data.url + ')', '', '');
			toast('图片已插入');
		} catch (err) { toast(err.message, 'error'); }
	});
}
initEditor();

/* ---------- 评论回复 ---------- */
$$('[data-reply]').forEach(btn => btn.addEventListener('click', () => {
	const form = $('#comment-form');
	const parent = btn.dataset.reply;
	if (!form) return;
	let input = form.querySelector('[name="parent_id"]');
	if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = 'parent_id'; form.appendChild(input); }
	input.value = parent;
	form.querySelector('[name="content"]')?.focus();
	toast('正在回复，输入内容后提交');
}));

/* ---------- 删除确认 ---------- */
$$('[data-confirm]').forEach(btn => btn.addEventListener('click', async () => {
	const msg = btn.dataset.confirm || '确定要删除吗？';
	if (!confirm(msg)) return;
	try {
		await api(btn.dataset.delete, { method: 'DELETE' });
		toast('已删除');
		setTimeout(() => location.reload(), 400);
	} catch (e) { toast(e.message, 'error'); }
}));

/* ---------- 管理后台：标签切换 ---------- */
$$('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
	const group = btn.dataset.tabGroup || 'default';
	$$(`[data-tab-group="${group}"]`).forEach(b => b.classList.remove('active'));
	$$(`[data-panel-group="${group}"]`).forEach(p => p.classList.remove('active'));
	btn.classList.add('active');
	document.getElementById('panel-' + btn.dataset.tab)?.classList.add('active');
}));

/* ---------- 管理操作按钮 ---------- */
$$('[data-admin-action]').forEach(btn => btn.addEventListener('click', async () => {
	const route = btn.dataset.adminAction;
	const payload = JSON.parse(btn.dataset.payload || '{}');
	if (btn.dataset.ask && !confirm(btn.dataset.ask)) return;
	try {
		await api(route, { method: 'POST', body: payload });
		toast('操作成功');
		setTimeout(() => location.reload(), 400);
	} catch (e) { toast(e.message, 'error'); }
}));

/* ---------- 分类/筛选自动跳转 ---------- */
$$('[data-auto-submit]').forEach(el => el.addEventListener('change', () => el.form?.submit()));

/* ---------- 后台设置表单保存 ---------- */
$('#settings-form-admin')?.addEventListener('submit', async e => {
	e.preventDefault();
	const form = e.target;
	const titleInput = form.querySelector('[name="site_title"]');
	if (titleInput) {
		const v = titleInput.value.trim();
		if (v.length > 20) { toast('站点名称不能超过 20 个字符', 'error'); return; }
		titleInput.value = v; // 去掉首尾空白后再提交，空值由后端回退默认名
	}
	const btn = form.querySelector('[type="submit"]');
	busy(btn, true);
	const payload = Object.fromEntries(new FormData(form).entries());
	try { await api('admin/settings', { method: 'POST', body: payload }); toast('设置已保存'); }
	catch (err) { toast(err.message, 'error'); }
	finally { busy(btn, false); }
});

/* ---------- 首页无限分页（可选，data-next 存在时启用） ---------- */
const loadMoreBtn = $('#load-more');
if (loadMoreBtn) loadMoreBtn.addEventListener('click', async () => {
	const next = parseInt(loadMoreBtn.dataset.next);
	if (!next) return;
	busy(loadMoreBtn, true);
	try {
		const params = new URLSearchParams(location.search);
		params.set('offset', String(next));
		const res = await api('posts?' + params.toString());
		const list = $('#post-list');
		res.data.posts.forEach(p => list.insertAdjacentHTML('beforeend', renderPostItem(p)));
		loadMoreBtn.dataset.next = String(next + res.data.posts.length);
		if (res.data.posts.length === 0) loadMoreBtn.remove();
	} catch (e) { toast(e.message, 'error'); }
	finally { busy(loadMoreBtn, false); }
});
});

function renderPostItem(p) {
	return `<article class="post-item card">
		<img class="post-author-avatar" src="${esc(p.author_avatar || '/api/avatar?id=' + p.author_id)}" alt="">
		<div class="post-main">
			<h3 class="post-title"><a href="/post/${p.id}">${esc(p.title)}</a></h3>
			<p class="post-excerpt">${esc(p.excerpt || '')}</p>
			<div class="post-meta">
				<span class="cat">${esc(p.category_name || '未分类')}</span>
				<span>${esc(p.author_name)}</span><span>${esc(p.created_at)}</span>
			</div>
		</div>
		<div class="post-stats"><span>❤ ${p.like_count || 0}</span><span>💬 ${p.comment_count || 0}</span><span>👁 ${p.view_count || 0}</span></div>
	</article>`;
}

/* ---------- 图片加载失败兜底 ----------
 * 任何头像 / 插图资源失效（路径变更、主机限制、缓存旧地址）时，
 * 用内联 SVG 占位，避免页面出现破图图标或 alt 文字。
 * 在 head 中注册捕获阶段监听，确保早于图片加载。
 */
(function () {
	const AVATAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#8b5cf6"/><circle cx="50" cy="38" r="16" fill="#ffffff" opacity=".92"/><path d="M22 86c3-18 14-27 28-27s25 9 28 27" fill="#ffffff" opacity=".92"/></svg>';
	const DOC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="12" width="60" height="76" rx="8" fill="#f1ecfd" stroke="#8b5cf6" stroke-width="4"/><path d="M34 38h32M34 52h32M34 66h20" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round"/></svg>';
	document.addEventListener('error', (e) => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement) || img.dataset.fallbackApplied) return;
		img.dataset.fallbackApplied = '1';
		const isAvatar = /avatar/i.test(img.className || '');
		img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(isAvatar ? AVATAR_SVG : DOC_SVG);
	}, true);
})();
