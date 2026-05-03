(function () {
  'use strict';

  const CONFIG = {
    apiName: '__tmPowerSalicUpgradeTextEditor',
    version: '2.0.10',
    settingKey: 'tm-salic-setting-alt-editor',
    settingEventName: 'tm-salic-setting-change',
    settingOn: '1',
    tinymceVersion: '8.5.0',
    textareaSelector: 'textarea[name], textarea#resumodoprojeto',
    initDelayMs: 80,
    initGapMs: 120,
    fullscreenStyleId: 'tm-salic-upgrade-text-editor-fullscreen-css',
    zoomKey: 'tm-salic-upgrade-text-editor-zoom',
    zoomDefault: 100,
    zoomMin: 80,
    zoomMax: 180,
    zoomStep: 10
  };

  const BASE = `https://cdn.jsdelivr.net/npm/tinymce@${CONFIG.tinymceVersion}`;
  const SRC = `${BASE}/tinymce.min.js`;
  const PAGE = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

  if (window[CONFIG.apiName] && window[CONFIG.apiName].version === CONFIG.version) {
    try {
      window[CONFIG.apiName].apply();
    } catch (_) {}
    return;
  }
  if (window[CONFIG.apiName] && typeof window[CONFIG.apiName].dispose === 'function') {
    try {
      window[CONFIG.apiName].dispose();
    } catch (_) {}
  }

  const STATE = {
    entries: new WeakMap(),
    fields: new Set(),
    tinyPromise: null,
    oldTinyMce: PAGE.tinymce || PAGE.tinyMCE || null,
    initTimer: null,
    queue: [],
    queuedFields: new Set(),
    processingQueue: false,
    applying: false,
    settingListener: null,
    zoom: 100,
    zoomButtons: new Set()
  };

  function clampZoom(value) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return CONFIG.zoomDefault;
    return Math.min(CONFIG.zoomMax, Math.max(CONFIG.zoomMin, number));
  }

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, null);
        if (value !== null && value !== undefined) return value;
      }
    } catch (_) {}
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (_) {}
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  function loadZoom() {
    STATE.zoom = clampZoom(storageGet(CONFIG.zoomKey));
  }

  function updateZoomButtons() {
    STATE.zoomButtons.forEach((api) => {
      try {
        api.setText(`${STATE.zoom}%`);
      } catch (_) {}
    });
  }

  function applyZoomToEditor(editor) {
    if (!editor || typeof editor.getBody !== 'function') return;
    try {
      const body = editor.getBody();
      if (!body) return;
      body.style.zoom = `${STATE.zoom}%`;
      body.dataset.tmSalicViewZoom = String(STATE.zoom);
    } catch (_) {}
  }

  function applyZoomToAllEditors() {
    Array.from(STATE.fields).forEach((field) => {
      const entry = STATE.entries.get(field);
      if (entry) applyZoomToEditor(entry.editor);
    });
    updateZoomButtons();
  }

  function setZoom(value) {
    STATE.zoom = clampZoom(value);
    storageSet(CONFIG.zoomKey, String(STATE.zoom));
    applyZoomToAllEditors();
  }

  function injectFullscreenStyles() {
    const doc = PAGE.document || document;
    if (!doc.head || doc.getElementById(CONFIG.fullscreenStyleId)) return;
    const style = doc.createElement('style');
    style.id = CONFIG.fullscreenStyleId;
    style.textContent = `
      .tm-salic-editor-fullscreen {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        border-radius: 0 !important;
        background: #fff !important;
      }
      .tm-salic-editor-fullscreen .tox-edit-area,
      .tm-salic-editor-fullscreen .tox-sidebar-wrap {
        flex: 1 1 auto !important;
      }
      .tm-salic-editor-fullscreen .tox-edit-area__iframe {
        height: 100% !important;
      }
      .tm-salic-editor-fullscreen-active {
        overflow: hidden !important;
      }
      body.tm-salic-editor-fullscreen-active .tox-tinymce-aux,
      body.tm-salic-editor-fullscreen-active .tox-menu,
      body.tm-salic-editor-fullscreen-active .tox-dialog-wrap,
      body.tm-salic-editor-fullscreen-active .tox-pop {
        z-index: 2147483647 !important;
      }
    `;
    doc.head.appendChild(style);
  }

  function setupFullscreenButton(editor) {
    let active = false;
    let buttonApi = null;

    const setActive = (next) => {
      active = Boolean(next);
      const doc = PAGE.document || document;
      const container = editor.getContainer ? editor.getContainer() : null;
      if (!container) return;

      injectFullscreenStyles();
      container.classList.toggle('tm-salic-editor-fullscreen', active);
      doc.documentElement.classList.toggle('tm-salic-editor-fullscreen-active', active);
      doc.body.classList.toggle('tm-salic-editor-fullscreen-active', active);
      if (buttonApi) buttonApi.setActive(active);

      setTimeout(() => {
        try {
          if (typeof editor.focus === 'function') editor.focus();
        } catch (_) {}
      }, 0);
    };

    const onKeydown = (event) => {
      if (active && event.key === 'Escape') setActive(false);
    };

    editor.ui.registry.addToggleButton('salicfullscreen', {
      icon: 'fullscreen',
      tooltip: 'Tela cheia',
      onAction: () => setActive(!active),
      onSetup: (api) => {
        buttonApi = api;
        api.setActive(active);
        return () => {
          buttonApi = null;
        };
      }
    });

    (PAGE.document || document).addEventListener('keydown', onKeydown, true);
    editor.on('remove', () => {
      setActive(false);
      (PAGE.document || document).removeEventListener('keydown', onKeydown, true);
    });

    return {
      exit: () => setActive(false)
    };
  }

  function setupZoomButtons(editor) {
    editor.ui.registry.addButton('saliczoomout', {
      icon: 'zoom-out',
      tooltip: 'Diminuir zoom',
      onAction: () => setZoom(STATE.zoom - CONFIG.zoomStep)
    });

    editor.ui.registry.addButton('saliczoomreset', {
      text: `${STATE.zoom}%`,
      tooltip: 'Restaurar zoom',
      onAction: () => setZoom(CONFIG.zoomDefault),
      onSetup: (api) => {
        STATE.zoomButtons.add(api);
        try {
          api.setText(`${STATE.zoom}%`);
        } catch (_) {}
        return () => {
          STATE.zoomButtons.delete(api);
        };
      }
    });

    editor.ui.registry.addButton('saliczoomin', {
      icon: 'zoom-in',
      tooltip: 'Aumentar zoom',
      onAction: () => setZoom(STATE.zoom + CONFIG.zoomStep)
    });
  }

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

  function decodeHtml(value) {
    const el = document.createElement('textarea');
    el.innerHTML = value || '';
    return el.value;
  }

  function getOldEditor(field) {
    if (!field || !field.id) return null;
    const oldTiny = STATE.oldTinyMce;
    try {
      return oldTiny?.get?.(field.id) || oldTiny?.EditorManager?.get?.(field.id) || null;
    } catch (_) {
      return null;
    }
  }

  function captureLegacyTinyMce() {
    const current = PAGE.tinymce || PAGE.tinyMCE || null;
    if (!current || String(current.majorVersion) === '8') return;
    STATE.oldTinyMce = current;
  }

  function getOldEditorContainer(field) {
    if (!field || !field.id) return null;
    const iframe = document.getElementById(`${field.id}_ifr`);
    if (iframe) {
      return iframe.closest('.tox-tinymce')
        || iframe.closest('.mce-tinymce')
        || iframe.closest('.mceEditor')
        || iframe.closest('table.mceLayout')
        || iframe.closest('.mce-container')
        || iframe.closest('.mce-panel')
        || iframe.parentElement;
    }
    const oldEditor = getOldEditor(field);
    if (oldEditor && typeof oldEditor.getContainer === 'function') {
      try {
        return oldEditor.getContainer();
      } catch (_) {}
    }
    return null;
  }

  function getSourceHtml(field) {
    const oldEditor = getOldEditor(field);
    if (oldEditor && typeof oldEditor.getContent === 'function') {
      try {
        return oldEditor.getContent() || '';
      } catch (_) {}
    }
    return decodeHtml(field.value || '');
  }

  function setNativeTextareaValue(field, value) {
    const html = value === null || value === undefined ? '' : String(value);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(field, html);
    else field.value = html;
    field.setAttribute('value', html);
  }

  function syncToSource(editor, field) {
    const html = editor && typeof editor.getContent === 'function' ? editor.getContent() : '';
    setNativeTextareaValue(field, html);

    const oldEditor = getOldEditor(field);
    if (oldEditor && oldEditor !== editor && typeof oldEditor.setContent === 'function') {
      try {
        oldEditor.setContent(html);
        if (typeof oldEditor.save === 'function') oldEditor.save();
      } catch (_) {}
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.jQuery) {
      try {
        window.jQuery(field).val(html).trigger('input').trigger('change');
      } catch (_) {}
    }
  }

  function loadTinyMce8() {
    if (PAGE.tinymce && String(PAGE.tinymce.majorVersion) === '8') {
      return Promise.resolve(PAGE.tinymce);
    }
    if (STATE.tinyPromise) return STATE.tinyPromise;

    STATE.tinyPromise = new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: SRC,
          onload: (resp) => {
            if (resp.status < 200 || resp.status >= 300) {
              reject(new Error(`Failed to fetch TinyMCE 8 (${resp.status})`));
              return;
            }
            try {
              const source = `${resp.responseText || ''}\n//# sourceURL=${SRC}`;
              if (PAGE.eval && PAGE !== window) PAGE.eval(source);
              else (0, eval)(source);
              if (PAGE.tinymce && String(PAGE.tinymce.majorVersion) === '8') {
                resolve(PAGE.tinymce);
              } else {
                reject(new Error('TinyMCE 8 loaded but window.tinymce was not initialized'));
              }
            } catch (err) {
              reject(err);
            }
          },
          onerror: () => reject(new Error('Failed to fetch TinyMCE 8'))
        });
        return;
      }

      const existing = document.querySelector(`script[src="${SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => {
          if (PAGE.tinymce && String(PAGE.tinymce.majorVersion) === '8') resolve(PAGE.tinymce);
          else reject(new Error('TinyMCE 8 script loaded but window.tinymce was not initialized'));
        });
        existing.addEventListener('error', reject);
        return;
      }

      const script = document.createElement('script');
      script.src = SRC;
      script.onload = () => {
        if (PAGE.tinymce && String(PAGE.tinymce.majorVersion) === '8') resolve(PAGE.tinymce);
        else reject(new Error('TinyMCE 8 script loaded but window.tinymce was not initialized'));
      };
      script.onerror = () => reject(new Error('Failed to load TinyMCE 8 script'));
      document.head.appendChild(script);
    });
    return STATE.tinyPromise;
  }

  function isEligibleField(field) {
    if (!field || field.tagName?.toLowerCase() !== 'textarea') return false;
    if (field.dataset.tmUpgradeTextEditor === '1') return false;
    if (field.dataset.tmLocalmem === 'off') return false;
    if (field.closest('.tm-salic-alt-editor, .tm-reactselect-wrapper, [data-tm-reactselect-host="1"]')) return false;
    return Boolean(field.name || field.id === 'resumodoprojeto');
  }

  function createMirror(field) {
    const mirror = document.createElement('textarea');
    const identity = field.id || field.name || `field_${Date.now()}`;
    mirror.id = `${identity}_upgraded_text_editor`;
    mirror.className = 'tm-salic-alt-editor';
    mirror.dataset.tmReactselect = 'off';
    mirror.dataset.tmLocalmem = 'off';
    mirror.value = getSourceHtml(field);
    mirror.style.width = '100%';
    mirror.style.minHeight = '320px';

    const oldContainer = getOldEditorContainer(field);
    if (oldContainer) {
      oldContainer.insertAdjacentElement('afterend', mirror);
    } else {
      field.insertAdjacentElement('afterend', mirror);
    }
    return { mirror, oldContainer };
  }

  function hideLegacy(field, oldContainer) {
    const previous = {
      fieldPosition: field.style.position || '',
      fieldLeft: field.style.left || '',
      fieldVisibility: field.style.visibility || '',
      fieldDisplay: field.style.display || '',
      containerDisplay: oldContainer ? oldContainer.style.display || '' : ''
    };

    field.style.display = 'block';
    field.style.visibility = 'hidden';
    field.style.position = 'absolute';
    field.style.left = '-99999px';

    if (oldContainer) {
      oldContainer.classList.add('tm-salic-legacy-editor-hidden');
      oldContainer.style.setProperty('display', 'none', 'important');
      oldContainer.setAttribute('aria-hidden', 'true');
    }

    return previous;
  }

  function restoreLegacy(field, entry) {
    field.style.position = entry.previous.fieldPosition;
    field.style.left = entry.previous.fieldLeft;
    field.style.visibility = entry.previous.fieldVisibility;
    field.style.display = entry.previous.fieldDisplay;

    if (entry.oldContainer) {
      entry.oldContainer.classList.remove('tm-salic-legacy-editor-hidden');
      entry.oldContainer.style.display = entry.previous.containerDisplay;
      entry.oldContainer.removeAttribute('aria-hidden');
    }
  }

  async function createEditor(field) {
    if (!isEnabled() || !isEligibleField(field) || STATE.entries.has(field)) return;
    captureLegacyTinyMce();
    field.dataset.tmUpgradeTextEditor = '1';

    const { mirror, oldContainer } = createMirror(field);
    const previous = hideLegacy(field, oldContainer);

    try {
      const tiny = await loadTinyMce8();
      if (!tiny || !isEnabled()) {
        mirror.remove();
        restoreLegacy(field, { previous, oldContainer });
        field.dataset.tmUpgradeTextEditor = '';
        return;
      }

      await tiny.init({
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
          'saliczoomout saliczoomreset saliczoomin',
          'removeformat | code salicfullscreen preview help'
        ].join(' '),
        plugins: [
          'lists',
          'code',
          'autoresize',
          'wordcount',
          'preview',
          'charmap',
          'visualblocks',
          'searchreplace',
          'help'
        ].join(' '),
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
          setupZoomButtons(editor);
          const fullscreen = setupFullscreenButton(editor);
          editor.on('remove', () => {
            fullscreen.exit();
          });
          editor.on('init', () => {
            editor.setContent(getSourceHtml(field) || '');
            applyZoomToEditor(editor);
            updateZoomButtons();
            syncToSource(editor, field);
          });
          editor.on('change keyup input undo redo setcontent', () => {
            syncToSource(editor, field);
          });
        }
      });

      const editor = tiny.get(mirror.id);
      if (!editor) throw new Error('TinyMCE 8 editor was not created');

      const entry = {
        editor,
        mirror,
        wrapper: editor.getContainer ? editor.getContainer() : mirror,
        body: editor.getBody ? editor.getBody() : mirror,
        root: oldContainer,
        oldContainer,
        previous,
        insertContent(html) {
          editor.insertContent(html);
          syncToSource(editor, field);
        }
      };

      STATE.entries.set(field, entry);
      STATE.fields.add(field);
    } catch (err) {
      console.error('[Power SALIC] Falha ao ativar editor alternativo:', err);
      mirror.remove();
      restoreLegacy(field, { previous, oldContainer });
      field.dataset.tmUpgradeTextEditor = '';
    }
  }

  function enqueueField(field) {
    if (!field || STATE.entries.has(field) || STATE.queuedFields.has(field)) return;
    STATE.queuedFields.add(field);
    STATE.queue.push(field);
  }

  function clearQueue() {
    STATE.queue = [];
    STATE.queuedFields.clear();
    STATE.processingQueue = false;
  }

  async function processQueue() {
    if (STATE.processingQueue) return;
    STATE.processingQueue = true;
    try {
      while (isEnabled() && STATE.queue.length) {
        const field = STATE.queue.shift();
        STATE.queuedFields.delete(field);
        if (field && field.isConnected && isEligibleField(field)) {
          await createEditor(field);
          await new Promise((resolve) => setTimeout(resolve, CONFIG.initGapMs));
        }
      }
    } finally {
      STATE.processingQueue = false;
    }
  }

  function removeEditor(field) {
    const entry = STATE.entries.get(field);
    if (!entry) return;

    try {
      syncToSource(entry.editor, field);
    } catch (_) {}
    try {
      entry.editor.remove();
    } catch (_) {}

    if (entry.mirror && entry.mirror.isConnected) entry.mirror.remove();
    restoreLegacy(field, entry);
    field.dataset.tmUpgradeTextEditor = '';
    STATE.entries.delete(field);
    STATE.fields.delete(field);
  }

  function scheduleApply() {
    if (STATE.initTimer) clearTimeout(STATE.initTimer);
    STATE.initTimer = setTimeout(() => {
      STATE.initTimer = null;
      apply();
    }, CONFIG.initDelayMs);
  }

  function apply() {
    if (STATE.applying) return;
    STATE.applying = true;
    try {
      if (!isEnabled()) {
        clearQueue();
        Array.from(STATE.fields).forEach((field) => removeEditor(field));
        return;
      }
      Array.from(document.querySelectorAll(CONFIG.textareaSelector)).forEach((field) => {
        if (isEligibleField(field)) enqueueField(field);
      });
      processQueue();
    } finally {
      STATE.applying = false;
    }
  }

  function getEntry(field) {
    const entry = STATE.entries.get(field);
    if (!entry) return null;
    if (entry.editor && typeof entry.editor.getBody === 'function') {
      entry.body = entry.editor.getBody();
    }
    return entry;
  }

  function dispose() {
    if (STATE.initTimer) {
      clearTimeout(STATE.initTimer);
      STATE.initTimer = null;
    }
    if (STATE.settingListener) {
      window.removeEventListener(CONFIG.settingEventName, STATE.settingListener);
      STATE.settingListener = null;
    }
    clearQueue();
    Array.from(STATE.fields).forEach((field) => removeEditor(field));
  }

  window[CONFIG.apiName] = {
    version: CONFIG.version,
    apply,
    getEntry,
    dispose
  };

  loadZoom();

  STATE.settingListener = (event) => {
    if (!event.detail || event.detail.key !== CONFIG.settingKey) return;
    scheduleApply();
  };
  window.addEventListener(CONFIG.settingEventName, STATE.settingListener);

  scheduleApply();
})();
