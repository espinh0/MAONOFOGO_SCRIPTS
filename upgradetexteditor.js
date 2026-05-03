// ==UserScript==
// @name         SALIC - TinyMCE 8 overlay (layout otimizado)
// @namespace    salic-tinymce8-overlay-clean
// @version      3.3
// @match        https://salic.cultura.gov.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '8.5.0';
  const BASE = `https://cdn.jsdelivr.net/npm/tinymce@${VERSION}`;
  const SRC = `${BASE}/tinymce.min.js`;

  const TEXTAREA_SELECTOR = 'textarea[name], textarea#resumodoprojeto';

  function decodeHtml(value) {
    const el = document.createElement('textarea');
    el.innerHTML = value || '';
    return el.value;
  }

  function loadTiny8() {
    return new Promise((resolve, reject) => {
      if (window.__tinymce8Loaded && window.tinymce?.majorVersion === '8') {
        resolve();
        return;
      }

      const oldTiny = window.tinymce || window.tinyMCE || null;

      const s = document.createElement('script');
      s.src = SRC;
      s.onload = () => {
        window.__tinymce8Loaded = true;
        window.__salicOldTinyMCE = oldTiny;
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function findOldEditorContainer(textarea) {
    if (!textarea.id) return null;
    const iframe = document.getElementById(textarea.id + '_ifr');
    return iframe?.closest('.mce-tinymce') || null;
  }

  function prepareTextarea(textarea) {
    textarea.style.display = 'block';
    textarea.style.visibility = 'hidden';
    textarea.style.position = 'absolute';
    textarea.style.left = '-99999px';
  }

  function createMirrorTextarea(source) {
    const mirror = document.createElement('textarea');

    mirror.id = `${source.id || source.name}_tinymce8_overlay`;
    mirror.value = decodeHtml(source.value);
    mirror.style.width = '100%';
    mirror.style.minHeight = '320px';

    const oldContainer = findOldEditorContainer(source);

    if (oldContainer) {
      oldContainer.style.display = 'none';
      oldContainer.insertAdjacentElement('afterend', mirror);
    } else {
      source.insertAdjacentElement('afterend', mirror);
    }

    return mirror;
  }

  function syncToSource(editor, source) {
    const html = editor.getContent();

    source.value = html;
    source.setAttribute('value', html);

    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.jQuery) {
      window.jQuery(source).val(html).trigger('input').trigger('change');
    }

    const oldTiny = window.__salicOldTinyMCE;

    try {
      const oldEditor =
        oldTiny?.get?.(source.id) ||
        oldTiny?.EditorManager?.get?.(source.id);

      if (oldEditor) {
        oldEditor.setContent(html);
        oldEditor.save();
      }
    } catch (e) {}
  }

  async function initTextarea(source) {
    if (source.dataset.tiny8) return;
    source.dataset.tiny8 = '1';

    prepareTextarea(source);
    const mirror = createMirrorTextarea(source);

    await tinymce.init({
      target: mirror,

      license_key: 'gpl',
      base_url: BASE,
      suffix: '.min',

      height: 420,

      menubar: 'edit view format tools help',
      toolbar: [
        'undo redo | blocks fontsize | bold italic underline strikethrough',
        'forecolor backcolor | alignleft aligncenter alignright alignjustify',
        'bullist numlist outdent indent',
        'removeformat | code fullscreen preview help'
      ].join(' '),

      plugins: [
        'lists',
        'code',
        'autoresize',
        'wordcount',
        'fullscreen',
        'preview',
        'charmap',
        'visualblocks',
        'searchreplace',
        'help'
      ].join(' '),

      // remove suporte a link e table
      contextmenu: false,

      fontsize_formats: '12px 14px 16px 18px 20px 24px 32px',

      paste_as_text: false,
      paste_webkit_styles: 'all',

      valid_elements: '*[*]',
      verify_html: false,

      content_style: `
        body {
          max-width: 1200px;
          margin: 32px auto;
          padding: 0 24px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          line-height: 1.6;
        }

        p {
          margin-bottom: 0.8em;
        }
      `,

      setup(editor) {
        editor.on('init', () => {
          editor.setContent(decodeHtml(source.value) || '');
          syncToSource(editor, source);
        });

        editor.on('change keyup input undo redo', () => {
          syncToSource(editor, source);
        });
      }
    });
  }

  async function boot() {
    await loadTiny8();

    const areas = document.querySelectorAll(TEXTAREA_SELECTOR);

    for (const ta of areas) {
      try {
        await initTextarea(ta);
      } catch (e) {
        console.error('Erro TinyMCE:', e);
        ta.style.visibility = 'visible';
      }
    }
  }

  function syncAll() {
    document.querySelectorAll('textarea[data-tiny8="1"]').forEach(source => {
      const id = `${source.id || source.name}_tinymce8_overlay`;
      const ed = tinymce.get(id);
      if (ed) syncToSource(ed, source);
    });
  }

  document.addEventListener('submit', syncAll, true);

  document.addEventListener('click', e => {
    const el = e.target.closest('button, input, a');
    if (!el) return;

    const txt = (el.innerText || el.value || '').toLowerCase();

    if (txt.includes('salvar') || txt.includes('enviar')) {
      syncAll();
    }
  }, true);

  setTimeout(boot, 1200);

})();