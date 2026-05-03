(function () {
  'use strict';

  const CONFIG = {
    apiName: '__tmPowerSalicUpgradeTextEditor',
    version: '1.0.1',
    settingKey: 'tm-salic-setting-alt-editor',
    settingEventName: 'tm-salic-setting-change',
    settingOn: '1',
    ignoreSelector: '.tm-localmem-ignore, [data-tm-localmem="off"]',
    reactSelectIgnoreSelector: '.tm-reactselect-wrapper, [data-tm-reactselect-host="1"]',
    styleId: 'tm-salic-upgrade-text-editor-css',
    quillCssId: 'tm-salic-quill-css',
    quillJsId: 'tm-salic-quill-js',
    quillCssUrl: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css',
    quillJsUrl: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js'
  };

  if (window[CONFIG.apiName] && window[CONFIG.apiName].version) {
    try {
      if (typeof window[CONFIG.apiName].dispose === 'function') {
        window[CONFIG.apiName].dispose();
      } else if (typeof window[CONFIG.apiName].apply === 'function') {
        window[CONFIG.apiName].apply();
      }
    } catch (_) {}
    if (window[CONFIG.apiName] && window[CONFIG.apiName].version === CONFIG.version) {
      try {
        window[CONFIG.apiName].apply();
      } catch (_) {}
      return;
    }
  }

  if (window.__tmPowerSalicUpgradeTextEditorLoading) {
    return;
  }
  window.__tmPowerSalicUpgradeTextEditorLoading = true;

  const STATE = {
    editors: new WeakMap(),
    quillPromise: null,
    observerTimer: null,
    observer: null,
    applying: false,
    pendingFields: new WeakSet()
  };

  function isEnabled() {
    try {
      if (typeof GM_getValue === 'function') {
        const stored = GM_getValue(CONFIG.settingKey, null);
        if (stored !== null && stored !== undefined) return stored === CONFIG.settingOn || stored === true;
      }
    } catch (_) {}
    try {
      return localStorage.getItem(CONFIG.settingKey) === CONFIG.settingOn;
    } catch (_) {
      return false;
    }
  }

  function getTinyMceEditor(field) {
    const tinymceGlobal = window.tinymce || window.tinyMCE;
    if (!tinymceGlobal || !field || !field.id) return null;
    try {
      return tinymceGlobal.get(field.id) || null;
    } catch (_) {
      return null;
    }
  }

  function getEditorIframe(field) {
    if (!field || field.tagName.toLowerCase() !== 'textarea') return null;
    if (!field.id) return null;
    return document.getElementById(`${field.id}_ifr`);
  }

  function getLegacyEditorToolbarRoot(iframe) {
    if (!iframe) return null;
    let node = iframe.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const hasToolbar = Boolean(node.querySelector(
        '.mce-toolbar, .mce-toolbar-grp, .mce-menubar, .tox-toolbar, .tox-toolbar__primary, .tox-editor-header, [role="toolbar"]'
      ));
      if (hasToolbar && node.contains(iframe)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function getEditorRoot(field) {
    if (!field || field.tagName.toLowerCase() !== 'textarea') return null;
    const iframe = getEditorIframe(field);
    if (field.id) {
      const knownRoot = document.getElementById(`${field.id}_tbl`)
        || document.getElementById(`${field.id}_parent`)
        || document.getElementById(`${field.id}_container`);
      if (knownRoot) return knownRoot;
    }
    const toolbarRoot = getLegacyEditorToolbarRoot(iframe);
    if (toolbarRoot) return toolbarRoot;
    const editor = getTinyMceEditor(field);
    if (editor && typeof editor.getContainer === 'function') {
      try {
        const container = editor.getContainer();
        if (container) return container;
      } catch (_) {}
    }
    if (!iframe) return null;
    return iframe.closest('.tox-tinymce')
      || iframe.closest('.mce-tinymce')
      || iframe.closest('.mceEditor')
      || iframe.closest('table.mceLayout')
      || iframe.closest('.mce-container')
      || iframe.closest('.mce-panel')
      || iframe.parentElement;
  }

  function getFieldValue(field) {
    const iframe = getEditorIframe(field);
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      return iframe.contentDocument.body.innerHTML || '';
    }
    return field.value || '';
  }

  function updateHiddenTextarea(field, value) {
    if (!field || field.tagName.toLowerCase() !== 'textarea') return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
  }

  function setLegacyEditorContent(field, value) {
    const nextValue = value === null || value === undefined ? '' : String(value);
    const editor = getTinyMceEditor(field);
    if (editor && typeof editor.setContent === 'function') {
      try {
        editor.setContent(nextValue);
      } catch (_) {}
    }
    const iframe = getEditorIframe(field);
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      try {
        iframe.contentDocument.body.innerHTML = nextValue;
      } catch (_) {}
    }
    updateHiddenTextarea(field, nextValue);
  }

  function dispatchFieldChange(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isEligibleField(field) {
    if (!field) return false;
    const tag = field.tagName ? field.tagName.toLowerCase() : '';
    if (tag !== 'textarea') return false;
    if (field.matches(CONFIG.ignoreSelector)) return false;
    if (field.closest && field.closest(CONFIG.ignoreSelector)) return false;
    if (field.closest && field.closest(CONFIG.reactSelectIgnoreSelector)) return false;
    if (field.id && /^react-select-\d+-input$/i.test(field.id)) return false;
    if (field.getAttribute('role') === 'combobox') return false;
    if (field.getAttribute('aria-haspopup')) return false;
    if (field.getAttribute('aria-autocomplete')) return false;
    if (field.hasAttribute('aria-expanded')) return false;
    if (field.closest && field.closest('[role="combobox"], [role="listbox"], [aria-haspopup], [aria-expanded]')) return false;
    if (field.closest && field.closest('.select2, .select2-container, .chosen-container, .dropdown, .autocomplete')) return false;
    if (field.getAttribute('data-tm-localmem') === 'off') return false;
    return true;
  }

  function injectStyles() {
    if (!document.head || document.getElementById(CONFIG.styleId)) return;
    const style = document.createElement('style');
    style.id = CONFIG.styleId;
    style.textContent = `
    .tm-salic-alt-editor {
      border: 1px solid #cbd5e1;
      border-radius: .5rem;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 6px 18px rgba(15, 23, 42, .08);
    }
    .tm-salic-legacy-editor-hidden {
      display: none !important;
    }
    .tm-salic-alt-editor .ql-toolbar.ql-snow {
      border: 0;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .tm-salic-alt-editor .ql-container.ql-snow {
      border: 0;
      font: 400 .9rem/1.5 Arial, sans-serif;
      color: #111827;
    }
    .tm-salic-alt-editor .ql-editor {
      min-height: 260px;
      font: 400 16px/1.5 Arial, sans-serif;
      color: #111827;
      background: #fff;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .tm-salic-alt-editor .ql-editor p,
    .tm-salic-alt-editor .ql-editor ol,
    .tm-salic-alt-editor .ql-editor ul {
      margin: 0 0 .5em;
    }
    .tm-salic-alt-editor .ql-editor .ql-size-small {
      font-size: .75em;
    }
    .tm-salic-alt-editor .ql-editor .ql-size-large {
      font-size: 1.5em;
    }
    .tm-salic-alt-editor .ql-editor .ql-size-huge {
      font-size: 2.5em;
    }
    .tm-salic-alt-editor .ql-toolbar select,
    .tm-salic-alt-editor .ql-toolbar .ql-picker {
      max-width: none;
    }
    .tm-salic-alt-editor .ql-toolbar .ql-size {
      width: 5.5rem;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="12px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="12px"]::before {
      content: "12px";
      font-size: 12px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="14px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="14px"]::before {
      content: "14px";
      font-size: 14px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="16px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="16px"]::before {
      content: "16px";
      font-size: 16px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="18px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="18px"]::before {
      content: "18px";
      font-size: 18px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="24px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="24px"]::before {
      content: "24px";
      font-size: 24px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-item[data-value="32px"]::before,
    .tm-salic-alt-editor .ql-size .ql-picker-label[data-value="32px"]::before {
      content: "32px";
      font-size: 32px;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-label::before {
      line-height: 1;
      vertical-align: middle;
    }
    .tm-salic-alt-editor .ql-size .ql-picker-options {
      min-width: 6rem;
    }`;
    document.head.appendChild(style);
  }

  function loadQuill() {
    if (window.Quill) return Promise.resolve(window.Quill);
    if (STATE.quillPromise) return STATE.quillPromise;
    STATE.quillPromise = new Promise((resolve, reject) => {
      if (!document.getElementById(CONFIG.quillCssId)) {
        const link = document.createElement('link');
        link.id = CONFIG.quillCssId;
        link.rel = 'stylesheet';
        link.href = CONFIG.quillCssUrl;
        document.head.appendChild(link);
      }
      const existingScript = document.getElementById(CONFIG.quillJsId);
      if (existingScript) {
        if (window.Quill) resolve(window.Quill);
        else existingScript.addEventListener('load', () => resolve(window.Quill));
        return;
      }
      const script = document.createElement('script');
      script.id = CONFIG.quillJsId;
      script.src = CONFIG.quillJsUrl;
      script.onload = () => resolve(window.Quill);
      script.onerror = () => reject(new Error('Failed to load Quill'));
      document.head.appendChild(script);
    });
    return STATE.quillPromise;
  }

  function registerQuillFormats() {
    if (!window.Quill) return;
    try {
      const SizeStyle = window.Quill.import('attributors/style/size');
      SizeStyle.whitelist = ['10px', '12px', '14px', '16px', '18px', '24px', '32px', '8pt', '10pt', '12pt', '14pt', '18pt', '24pt', '36pt'];
      window.Quill.register(SizeStyle, true);
    } catch (_) {}
  }

  function createEditor(field) {
    if (!field || STATE.editors.get(field)) return;
    if (!isEnabled()) return;
    const root = getEditorRoot(field);
    if (!root) return;

    if (!window.Quill) {
      if (STATE.pendingFields.has(field)) return;
      STATE.pendingFields.add(field);
      loadQuill().then(() => {
        STATE.pendingFields.delete(field);
        createEditor(field);
      }).catch(() => {
        STATE.pendingFields.delete(field);
      });
      return;
    }

    registerQuillFormats();
    injectStyles();

    const wrapper = document.createElement('div');
    wrapper.className = 'tm-salic-alt-editor';
    wrapper.dataset.tmAltEditor = '1';
    wrapper.dataset.tmReactselect = 'off';

    const editorHost = document.createElement('div');
    editorHost.className = 'tm-salic-alt-body';
    editorHost.dataset.tmReactselect = 'off';
    wrapper.appendChild(editorHost);

    const quill = new window.Quill(editorHost, {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ color: [] }, { background: [] }],
          [{ size: ['12px', '14px', '16px', '18px', '24px', '32px'] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean']
        ]
      }
    });

    const toolbar = wrapper.querySelector('.ql-toolbar');
    if (toolbar) {
      toolbar.dataset.tmReactselect = 'off';
      toolbar.classList.add('tm-reactselect-ignore');
      toolbar.querySelectorAll('select').forEach((select) => {
        select.dataset.tmReactselect = 'off';
        select.classList.add('tm-reactselect-ignore');
      });
    }

    const initialHtml = getFieldValue(field);
    if (initialHtml) quill.clipboard.dangerouslyPasteHTML(initialHtml, 'silent');

    const onTextChange = () => {
      const value = quill.root.innerHTML || '';
      updateHiddenTextarea(field, value);
      dispatchFieldChange(field);
    };
    quill.on('text-change', onTextChange);

    const previousDisplay = root.style.display || '';
    const previousAriaHidden = root.getAttribute('aria-hidden');
    root.classList.add('tm-salic-legacy-editor-hidden');
    root.style.setProperty('display', 'none', 'important');
    root.setAttribute('aria-hidden', 'true');
    root.insertAdjacentElement('afterend', wrapper);

    STATE.editors.set(field, {
      wrapper,
      body: quill.root,
      root,
      quill,
      previousDisplay,
      previousAriaHidden
    });
  }

  function removeEditor(field) {
    const entry = STATE.editors.get(field);
    if (!entry) return;
    const value = entry.body ? entry.body.innerHTML || '' : getFieldValue(field);
    setLegacyEditorContent(field, value);
    if (entry.root) {
      entry.root.classList.remove('tm-salic-legacy-editor-hidden');
      entry.root.style.display = entry.previousDisplay || '';
      if (entry.previousAriaHidden === null || entry.previousAriaHidden === undefined) {
        entry.root.removeAttribute('aria-hidden');
      } else {
        entry.root.setAttribute('aria-hidden', entry.previousAriaHidden);
      }
    }
    if (entry.wrapper) entry.wrapper.remove();
    STATE.editors.delete(field);
    dispatchFieldChange(field);
  }

  function apply() {
    if (STATE.applying) return;
    STATE.applying = true;
    const fields = Array.from(document.querySelectorAll('textarea'));
    try {
      fields.forEach((field) => {
        if (!isEligibleField(field)) return;
        if (isEnabled()) createEditor(field);
        else removeEditor(field);
      });
    } finally {
      STATE.applying = false;
    }
  }

  function scheduleApply() {
    if (STATE.observerTimer) clearTimeout(STATE.observerTimer);
    STATE.observerTimer = setTimeout(() => {
      STATE.observerTimer = null;
      apply();
    }, 200);
  }

  window[CONFIG.apiName] = {
    version: CONFIG.version,
    apply,
    getEntry(field) {
      return STATE.editors.get(field) || null;
    },
    dispose() {
      if (STATE.observer) {
        STATE.observer.disconnect();
        STATE.observer = null;
      }
      if (STATE.observerTimer) {
        clearTimeout(STATE.observerTimer);
        STATE.observerTimer = null;
      }
    }
  };

  window.addEventListener(CONFIG.settingEventName, (event) => {
    if (!event.detail || event.detail.key !== CONFIG.settingKey) return;
    apply();
  });

  STATE.observer = new MutationObserver((mutations) => {
    const ownMutation = mutations.every((mutation) => {
      const nodes = [mutation.target].concat(Array.from(mutation.addedNodes || []));
      return nodes.every((node) => {
        if (!node || node.nodeType !== 1) return true;
        if (node.id === CONFIG.styleId || node.id === CONFIG.quillCssId || node.id === CONFIG.quillJsId) return true;
        if (node.classList && (node.classList.contains('tm-salic-alt-editor') || node.classList.contains('tm-salic-legacy-editor-hidden'))) return true;
        return Boolean(node.closest && node.closest('.tm-salic-alt-editor'));
      });
    });
    if (ownMutation) return;
    scheduleApply();
  });
  STATE.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  apply();
  window.__tmPowerSalicUpgradeTextEditorLoading = false;
})();
