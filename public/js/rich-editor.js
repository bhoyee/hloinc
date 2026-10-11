/*
 * Formatted text editor (portal: email replies, job descriptions). Progressive:
 * without JS the plain textarea is used. With JS, a toolbar and an editable box
 * replace it; on send, the formatting goes in the hidden `<name>_html` field
 * (cleaned again on the server) and the plain text in the textarea's field.
 * Markup: src/views/partials/rich-editor.njk.
 */
(() => {
  'use strict';

  document.querySelectorAll('[data-rich-editor]').forEach((wrap) => {
    const textarea = wrap.querySelector('textarea');
    const hidden = wrap.querySelector('input[data-rich-html]') || wrap.querySelector('input[name$="_html"]');
    const box = wrap.querySelector('[data-rich-box]');
    const toolbar = wrap.querySelector('[data-rich-toolbar]');
    const count = wrap.querySelector('[data-rich-count]');
    const linkPanel = wrap.querySelector('[data-rich-link]');
    const linkInput = linkPanel && linkPanel.querySelector('input');
    const form = wrap.closest('form');
    if (!textarea || !box || !toolbar || !form) return;

    const max = Number(textarea.maxLength) || 5000;
    // Start from the saved formatting if the page gave it; otherwise from what was typed before
    // (e.g. after an error), as paragraphs.
    if (!box.innerHTML.trim() && textarea.value.trim()) {
      box.innerHTML = textarea.value.trim().split(/\n{2,}/).map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\n/g, '<br>')}</p>`).join('');
    }
    textarea.hidden = true;
    textarea.removeAttribute('required');
    wrap.querySelectorAll('[data-rich-only]').forEach((el) => { el.hidden = false; });
    document.execCommand('defaultParagraphSeparator', false, 'p');

    const plain = () => box.innerText.replace(/ /g, ' ').trim();
    const update = () => {
      const n = plain().length;
      box.classList.toggle('is-empty', n === 0);
      if (count) {
        count.textContent = `${n.toLocaleString()} / ${max.toLocaleString()}`;
        count.classList.toggle('text-accent-700', n > max);
      }
      toolbar.querySelectorAll('[data-cmd]').forEach((b) => {
        let on = false;
        try { on = document.queryCommandState(b.dataset.cmd); } catch { /* not a state command */ }
        b.setAttribute('aria-pressed', String(Boolean(on)));
      });
    };

    // Keep the selection, so toolbar buttons and the link box act on the right text.
    let saved = null;
    const keep = () => {
      const sel = window.getSelection();
      if (sel.rangeCount && box.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
    };
    const restore = () => {
      // Copy first: focusing the box fires our "remember the selection" handler, which would overwrite it.
      const range = saved;
      box.focus();
      if (range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        saved = range;
      }
    };
    // Always type inside a paragraph, so formatting and lists behave predictably.
    const ensureParagraph = () => {
      if (!box.firstElementChild || box.innerHTML === '<br>') {
        box.innerHTML = '<p><br></p>';
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(box.firstElementChild, 0);
        r.collapse(true);
        if (document.activeElement === box) { sel.removeAllRanges(); sel.addRange(r); }
      }
    };
    box.addEventListener('focus', ensureParagraph);
    box.addEventListener('input', () => { if (!box.textContent && !box.querySelector('li')) ensureParagraph(); });
    ['keyup', 'mouseup', 'input', 'focus'].forEach((ev) => box.addEventListener(ev, () => { keep(); update(); }));
    document.addEventListener('selectionchange', () => { if (document.activeElement === box) { keep(); update(); } });

    toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // don't steal the selection
    toolbar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      restore();
      if (b.dataset.cmd === 'createLink') {
        linkPanel.hidden = false;
        const a = window.getSelection().anchorNode;
        const existing = a && (a.nodeType === 1 ? a : a.parentElement).closest('a');
        linkInput.value = existing ? existing.getAttribute('href') : 'https://';
        linkInput.focus();
        linkInput.select();
        return;
      }
      if (b.dataset.cmd === 'formatBlock') document.execCommand('formatBlock', false, document.queryCommandValue('formatBlock') === 'blockquote' ? 'p' : 'blockquote');
      else document.execCommand(b.dataset.cmd, false, null);
      // Lists and quotes can bring back a style switched off just before Enter.
      if (['insertOrderedList', 'insertUnorderedList', 'formatBlock'].includes(b.dataset.cmd)) keepOff();
      else if (STYLES.includes(b.dataset.cmd)) offBeforeEnter = null;
      update();
    });

    // Text size: Small / Normal / Large / Huge for the paragraph(s) or list item(s) the cursor or
    // selection is in. A class on the block (rt-small / rt-large / rt-huge), the same classes the
    // server keeps (lib/richText), so what you see is what's sent.
    const sizeSelect = toolbar.querySelector('[data-rich-size]');
    const SIZE_CLASSES = ['rt-small', 'rt-large', 'rt-huge'];
    const blocksInSelection = () => {
      const sel = window.getSelection();
      if (!sel.rangeCount) return [];
      const range = sel.getRangeAt(0);
      const blocks = [...box.querySelectorAll('p, li')].filter((el) => range.intersectsNode(el));
      if (blocks.length) return blocks;
      const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const own = node && node.closest('p, li');
      return own && box.contains(own) ? [own] : [];
    };
    const showSize = () => {
      if (!sizeSelect) return;
      const [first] = blocksInSelection();
      const cls = first && SIZE_CLASSES.find((c) => first.classList.contains(c));
      sizeSelect.value = cls || '';
    };
    if (sizeSelect) {
      sizeSelect.addEventListener('mousedown', keep);
      sizeSelect.addEventListener('change', () => {
        restore();
        let blocks = blocksInSelection();
        if (!blocks.length) {
          ensureParagraph();
          blocks = blocksInSelection();
        }
        blocks.forEach((b) => {
          b.classList.remove(...SIZE_CLASSES);
          if (sizeSelect.value) b.classList.add(sizeSelect.value);
          if (!b.classList.length) b.removeAttribute('class');
        });
        box.dispatchEvent(new Event('input'));
        update();
      });
      document.addEventListener('selectionchange', () => { if (document.activeElement === box) showSize(); });
    }

    // Link box: https://, http://, mailto: or tel: only (the server checks again).
    if (linkPanel) {
      const close = () => { linkPanel.hidden = true; restore(); };
      const apply = () => {
        let url = linkInput.value.trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) url = `mailto:${url}`;
        if (url && !/^(https?:\/\/|mailto:|tel:)/i.test(url)) url = `https://${url}`;
        linkPanel.hidden = true;
        restore();
        if (!url || url === 'https://') document.execCommand('unlink');
        else if (window.getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '%22')}">${url.replace(/^mailto:|^tel:/, '').replace(/[&<>]/g, '')}</a>`);
        else document.execCommand('createLink', false, url);
        update();
      };
      linkPanel.querySelector('[data-link-apply]').addEventListener('click', apply);
      linkPanel.querySelector('[data-link-cancel]').addEventListener('click', close);
      linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }

    // Paste as plain text, so formatting from Word or web pages doesn't come along.
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // Chrome forgets a style you just switched off when you press Enter (bold carries on into the
    // next line). Remember what was off before Enter and keep it off on the new line.
    const STYLES = ['bold', 'italic', 'underline', 'strikeThrough'];
    let offBeforeEnter = null;
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) offBeforeEnter = STYLES.filter((c) => !document.queryCommandState(c));
    });
    const keepOff = () => {
      if (!offBeforeEnter) return;
      offBeforeEnter.forEach((c) => { if (document.queryCommandState(c)) document.execCommand(c); });
      update();
    };
    box.addEventListener('input', (e) => {
      if (e.inputType === 'insertParagraph') keepOff();
      else if (e.inputType && e.inputType.startsWith('insertText')) offBeforeEnter = null; // you've typed: your choice now
    });

    // Ctrl/Cmd+K: link.
    box.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toolbar.querySelector('[data-cmd="createLink"]').click();
      }
    });

    const min = Number(wrap.dataset.min || 0);
    const label = wrap.dataset.label || 'This';
    form.addEventListener('submit', (e) => {
      const text = plain();
      const error = wrap.querySelector('[data-rich-error]');
      if ((min && text.length < min) || text.length > max) {
        e.preventDefault();
        box.focus();
        error.hidden = false;
        error.querySelector('span').textContent = text.length > max
          ? `Keep ${label.toLowerCase()} under ${max.toLocaleString()} characters.`
          : text.length === 0 ? `Write ${label.toLowerCase()} first.` : `Add a little more to ${label.toLowerCase()} (at least ${min} characters).`;
        return;
      }
      error.hidden = true;
      hidden.value = text ? box.innerHTML : '';
      textarea.value = text;
    });

    update();
  });
})();
