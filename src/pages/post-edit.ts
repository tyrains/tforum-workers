/** 发帖 / 编辑帖子页（对应 pages/post-edit.php，链接改干净路径） */
import type { Ctx } from '../lib/ctx';
import { e, redirect } from '../lib/core';
import { pageRequireUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { showFlash } from '../lib/layout';
import type { Row } from '../lib/db';

export async function renderPostEdit(ctx: Ctx): Promise<string> {
  const user = await pageRequireUser(ctx);
  const postId = ctx.intParam('id', 0);
  let post: Row | null = null;

  if (postId) {
    post = await ctx.db.one('SELECT * FROM posts WHERE id = ?', [postId]);
    if (!post) {
      ctx.flash('error', '帖子不存在');
      redirect('/');
    }
    const p = post as Row;
    if (Number(p.author_id) !== Number(user.id) && user.role !== 'admin') {
      ctx.flash('error', '无权编辑此帖子');
      redirect('/post/' + postId);
    }
  }

  const categories = await ctx.db.all('SELECT * FROM categories ORDER BY id') as Row[];
  const postMax = await ctx.settings.strictInt('post_max_length', 20000, 1, 1000000);
  const isEdit = Boolean(post);
  const p = post as Row | null;

  let h = '';
  h += '<div class="page-heading">\n\t<div>\n';
  h += `\t\t<h1>${isEdit ? '✏️ ' + e(t(ctx, 'edit', {}, '编辑帖子')) : '✏️ ' + e(t(ctx, 'newPost', {}, '发起新帖'))}</h1>\n`;
  h += '\t\t<div class="sub">支持 Markdown 语法，让内容更漂亮</div>\n\t</div>\n';
  h += '\t<a class="btn btn-outline btn-sm" href="/">← 返回列表</a>\n</div>\n\n';
  h += showFlash(ctx) + '\n\n';
  h += `<form id="post-form" data-ajax="${isEdit ? 'posts/' + postId : 'posts'}" data-method="${isEdit ? 'PUT' : 'POST'}" data-redirect="${isEdit ? '/post/' + postId : '/post/{id}'}">\n`;
  h += '\t<div class="card" style="padding:26px">\n';
  h += '\t\t<div class="field">\n\t\t\t<label for="post-title">📝 标题 <span style="color:var(--destructive)">*</span></label>\n';
  h += `\t\t\t<input class="input" id="post-title" name="title" maxlength="30" required\n\t\t\t\tvalue="${e(p?.title ?? '')}" placeholder="给你的帖子起个吸引人的标题（最多 30 字）">\n\t\t</div>\n\n`;
  h += '\t\t<div class="field">\n\t\t\t<label for="post-category">🏷️ 分类</label>\n\t\t\t<select class="select" id="post-category" name="category_id">\n\t\t\t\t<option value="">未分类</option>\n';
  for (const cat of categories) {
    const selected = p && p.category_id !== null && p.category_id !== undefined && Number(p.category_id) === Number(cat.id) ? 'selected' : '';
    h += `\t\t\t\t<option value="${Number(cat.id)}" ${selected}>${e(cat.name)}</option>\n`;
  }
  h += '\t\t\t</select>\n\t\t</div>\n\n';
  h += '\t\t<div class="field">\n\t\t\t<label>📄 正文 <span style="color:var(--destructive)">*</span></label>\n';
  h += '\t\t\t<div class="editor-toolbar">\n';
  h += '\t\t\t\t<button type="button" data-md="bold" title="粗体"><b>B</b></button>\n';
  h += '\t\t\t\t<button type="button" data-md="italic" title="斜体"><i>I</i></button>\n';
  h += '\t\t\t\t<button type="button" data-md="strike" title="删除线"><s>S</s></button>\n';
  h += '\t\t\t\t<span style="width:1px;background:var(--border);margin:2px 3px"></span>\n';
  h += '\t\t\t\t<button type="button" data-md="h2" title="标题">H</button>\n';
  h += '\t\t\t\t<button type="button" data-md="quote" title="引用">❝</button>\n';
  h += '\t\t\t\t<button type="button" data-md="ul" title="列表">☰</button>\n';
  h += '\t\t\t\t<button type="button" data-md="code" title="行内代码">&lt;/&gt;</button>\n';
  h += '\t\t\t\t<span style="width:1px;background:var(--border);margin:2px 3px"></span>\n';
  h += '\t\t\t\t<button type="button" data-md="link" title="链接">🔗</button>\n';
  h += '\t\t\t\t<button type="button" data-md="image" title="图片">🖼</button>\n';
  h += '\t\t\t\t<label class="upload-label" title="上传图片">\n\t\t\t\t\t<button type="button" id="editor-upload" style="pointer-events:none">⬆️</button>\n\t\t\t\t\t<input type="file" id="editor-upload-input" accept="image/*" style="display:none">\n\t\t\t\t</label>\n\t\t\t</div>\n';
  h += `\t\t\t<textarea class="textarea" id="editor-textarea" name="content" rows="16" maxlength="${postMax}" required\n\t\t\t\tplaceholder="在这里写下你的内容…&#10;&#10;支持 Markdown：&#10;# 标题&#10;**粗体** *斜体*&#10;- 列表项&#10;![图片](地址)">${e(p?.content ?? '')}</textarea>\n`;
  h += `\t\t\t<span class="hint">最多 ${postMax} 字</span>\n\t\t</div>\n\n`;
  h += '\t\t<div class="field">\n\t\t\t<label>👀 实时预览</label>\n\t\t\t<div class="editor-preview markdown card" id="editor-preview" style="box-shadow:none">预览区</div>\n\t\t</div>\n\n';
  h += '\t\t<div style="display:flex;gap:10px;margin-top:22px">\n';
  h += `\t\t\t<button class="btn btn-primary btn-lg" type="submit">🚀 ${isEdit ? '保存修改' : '发布帖子'}</button>\n`;
  h += '\t\t\t<a class="btn btn-outline btn-lg" href="/">取消</a>\n\t\t</div>\n\t</div>\n</form>\n\n';
  h += `<script>
// 文件名 input 与按钮联动（因为按钮被 label 包住，需要转发点击）
document.getElementById('editor-upload-input')?.addEventListener('change', function(e) {
	const btn = document.getElementById('editor-upload');
	if (btn && e.target.files[0]) {
		const dt = new DataTransfer(); dt.items.add(e.target.files[0]);
		btn.parentElement.querySelector('input[type=file]');
	}
});
// 直接用 app.js 里的 #editor-upload change 监听，改成监听真正的 input
document.addEventListener('DOMContentLoaded', () => {
	const input = document.getElementById('editor-upload-input');
	const btn = document.getElementById('editor-upload');
	if (!input || !btn) return;
	btn.addEventListener('click', () => input.click());
	input.addEventListener('change', async (e) => {
		const file = e.target.files[0]; if (!file) return;
		const fd = new FormData(); fd.append('image', file);
		toast('上传中…');
		try {
			const res = await api('upload', { method: 'POST', form: fd });
			const ta = document.getElementById('editor-textarea');
			const pos = ta.selectionStart;
			const text = \`![图片](\${res.data.url})\`;
			ta.value = ta.value.slice(0, pos) + text + ta.value.slice(pos);
			ta.dispatchEvent(new Event('input'));
			toast('图片已插入');
		} catch (err) { toast(err.message, 'error'); }
	});
});
</script>\n`;
  return h;
}
