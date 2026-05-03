// ==UserScript==
// @name         Power SALIC
// @namespace    power-salic
// @updateURL    https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/salic_melhorias_locais.user.js
// @downloadURL  https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/salic_melhorias_locais.user.js
// @require      https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/upgradetexteditor.js
// @version      3.16
// @description  Salvamento local automatico de campos de texto e ocultacao do botao excluir proposta.
// @match        https://aplicacoes.cultura.gov.br/*
// @match        https://salic.cultura.gov.br/*
// @match        https://cultura.gov.br/*
// @match        https://*.cultura.gov.br/*
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    saveDelayMs: 500,
    statusClass: 'tm-salic-local-status',
    statusSaving: 'Salvando...',
    statusSaved: 'Salvo',
    statusRestored: 'Restaurado',
    statusError: 'Erro ao salvar',
    statusEmpty: 'Nada salvo',
    statusIdle: 'Aguardando edicao',
    statusServerDiff: 'Carregado valor diferente do rascunho',
    pollIntervalMs: 1200,
    hideDeleteSelector: '#sidenav #excluirproposta',
    ignoreSelector: '.tm-localmem-ignore, [data-tm-localmem="off"]',
    reactSelectIgnoreSelector: '.tm-reactselect-wrapper, [data-tm-reactselect-host="1"]',
    settingsRootId: 'tm-salic-settings-root',
    settingsHostId: 'tm-salic-settings-host',
    settingsButtonId: 'tm-salic-settings-button',
    settingsMenuId: 'tm-salic-settings-menu',
    customStyleId: 'tm-salic-custom-css',
    autoSaveKey: 'tm-salic-setting-autosave',
    hideDeleteKey: 'tm-salic-setting-hide-delete',
    uiMemoryKey: 'tm-salic-setting-ui-memory',
    reactSelectKey: 'tm-salic-setting-reactselect',
    reactSelectShowOriginalKey: 'tm-salic-setting-reactselect-show-original',
    reactSelectMinOptionsKey: 'tm-salic-setting-reactselect-min-options',
    reactSelectMinOptionsDefault: 10,
    reactSelectMinOptionsMin: 0,
    reactSelectMinOptionsMax: 99,
    richPasteKey: 'tm-salic-setting-rich-paste',
    altEditorKey: 'tm-salic-setting-alt-editor',
    altEditorApiName: '__tmPowerSalicUpgradeTextEditor',
    collapsibleStatePrefix: 'tm-salic-collapsible-state',
    tabStatePrefix: 'tm-salic-tab-state',
    filterStatePrefix: 'tm-salic-filter-state',
    settingEventName: 'tm-salic-setting-change',
    settingOn: '1',
    settingOff: '0',
    suiteInstallUrl: 'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/power_salic_suite.user.js',
    suiteForceParam: 'tm_ps_update'
  };

  const STATE = {
    timers: new WeakMap(),
    lastValue: new WeakMap(),
    pollers: new WeakMap(),
    userEdited: new WeakMap(),
    observerTimer: null,
    collapsibleRestoreTimer: null,
    collapsibleInteractionUntil: 0,
    collapsibleListenersReady: false,
    tabRestoreTimer: null,
    tabInteractionUntil: 0,
    tabListenersReady: false,
    filterRestoreTimer: null,
    filterInteractionUntil: 0,
    filterListenersReady: false,
    settingsListenersReady: false,
    pasteModal: null,
    settings: Object.create(null)
  };

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, null);
    } catch (_) {}
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return true;
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function storageListKeys() {
    const keys = new Set();
    try {
      if (typeof GM_listValues === 'function') {
        GM_listValues().forEach((key) => keys.add(key));
      }
    } catch (_) {}
    try {
      Object.keys(localStorage || {}).forEach((key) => keys.add(key));
    } catch (_) {}
    return Array.from(keys);
  }

  function storageRemove(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      }
    } catch (_) {}
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function getSetting(key, defaultValue) {
    if (Object.prototype.hasOwnProperty.call(STATE.settings, key)) {
      return STATE.settings[key];
    }
    let stored = storageGet(key);
    if (stored === null || stored === undefined) {
      try {
        stored = localStorage.getItem(key);
      } catch (_) {}
    }
    let value = defaultValue;
    if (stored === CONFIG.settingOn) value = true;
    else if (stored === CONFIG.settingOff) value = false;
    else if (stored === true || stored === false) value = stored;
    STATE.settings[key] = Boolean(value);
    return STATE.settings[key];
  }

  function setSetting(key, enabled) {
    STATE.settings[key] = Boolean(enabled);
    storageSet(key, enabled ? CONFIG.settingOn : CONFIG.settingOff);
    try {
      localStorage.setItem(key, enabled ? CONFIG.settingOn : CONFIG.settingOff);
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent(CONFIG.settingEventName, {
        detail: { key, enabled: Boolean(enabled) }
      }));
    } catch (_) {}
  }

  function clampNumber(value, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function getNumberSetting(key, defaultValue, min, max) {
    if (Object.prototype.hasOwnProperty.call(STATE.settings, key)) {
      return STATE.settings[key];
    }
    let stored = storageGet(key);
    if (stored === null || stored === undefined) {
      try {
        stored = localStorage.getItem(key);
      } catch (_) {}
    }
    const value = clampNumber(stored === null || stored === undefined ? defaultValue : stored, min, max);
    STATE.settings[key] = value;
    return value;
  }

  function setNumberSetting(key, value, min, max) {
    const nextValue = clampNumber(value, min, max);
    STATE.settings[key] = nextValue;
    storageSet(key, String(nextValue));
    try {
      localStorage.setItem(key, String(nextValue));
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent(CONFIG.settingEventName, {
        detail: { key, value: nextValue }
      }));
    } catch (_) {}
    return nextValue;
  }

  function refreshScriptsWithoutReinstall() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(CONFIG.suiteForceParam, String(Date.now()));
      window.location.replace(url.toString());
    } catch (_) {
      const base = window.location.href.split('#')[0];
      const hash = window.location.hash || '';
      const sep = base.includes('?') ? '&' : '?';
      window.location.replace(`${base}${sep}${CONFIG.suiteForceParam}=${Date.now()}${hash}`);
    }
  }

  function isAutoSaveEnabled() {
    return getSetting(CONFIG.autoSaveKey, true);
  }

  function isHideDeleteEnabled() {
    return getSetting(CONFIG.hideDeleteKey, true);
  }

  function isUiMemoryEnabled() {
    return getSetting(CONFIG.uiMemoryKey, true);
  }

  function isReactSelectEnabled() {
    return getSetting(CONFIG.reactSelectKey, true);
  }

  function isReactSelectOriginalVisible() {
    return getSetting(CONFIG.reactSelectShowOriginalKey, false);
  }

  function isRichPasteEnabled() {
    return getSetting(CONFIG.richPasteKey, false);
  }

  function isAltEditorEnabled() {
    return getSetting(CONFIG.altEditorKey, false);
  }

  function getReactSelectMinOptions() {
    return getNumberSetting(
      CONFIG.reactSelectMinOptionsKey,
      CONFIG.reactSelectMinOptionsDefault,
      CONFIG.reactSelectMinOptionsMin,
      CONFIG.reactSelectMinOptionsMax
    );
  }

  function injectBootstrapIcons() {
    const id = 'tm-salic-bootstrap-icons';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css';
    link.referrerPolicy = 'no-referrer';
    document.head.appendChild(link);
  }

  function injectStyles() {
    if (!document.head) return;
    if (document.getElementById(CONFIG.customStyleId)) return;
    injectBootstrapIcons();
    const style = document.createElement('style');
    style.id = CONFIG.customStyleId;
    style.textContent = `
    .tm-salic-btn-icon {
      font-size: .95em;
      line-height: 1;
    }
    .tm-salic-btn .tm-salic-btn-icon + span,
    .tm-salic-btn .tm-salic-btn-icon + .tm-salic-btn-label {
      white-space: nowrap;
    }
    .tm-salic-settings {
      display: inline-flex;
      align-items: center;
      position: relative;
      z-index: 5;
      width: fit-content;
      max-width: 100%;
    }
    #${CONFIG.settingsButtonId} .tm-salic-btn-icon {
      font-size: 1rem;
    }
    #${CONFIG.settingsRootId} {
      display: inline-flex;
      max-width: 100%;
      margin: .5rem 0;
    }
    .tm-salic-settings-host {
      display: inline-flex;
      align-items: center;
      list-style: none;
    }
    #atalhos .tm-salic-settings-host {
      height: 100%;
    }
    #atalhos #${CONFIG.settingsRootId} {
      margin: 0;
      width: auto;
      height: 100%;
      align-items: stretch;
    }
    #${CONFIG.settingsButtonId} {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      max-width: 100%;
      white-space: normal;
    }
    #atalhos #${CONFIG.settingsButtonId} {
      height: 100%;
      min-height: 0;
      padding: 0 .7rem;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #fff;
      font: 500 .92rem/1 Arial, sans-serif;
      text-transform: none;
      letter-spacing: 0;
      width: auto;
      white-space: nowrap;
    }
    #atalhos #${CONFIG.settingsButtonId}:hover,
    #atalhos #${CONFIG.settingsButtonId}:focus {
      background: rgba(255, 255, 255, .12);
      filter: none;
      outline: none;
    }
    #${CONFIG.settingsMenuId} {
      position: fixed;
      width: min(20rem, calc(100vw - 1rem));
      font-style: normal;
      font-weight: 400;
      display: none;
      z-index: 2147483647;
    }
    .tm-salic-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .35rem;
      max-width: 100%;
      padding: .25rem .5rem;
      border: 1px solid #6c757d;
      border-radius: .25rem;
      background: #6c757d;
      color: #fff;
      font: 600 .8125rem/1.5 Arial, sans-serif;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      touch-action: manipulation;
    }
    .tm-salic-btn:hover,
    .tm-salic-btn:focus {
      filter: brightness(.95);
    }
    .tm-salic-btn-danger {
      width: 100%;
      border-color: #dc3545;
      background: #fff;
      color: #dc3545;
    }
    .tm-salic-btn-secondary {
      border-color: #6c757d;
      background: #fff;
      color: #6c757d;
    }
    .tm-salic-dropdown-toggle::after {
      content: "";
      display: inline-block;
      margin-left: .25rem;
      border-top: .3em solid;
      border-right: .3em solid transparent;
      border-left: .3em solid transparent;
    }
    .tm-salic-dropdown-menu {
      box-sizing: border-box;
      padding: .5rem;
      border: 1px solid rgba(0, 0, 0, .15);
      border-radius: .375rem;
      background: #fff;
      color: #212529;
      box-shadow: 0 .5rem 1rem rgba(0, 0, 0, .15);
      font-family: Arial, sans-serif;
      min-width: 14rem;
    }
    .tm-salic-settings-actions {
      margin-top: .5rem;
      padding-top: .5rem;
      border-top: 1px solid #e9ecef;
      display: flex;
      flex-direction: column;
      gap: .45rem;
    }
    .tm-salic-settings-actions-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: .45rem;
    }
    .tm-salic-settings-actions .tm-salic-btn {
      width: 100%;
      margin: 0;
    }
    .${CONFIG.statusClass} {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: .5rem;
      box-sizing: border-box;
      clear: both;
      width: 100%;
      min-height: 1rem;
      margin-top: .25rem;
      margin-bottom: .75rem;
      padding: .25rem 0;
      color: #546e7a;
      font-size: .75rem;
      line-height: 1.35;
      opacity: .85;
      user-select: none;
      position: static;
      z-index: auto;
    }
    .${CONFIG.statusClass} [data-tm-localmem-status-text="1"] {
      flex: 1 1 10rem;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .${CONFIG.statusClass} [data-tm-localmem-restore="1"] {
      display: none;
    }
    .tm-salic-settings-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: .75rem;
      min-width: 0;
      padding: .55rem .25rem;
      margin: 0;
      font: .8125rem/1.4 Arial, sans-serif;
    }
    .tm-salic-settings-row + .tm-salic-settings-row {
      border-top: 1px solid #e9ecef;
    }
    .tm-salic-settings-label {
      display: flex;
      flex-direction: column;
      gap: .125rem;
      min-width: 0;
    }
    .tm-salic-settings-title {
      color: #212529;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .tm-salic-settings-state {
      color: #6c757d;
      font-size: .75rem;
      overflow-wrap: anywhere;
    }
    .tm-salic-stepper {
      display: inline-grid;
      grid-template-columns: 2rem minmax(2.5rem, auto) 2rem;
      align-items: center;
      border: 1px solid #adb5bd;
      border-radius: .25rem;
      overflow: hidden;
      background: #fff;
    }
    .tm-salic-stepper button {
      width: 2rem;
      height: 2rem;
      border: 0;
      background: #f8f9fa;
      color: #212529;
      font: 700 1rem/1 Arial, sans-serif;
      cursor: pointer;
    }
    .tm-salic-stepper button:hover,
    .tm-salic-stepper button:focus {
      background: #e9ecef;
    }
    .tm-salic-stepper-value {
      min-width: 2.5rem;
      padding: 0 .5rem;
      color: #212529;
      font: 700 .875rem/1 Arial, sans-serif;
      text-align: center;
    }
    .tm-salic-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      width: 3.25rem;
      height: 1.6rem;
      margin: 0;
      padding: 0;
      border: 1px solid #adb5bd;
      border-radius: 999px;
      background: #dee2e6;
      color: transparent;
      cursor: pointer;
      transition: background-color .15s ease-in-out, border-color .15s ease-in-out;
    }
    .tm-salic-switch-knob {
      content: "";
      position: absolute;
      width: 1.15rem;
      height: 1.15rem;
      top: .175rem;
      left: .175rem;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
      transition: transform .15s ease-in-out;
    }
    .tm-salic-switch[aria-checked="true"] {
      border-color: #fd0d0d;
      background: #0d6efd;
    }
    .tm-salic-switch[aria-checked="true"] .tm-salic-switch-knob {
      transform: translateX(1.625rem);
    }
    .tm-salic-switch:focus {
      outline: 2px solid rgba(13, 110, 253, .35);
      outline-offset: 2px;
    }
    .tm-salic-file-input-hidden {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0 0 0 0) !important;
      clip-path: inset(50%) !important;
      border: 0 !important;
      white-space: nowrap !important;
    }
    .tm-salic-file-dropzone {
      box-sizing: border-box;
      display: flex;
      gap: 0;
      width: 100%;
      min-height: 5.5rem;
      margin: .35rem 0 .75rem;
      padding: .9rem 1rem;
      border: 2px dashed #fcd34d;
      border-radius: .5rem;
      background: #fefce8;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: border-color .15s ease-in-out, background-color .15s ease-in-out, box-shadow .15s ease-in-out;
    }
    .tm-salic-file-dropzone::after {
      content: "\f0c1";
      position: absolute;
      right: -0.6rem;
      bottom: -0.9rem;
      font-family: 'bootstrap-icons';
      font-size: 6rem;
      color: #fe9903;
      opacity: 0.16;
      pointer-events: none;
      line-height: 1;
      z-index: 0;
    }
    .tm-salic-file-main {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 1rem;
      min-width: 0;
    }
    .tm-salic-file-icon {
      font-size: 2.5rem;
      color: #fe9903;
      flex-shrink: 0;
      margin-top: 0.1rem;
      line-height: 1;
      font-family: 'bootstrap-icons';
      font-style: normal;
      font-weight: 400;
      display: inline-block;
    }
    .tm-salic-file-content {
      display: flex;
      flex-direction: column;
      gap: .2rem;
      min-width: 0;
      flex: 1;
    }
    .tm-salic-file-dropzone:hover,
    .tm-salic-file-dropzone:focus {
      border-color: #fbbf24;
      background: #fef3c7;
      box-shadow: 0 0 0 .15rem rgba(252, 211, 77, .2);
      outline: none;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file {
      border-color: #10b981;
      background: #ecfdf5;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file:hover,
    .tm-salic-file-dropzone.tm-salic-file-has-file:focus {
      border-color: #059669;
      background: #d1fae5;
      box-shadow: none;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file .tm-salic-file-icon {
      color: #10b981;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file .tm-salic-file-title {
      display: none;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file .tm-salic-file-help {
      display: block;
      color: #10b981;
      font: .78rem/1.35 Arial, sans-serif;
    }
    .tm-salic-file-dropzone.tm-salic-file-has-file .tm-salic-file-name {
      font: 700 1.2rem/1.4 Arial, sans-serif;
      color: #10b981;
    }
    .tm-salic-file-title {
      font: 700 .9rem/1.3 Arial, sans-serif;
      color: #2d3748;
    }
    .tm-salic-file-help,
    .tm-salic-file-name {
      color: #2d3748;
      font: .78rem/1.35 Arial, sans-serif;
      overflow-wrap: anywhere;
    }
    .tm-salic-file-name {
      font-weight: 600;
    }
    .tm-salic-file-action {
      display: none;
    }
    .tm-reactselect-wrapper,
    [data-tm-reactselect-host="1"] {
      position: relative;
    }
    .tm-reactselect-wrapper input[type="text"],
    [data-tm-reactselect-host="1"] input[type="text"],
    input[type="text"][role="combobox"],
    input[type="text"][aria-autocomplete],
    input[type="text"][aria-expanded],
    input[type="text"][aria-haspopup] {
      padding-left: 0.5rem;
    }
    .tm-salic-paste-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, .45);
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .tm-salic-paste-modal {
      width: min(720px, 100%);
      background: #fff;
      border-radius: .75rem;
      border: 1px solid #e2e8f0;
      box-shadow: 0 20px 50px rgba(15, 23, 42, .25);
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: .75rem;
      font: 400 .9rem/1.5 Arial, sans-serif;
    }
    .tm-salic-paste-title {
      font: 700 1rem/1.2 Arial, sans-serif;
      color: #0f172a;
    }
    .tm-salic-paste-editor {
      min-height: 200px;
      border: 1px solid #cbd5e1;
      border-radius: .5rem;
      padding: .6rem;
      background: #f8fafc;
      outline: none;
    }
    .tm-salic-paste-actions {
      display: flex;
      gap: .5rem;
      justify-content: flex-end;
    }

    @media (max-width: 576px) {
      #${CONFIG.settingsRootId},
      #${CONFIG.settingsButtonId} {
        width: 100%;
      }
      .tm-salic-settings-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
    }
`;
    document.head.appendChild(style);
  }

  function getProjectId() {
    const match = window.location.pathname.match(/idPreProjeto\/(\d+)/i);
    return match ? match[1] : 'unknown';
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getFieldLabel(field) {
    if (field.id) {
      const explicit = document.querySelector(`label[for="${field.id}"]`);
      if (explicit && explicit.textContent) return explicit.textContent.trim();
    }
    const wrapped = field.closest('label');
    if (wrapped && wrapped.textContent) return wrapped.textContent.trim();
    return '';
  }

  function getTableRowHeaderText(row) {
    if (!row) return '';
    const cells = Array.from(row.querySelectorAll('th, td'));
    for (const cell of cells) {
      const text = normalizeText(cell.textContent);
      if (!text) continue;
      const isHeaderLike = cell.tagName === 'TH' || cell.hasAttribute('colspan') || cell.querySelector('b, strong');
      if (isHeaderLike || cells.length === 1) return text;
    }
    return '';
  }

  function getStructuralFieldLabel(field) {
    if (!field) return '';
    const explicit = getFieldLabel(field);
    if (explicit) return explicit;

    const title = field.getAttribute('title') || '';
    if (title.trim()) return title.trim();

    const ariaLabel = field.getAttribute('aria-label') || '';
    if (ariaLabel.trim()) return ariaLabel.trim();

    const placeholder = field.getAttribute('placeholder') || '';
    if (placeholder.trim()) return placeholder.trim();

    const table = field.closest('table');
    const row = field.closest('tr');
    if (table && row) {
      let current = row.previousElementSibling;
      while (current) {
        const rowHeader = getTableRowHeaderText(current);
        if (rowHeader) return rowHeader;
        current = current.previousElementSibling;
      }

      const caption = table.querySelector('caption');
      if (caption && caption.textContent.trim()) return caption.textContent.trim();
    }

    const caption = field.closest('.input-field')?.querySelector('.caption');
    if (caption && caption.textContent.trim()) return caption.textContent.trim();

    return '';
  }

  function getFieldIdentity(field) {
    const idPart = field.id || '';
    const namePart = field.name || '';
    const ariaLabel = field.getAttribute('aria-label') || '';
    const labelText = getFieldLabel(field);
    const formPart = field.form ? (field.form.getAttribute('name') || field.form.getAttribute('id') || field.form.getAttribute('action') || '') : '';
    const tagPart = field.tagName || '';
    const typePart = field.getAttribute('type') || '';
    return [idPart, namePart, ariaLabel, labelText, formPart, tagPart, typePart]
      .map((part) => String(part).trim())
      .filter(Boolean)
      .join('|');
  }

  function getFieldKey(field) {
    const projectId = getProjectId();
    const pagePath = window.location.pathname;
    const identity = getFieldIdentity(field) || 'field';
    return [
      'tm-salic-localmem',
      projectId,
      pagePath,
      identity
    ].join('::');
  }

  function getEditorIframe(field) {
    if (!field || field.tagName.toLowerCase() !== 'textarea') return null;
    if (!field.id) return null;
    return document.getElementById(`${field.id}_ifr`);
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

  function getAltEditorEntry(field) {
    const api = window[CONFIG.altEditorApiName];
    if (!api || typeof api.getEntry !== 'function') return null;
    try {
      return api.getEntry(field) || null;
    } catch (_) {
      return null;
    }
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

  function updateHiddenTextarea(field, value) {
    if (!field || field.tagName.toLowerCase() !== 'textarea') return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
  }

  function getFieldValue(field) {
    const altEntry = getAltEditorEntry(field);
    if (altEntry && altEntry.body) {
      return altEntry.body.innerHTML || '';
    }
    const iframe = getEditorIframe(field);
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      return iframe.contentDocument.body.innerHTML || '';
    }
    return field.value || '';
  }

  function isEditorFocused(field) {
    const altEntry = getAltEditorEntry(field);
    if (altEntry && altEntry.body) {
      return document.activeElement === altEntry.body || altEntry.body.contains(document.activeElement);
    }
    const iframe = getEditorIframe(field);
    if (!iframe || !iframe.contentDocument) return false;
    const doc = iframe.contentDocument;
    if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false;
    const active = doc.activeElement;
    return active === doc.body || (active && active.tagName === 'BODY');
  }

  function setFieldValue(field, value) {
    const nextValue = value === null || value === undefined ? '' : String(value);
    const altEntry = getAltEditorEntry(field);
    if (altEntry && altEntry.body) {
      if (altEntry.quill) {
        try {
          altEntry.quill.setText('', 'silent');
          if (nextValue) altEntry.quill.clipboard.dangerouslyPasteHTML(0, nextValue, 'silent');
        } catch (_) {
          altEntry.body.innerHTML = nextValue;
        }
      } else {
        altEntry.body.innerHTML = nextValue;
      }
      updateHiddenTextarea(field, nextValue);
      setLegacyEditorContent(field, nextValue);
      return;
    }
    const iframe = getEditorIframe(field);
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      iframe.contentDocument.body.innerHTML = nextValue;
      updateHiddenTextarea(field, nextValue);
      return;
    }
    applyFieldValue(field, nextValue);
  }

  function isValueEmpty(value) {
    return String(value || '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() === '';
  }

  function normalizeValue(value) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getStatusAnchor(field) {
    const altEntry = getAltEditorEntry(field);
    if (altEntry && altEntry.wrapper) return altEntry.wrapper;
    const editorRoot = getEditorRoot(field);
    if (editorRoot) return editorRoot;
    return field;
  }

  function ensureStatusEl(field) {
    const anchor = getStatusAnchor(field);
    let status = anchor.nextElementSibling;
    if (!status || !status.classList.contains(CONFIG.statusClass)) {
      const parent = field.parentElement || field.closest('.input-field');
      status = parent ? Array.from(parent.children).find((child) => child.classList && child.classList.contains(CONFIG.statusClass)) : null;
    }
    if (!status || !status.classList.contains(CONFIG.statusClass)) {
      status = document.createElement('div');
      status.className = `${CONFIG.statusClass} small`;
      const text = document.createElement('span');
      text.dataset.tmLocalmemStatusText = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<i class="bi bi-arrow-counterclockwise tm-salic-btn-icon" aria-hidden="true"></i><span>Recuperar Rascunho</span>';
      btn.className = 'tm-salic-btn tm-salic-btn-secondary';
      btn.dataset.tmLocalmemRestore = '1';
      const pasteBtn = document.createElement('button');
      pasteBtn.type = 'button';
      pasteBtn.innerHTML = '<i class="bi bi-clipboard-plus tm-salic-btn-icon" aria-hidden="true"></i><span>Colar formatado</span>';
      pasteBtn.className = 'tm-salic-btn tm-salic-btn-secondary';
      pasteBtn.dataset.tmLocalmemPaste = '1';
      status.appendChild(text);
      status.appendChild(pasteBtn);
      status.appendChild(btn);
      anchor.insertAdjacentElement('afterend', status);
    }
    updatePasteButtonVisibility(field);
    return status;
  }

  function updatePasteButtonVisibility(field) {
    const status = getStatusAnchor(field).nextElementSibling;
    if (!status || !status.classList.contains(CONFIG.statusClass)) return;
    const pasteBtn = status.querySelector('[data-tm-localmem-paste="1"]');
    if (!pasteBtn) return;
    pasteBtn.style.display = isRichPasteEnabled() ? 'inline-flex' : 'none';
  }

  function updateAllPasteButtonsVisibility() {
    const statuses = Array.from(document.querySelectorAll(`.${CONFIG.statusClass}`));
    statuses.forEach((status) => {
      const pasteBtn = status.querySelector('[data-tm-localmem-paste="1"]');
      if (!pasteBtn) return;
      pasteBtn.style.display = isRichPasteEnabled() ? 'inline-flex' : 'none';
    });
  }

  function setStatus(field, text) {
    if (!isAutoSaveEnabled()) return;
    const status = ensureStatusEl(field);
    status.style.display = 'flex';
    const textNode = status.querySelector('[data-tm-localmem-status-text="1"]');
    if (textNode) {
      textNode.textContent = text;
    }
    updatePasteButtonVisibility(field);
  }

  function updateRestoreButton(field, key) {
    if (!isAutoSaveEnabled()) return;
    const status = ensureStatusEl(field);
    status.style.display = 'flex';
    const restoreBtn = status.querySelector('[data-tm-localmem-restore="1"]');
    if (!restoreBtn) return;
    const stored = storageGet(key);
    restoreBtn.style.display = stored === null || stored === undefined || isValueEmpty(stored) ? 'none' : 'inline-flex';
    updatePasteButtonVisibility(field);
  }

  function clearProjectCache() {
    const projectId = getProjectId();
    const prefix = `tm-salic-localmem::${projectId}::`;
    const keys = storageListKeys();
    keys.forEach((key) => {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        storageRemove(key);
      }
    });
    const fields = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
    fields.forEach((field) => {
      if (!isEligibleField(field)) return;
      if (!isAutoSaveEnabled()) return;
      const key = getFieldKey(field);
      updateRestoreButton(field, key);
      setStatus(field, CONFIG.statusEmpty);
    });
  }

  function htmlToPlainText(value) {
    const text = String(value || '');
    if (!text) return '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${text}</div>`, 'text/html');
      const blockTags = new Set(['P', 'DIV', 'LI', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'BLOCKQUOTE']);
      const skipTags = new Set(['SCRIPT', 'STYLE']);

      const serialize = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tagName = node.tagName;
        if (skipTags.has(tagName)) return '';
        if (tagName === 'BR') return '\n';
        const content = Array.from(node.childNodes).map((child) => serialize(child)).join('');
        if (blockTags.has(tagName)) return `\n${content}\n`;
        return content;
      };

      return serialize(doc.body)
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (_) {
      return text
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|li|tr|td|th|h[1-6]|section|article|blockquote)\s*>/gi, '\n')
        .replace(/<\s*(p|div|li|tr|td|th|h[1-6]|section|article|blockquote)[^>]*>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }

  function plainTextToHtml(text) {
    const normalized = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const escaped = escapeHtml(normalized);
    const paragraphs = escaped.split(/\n{2,}/g).map((block) => block.replace(/\n/g, '<br>'));
    return paragraphs.map((block) => `<p>${block}</p>`).join('');
  }

  function insertHtmlIntoDocument(doc, html) {
    if (!doc || !doc.body) return false;
    if (!html) return false;
    try {
      if (typeof doc.execCommand === 'function') {
        const ok = doc.execCommand('insertHTML', false, html);
        if (ok) return true;
      }
    } catch (_) {}
    try {
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0) {
        doc.body.insertAdjacentHTML('beforeend', html);
        return true;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const template = doc.createElement('template');
      template.innerHTML = html;
      const fragment = doc.createDocumentFragment();
      while (template.content.firstChild) {
        fragment.appendChild(template.content.firstChild);
      }
      range.insertNode(fragment);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  }

  function insertHtmlIntoEditor(field, doc, html) {
    if (!html) return false;
    const altEntry = getAltEditorEntry(field);
    if (altEntry && altEntry.quill) {
      try {
        const quill = altEntry.quill;
        const range = quill.getSelection(true);
        const index = range ? range.index : quill.getLength();
        quill.clipboard.dangerouslyPasteHTML(index, html, 'user');
        quill.setSelection(index + 1, 0, 'silent');
        return true;
      } catch (_) {}
    }
    const tinymceGlobal = window.tinymce || window.tinyMCE;
    if (tinymceGlobal && field && field.id) {
      try {
        const editor = tinymceGlobal.get(field.id);
        if (editor && typeof editor.insertContent === 'function') {
          if (typeof editor.focus === 'function') editor.focus();
          editor.insertContent(html);
          return true;
        }
      } catch (_) {}
    }
    return insertHtmlIntoDocument(doc, html);
  }

  function isMeaningfulNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) return normalizeText(node.nodeValue).length > 0;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.tagName === 'BR') return false;
    if (normalizeText(node.textContent).length > 0) return true;
    return Boolean(node.querySelector('img, table, iframe, object, video, audio, input, textarea, select, button, hr'));
  }

  function getFirstMeaningfulChild(root) {
    if (!root) return null;
    return Array.from(root.childNodes).find((node) => isMeaningfulNode(node)) || null;
  }

  function isSelectionAtEditorStart(doc) {
    if (!doc || !doc.body) return false;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    if (!doc.body.contains(range.startContainer)) return false;
    try {
      const before = range.cloneRange();
      before.selectNodeContents(doc.body);
      before.setEnd(range.startContainer, range.startOffset);
      if (normalizeText(before.toString()).length > 0) return false;
      const fragment = before.cloneContents();
      return !Array.from(fragment.childNodes).some((node) => isMeaningfulNode(node));
    } catch (_) {
      return false;
    }
  }

  function createLeadingBlankBlock(doc) {
    const first = getFirstMeaningfulChild(doc.body);
    let block = null;
    if (first && first.nodeType === Node.ELEMENT_NODE && /^(P|DIV)$/i.test(first.tagName)) {
      block = first.cloneNode(false);
      block.removeAttribute('id');
      block.removeAttribute('name');
    } else {
      block = doc.createElement('p');
    }
    block.innerHTML = '<br data-mce-bogus="1">';
    doc.body.insertBefore(block, first || doc.body.firstChild);
    return block;
  }

  function setCaretInsideNode(doc, node) {
    try {
      const selection = doc.getSelection();
      const range = doc.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {}
  }

  function patchLeadingEnter(field, doc, event) {
    if (!event || event.key !== 'Enter') return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
    if (!isSelectionAtEditorStart(doc)) return false;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    const applyPatch = () => {
      const block = createLeadingBlankBlock(doc);
      setCaretInsideNode(doc, block);
    };
    const editor = getTinyMceEditor(field);
    if (editor && editor.undoManager && typeof editor.undoManager.transact === 'function') {
      try {
        editor.undoManager.transact(applyPatch);
      } catch (_) {
        applyPatch();
      }
    } else {
      applyPatch();
    }
    return true;
  }

  function applyAltEditors() {
    const api = window[CONFIG.altEditorApiName];
    if (!api || typeof api.apply !== 'function') return;
    try {
      api.apply();
    } catch (_) {}
  }

  function getPasteModal() {
    if (STATE.pasteModal) return STATE.pasteModal;
    const backdrop = document.createElement('div');
    backdrop.className = 'tm-salic-paste-backdrop';
    const modal = document.createElement('div');
    modal.className = 'tm-salic-paste-modal';

    const title = document.createElement('div');
    title.className = 'tm-salic-paste-title';
    title.textContent = 'Colar com formatacao';

    const helper = document.createElement('div');
    helper.textContent = 'Use Ctrl+V abaixo. O texto sera inserido com a formatacao capturada.';

    const editor = document.createElement('div');
    editor.className = 'tm-salic-paste-editor';
    editor.contentEditable = 'true';

    const actions = document.createElement('div');
    actions.className = 'tm-salic-paste-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'tm-salic-btn tm-salic-btn-secondary';
    cancel.textContent = 'Cancelar';
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'tm-salic-btn';
    insert.textContent = 'Inserir';
    actions.appendChild(cancel);
    actions.appendChild(insert);

    modal.appendChild(title);
    modal.appendChild(helper);
    modal.appendChild(editor);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const state = { backdrop, modal, editor, insert, cancel, field: null };
    const close = () => {
      state.field = null;
      editor.innerHTML = '';
      backdrop.style.display = 'none';
    };
    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    state.close = close;
    STATE.pasteModal = state;
    return state;
  }

  function openPasteModal(field) {
    const modal = getPasteModal();
    modal.field = field;
    modal.backdrop.style.display = 'flex';
    setTimeout(() => modal.editor.focus(), 0);
    modal.insert.onclick = () => {
      const html = modal.editor.innerHTML || '';
      const text = modal.editor.innerText || '';
      const payload = html || (text ? plainTextToHtml(text) : '');
      if (!payload || !modal.field) {
        modal.close();
        return;
      }
      const iframe = getEditorIframe(modal.field);
      const altEntry = getAltEditorEntry(modal.field);
      const doc = altEntry && altEntry.body ? altEntry.body.ownerDocument : (iframe ? iframe.contentDocument : document);
      if (altEntry && altEntry.body) altEntry.body.focus();
      const ok = insertHtmlIntoEditor(modal.field, doc, payload);
      if (ok) {
        const value = getFieldValue(modal.field);
        const comparable = normalizeValue(value);
        STATE.userEdited.set(modal.field, true);
        STATE.lastValue.set(modal.field, comparable);
        updateHiddenTextarea(modal.field, value);
        scheduleSave(modal.field, getFieldKey(modal.field));
      }
      modal.close();
    };
  }

  function pasteFormattedFromClipboard(field) {
    if (!field) return;
    const iframe = getEditorIframe(field);
    const altEntry = getAltEditorEntry(field);
    const doc = altEntry && altEntry.body ? altEntry.body.ownerDocument : (iframe ? iframe.contentDocument : document);
    const handlePayload = (html, text) => {
      const payload = html || (text ? plainTextToHtml(text) : '');
      if (!payload) return false;
      if (altEntry && altEntry.body) altEntry.body.focus();
      const ok = insertHtmlIntoEditor(field, doc, payload);
      if (!ok) return false;
      const value = getFieldValue(field);
      const comparable = normalizeValue(value);
      STATE.userEdited.set(field, true);
      STATE.lastValue.set(field, comparable);
      updateHiddenTextarea(field, value);
      scheduleSave(field, getFieldKey(field));
      return true;
    };

    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then((items) => {
        let html = '';
        let text = '';
        const item = items && items[0];
        if (!item) return openPasteModal(field);
        const htmlType = item.types.find((type) => type === 'text/html');
        const textType = item.types.find((type) => type === 'text/plain');
        const htmlPromise = htmlType ? item.getType(htmlType).then((blob) => blob.text()) : Promise.resolve('');
        const textPromise = textType ? item.getType(textType).then((blob) => blob.text()) : Promise.resolve('');
        Promise.all([htmlPromise, textPromise]).then((values) => {
          html = values[0] || '';
          text = values[1] || '';
          if (!handlePayload(html, text)) openPasteModal(field);
        }).catch(() => openPasteModal(field));
      }).catch(() => openPasteModal(field));
      return;
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((text) => {
        if (!handlePayload('', text)) openPasteModal(field);
      }).catch(() => openPasteModal(field));
      return;
    }

    openPasteModal(field);
  }

  function getStoredTextEntries() {
    const projectId = getProjectId();
    const prefix = `tm-salic-localmem::${projectId}::`;
    const fieldsByKey = new Map();
    Array.from(document.querySelectorAll('textarea')).forEach((field) => {
      if (!isEligibleField(field)) return;
      fieldsByKey.set(getFieldKey(field), field);
    });

    return storageListKeys()
      .filter((key) => typeof key === 'string' && key.startsWith(prefix))
      .map((key) => {
        const stored = storageGet(key);
        if (stored === null || stored === undefined || isValueEmpty(stored)) return null;
        const field = fieldsByKey.get(key);
        const label = field ? getStructuralFieldLabel(field) : '';
        const identity = key.slice(prefix.length);
        return {
          key,
          identity,
          label: normalizeText(label) || identity,
          text: htmlToPlainText(stored).trim()
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' }));
  }

  function getStoredHtmlEntries() {
    const projectId = getProjectId();
    const prefix = `tm-salic-localmem::${projectId}::`;
    const fieldsByKey = new Map();
    Array.from(document.querySelectorAll('textarea')).forEach((field) => {
      if (!isEligibleField(field)) return;
      fieldsByKey.set(getFieldKey(field), field);
    });

    return storageListKeys()
      .filter((key) => typeof key === 'string' && key.startsWith(prefix))
      .map((key) => {
        const stored = storageGet(key);
        if (stored === null || stored === undefined || isValueEmpty(stored)) return null;
        const field = fieldsByKey.get(key);
        const label = field ? getStructuralFieldLabel(field) : '';
        const identity = key.slice(prefix.length);
        return {
          key,
          identity,
          label: normalizeText(label) || identity,
          html: String(stored)
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' }));
  }

  function downloadTextFile(fileName, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function exportProjectTexts() {
    const entries = getStoredTextEntries();
    if (!entries.length) {
      window.alert('Nenhum texto salvo para exportar neste projeto.');
      return;
    }
    const projectId = getProjectId();
    const lines = [
      'SALIC Melhorias Locais',
      `Projeto: ${projectId}`,
      `Pagina: ${window.location.href}`,
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      ''
    ];

    entries.forEach((entry, index) => {
      lines.push(`[${index + 1}] ${entry.label}`);
      lines.push(`Chave: ${entry.identity}`);
      lines.push('');
      lines.push(entry.text || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`salic-rascunhos-${projectId}-${stamp}.txt`, `${lines.join('\n').trimEnd()}\n`);
  }

  function exportProjectHtml() {
    const entries = getStoredHtmlEntries();
    if (!entries.length) {
      window.alert('Nenhum texto salvo para exportar neste projeto.');
      return;
    }
    const projectId = getProjectId();
    const generatedAt = new Date().toLocaleString('pt-BR');
    const body = entries.map((entry, index) => `
      <article class="tm-export-card">
        <header class="tm-export-card-header">
          <div class="tm-export-index">${String(index + 1).padStart(2, '0')}</div>
          <div class="tm-export-heading-wrap">
            <h2 class="tm-export-heading">${escapeHtml(entry.label)}</h2>
            <div class="tm-export-meta">Chave: ${escapeHtml(entry.identity)}</div>
          </div>
        </header>
        <div class="tm-export-actions">
          <button type="button" class="tm-export-copy">Copiar conteúdo</button>
        </div>
        <div class="tm-export-content">${entry.html}</div>
      </article>
    `).join('\n');

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Power Salic ${escapeHtml(projectId)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg-start: #edf4ff;
      --bg-end: #f7f8fb;
      --ink: #152033;
      --muted: #5f6b7a;
      --panel: rgba(255, 255, 255, .9);
      --panel-solid: #fff;
      --border: #dbe3ef;
      --border-strong: #c6d2e3;
      --accent: #114b8f;
      --accent-soft: #e9f1ff;
      --shadow: 0 18px 42px rgba(17, 32, 51, .10);
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      padding: clamp(16px, 3vw, 32px);
      background:
        radial-gradient(circle at top left, rgba(17, 75, 143, .14), transparent 36%),
        radial-gradient(circle at top right, rgba(73, 159, 255, .12), transparent 30%),
        linear-gradient(180deg, var(--bg-start), var(--bg-end));
      color: var(--ink);
      font: 15px/1.55 Arial, sans-serif;
    }
    .tm-export-shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: clamp(18px, 3vw, 30px);
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.6rem, 2.3vw, 2.35rem);
      line-height: 1.1;
      letter-spacing: -.02em;
    }
    .tm-export-subtitle {
      margin: 0 0 20px;
      color: var(--muted);
      font-size: .98rem;
    }
    .tm-export-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 26px;
    }
    .tm-export-summary-item {
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--panel-solid);
    }
    .tm-export-summary-label {
      display: block;
      margin-bottom: 4px;
      color: var(--muted);
      font-size: .76rem;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .tm-export-summary-value {
      font-size: .98rem;
      font-weight: 700;
      word-break: break-word;
    }
    .tm-export-info {
      margin: 0 0 24px;
      color: var(--muted);
      font-size: .92rem;
    }
    .tm-export-card {
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--panel-solid);
    }
    .tm-export-card + .tm-export-card {
      margin-top: 18px;
    }
    .tm-export-card-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 14px;
    }
    .tm-export-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 800;
      font-size: .95rem;
    }
    .tm-export-heading-wrap {
      min-width: 0;
      flex: 1 1 auto;
    }
    .tm-export-heading {
      margin: 0;
      font-size: 1.1rem;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .tm-export-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: .86rem;
      overflow-wrap: anywhere;
    }
    .tm-export-actions {
      display: flex;
      justify-content: flex-end;
      margin: 0 0 12px;
    }
    .tm-export-copy {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .35rem;
      padding: .5rem .8rem;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font: 700 .84rem/1 Arial, sans-serif;
      cursor: pointer;
      transition: transform .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease;
    }
    .tm-export-copy:hover,
    .tm-export-copy:focus {
      border-color: var(--accent);
      background: #dce9ff;
      color: #0d3b75;
      transform: translateY(-1px);
      outline: none;
    }
    .tm-export-content {
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #fbfcfe;
      color: var(--ink);
      overflow-wrap: anywhere;
      line-height: 1.7;
    }
    .tm-export-content > :first-child {
      margin-top: 0;
    }
    .tm-export-content > :last-child {
      margin-bottom: 0;
    }
    .tm-export-content p {
      margin: 0 0 1em;
    }
    .tm-export-content p:last-child {
      margin-bottom: 0;
    }
    .tm-export-content h1,
    .tm-export-content h2,
    .tm-export-content h3,
    .tm-export-content h4,
    .tm-export-content h5,
    .tm-export-content h6 {
      margin: 1.1em 0 .5em;
      line-height: 1.2;
    }
    .tm-export-content ul,
    .tm-export-content ol {
      margin: 0 0 1em 1.4em;
      padding: 0;
    }
    .tm-export-content li + li {
      margin-top: .35em;
    }
    .tm-export-content blockquote {
      margin: 0 0 1em;
      padding: .9rem 1rem;
      border-left: 4px solid var(--accent);
      border-radius: 10px;
      background: #eef5ff;
      color: #25364a;
    }
    .tm-export-content pre {
      margin: 0 0 1em;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #0f172a;
      color: #e2e8f0;
      overflow-x: auto;
      white-space: pre;
    }
    .tm-export-content code {
      padding: .12rem .3rem;
      border-radius: 6px;
      background: rgba(15, 23, 42, .08);
      font-family: Consolas, 'Courier New', monospace;
      font-size: .92em;
    }
    .tm-export-content pre code {
      padding: 0;
      background: transparent;
      color: inherit;
    }
    .tm-export-content img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
    }
    .tm-export-content table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      display: block;
      max-width: 100%;
      overflow-x: auto;
    }
    .tm-export-content td,
    .tm-export-content th {
      border: 1px solid #d1d5db;
      padding: .5rem .65rem;
      vertical-align: top;
    }
    .tm-export-content hr {
      border: 0;
      border-top: 1px solid #d7deea;
      margin: 1.2em 0;
    }
    .tm-export-content a {
      color: var(--accent);
    }
    .tm-export-content details {
      margin: 0 0 1em;
      padding: .75rem 1rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #fff;
    }
    @media (max-width: 860px) {
      .tm-export-summary {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      body {
        padding: 12px;
      }
      .tm-export-shell {
        padding: 14px;
        border-radius: 16px;
      }
      .tm-export-card {
        padding: 14px;
      }
      .tm-export-card-header {
        gap: 10px;
      }
      .tm-export-index {
        width: 2.1rem;
        height: 2.1rem;
      }
      .tm-export-content {
        padding: 14px;
      }
      .tm-export-content table {
        display: block;
      }
      .tm-export-actions {
        justify-content: stretch;
      }
      .tm-export-copy {
        width: 100%;
      }
    }
    @media print {
      body {
        background: #fff;
        padding: 0;
      }
      .tm-export-shell {
        box-shadow: none;
        border: 0;
        border-radius: 0;
        background: #fff;
      }
      .tm-export-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="tm-export-shell">
    <h1>Power Salic</h1>
    <p class="tm-export-subtitle">Exportação em HTML com a formatação preservada dos rascunhos salvos localmente.</p>
    <section class="tm-export-summary" aria-label="Resumo da exportação">
      <div class="tm-export-summary-item">
        <span class="tm-export-summary-label">Projeto</span>
        <span class="tm-export-summary-value">${escapeHtml(projectId)}</span>
      </div>
      <div class="tm-export-summary-item">
        <span class="tm-export-summary-label">Campos exportados</span>
        <span class="tm-export-summary-value">${entries.length}</span>
      </div>
      <div class="tm-export-summary-item">
        <span class="tm-export-summary-label">Gerado em</span>
        <span class="tm-export-summary-value">${escapeHtml(generatedAt)}</span>
      </div>
    </section>
    <div class="tm-export-info">Página: ${escapeHtml(window.location.href)}</div>
    ${body}
  </main>
  <script>
    (function () {
      function copyHtmlContent(button) {
        const card = button.closest('.tm-export-card');
        if (!card) return;
        const content = card.querySelector('.tm-export-content');
        if (!content) return;
        const html = content.innerHTML;
        const text = content.innerText;

        function markDone(message) {
          const previous = button.textContent;
          button.textContent = message;
          button.disabled = true;
          window.setTimeout(function () {
            button.textContent = previous;
            button.disabled = false;
          }, 1200);
        }

        if (navigator.clipboard && navigator.clipboard.write) {
          const items = [
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' })
            })
          ];
          navigator.clipboard.write(items).then(function () {
            markDone('Copiado');
          }).catch(function () {
            fallbackCopy(html, text);
          });
          return;
        }

        fallbackCopy(html, text);

        function fallbackCopy(htmlValue, textValue) {
          var fallback = document.createElement('textarea');
          fallback.value = textValue;
          fallback.setAttribute('readonly', 'readonly');
          fallback.style.position = 'fixed';
          fallback.style.top = '-9999px';
          fallback.style.left = '-9999px';
          document.body.appendChild(fallback);
          fallback.select();
          try {
            document.execCommand('copy');
            markDone('Copiado');
          } catch (_) {
            markDone('Falhou');
          } finally {
            fallback.remove();
          }
        }
      }

      document.addEventListener('click', function (event) {
        var button = event.target.closest('.tm-export-copy');
        if (!button) return;
        copyHtmlContent(button);
      });
    })();
  </script>
</body>
</html>`;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `salic-rascunhos-${projectId}-${stamp}.html`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clearUiMemoryCache() {
    const projectId = getProjectId();
    const uiPrefixes = [
      `${CONFIG.collapsibleStatePrefix}::${projectId}::`,
      `${CONFIG.tabStatePrefix}::${projectId}::`,
      `${CONFIG.filterStatePrefix}::${projectId}::`
    ];
    storageListKeys().forEach((key) => {
      if (typeof key !== 'string') return;
      if (uiPrefixes.some((prefix) => key.startsWith(prefix))) {
        storageRemove(key);
      }
    });
    if (STATE.collapsibleRestoreTimer) {
      clearTimeout(STATE.collapsibleRestoreTimer);
      STATE.collapsibleRestoreTimer = null;
    }
    if (STATE.tabRestoreTimer) {
      clearTimeout(STATE.tabRestoreTimer);
      STATE.tabRestoreTimer = null;
    }
    if (STATE.filterRestoreTimer) {
      clearTimeout(STATE.filterRestoreTimer);
      STATE.filterRestoreTimer = null;
    }
  }

  function updateSettingSwitch(button, stateText, enabled) {
    button.setAttribute('aria-checked', enabled ? 'true' : 'false');
    button.title = enabled ? 'Ativado' : 'Desativado';
    stateText.textContent = enabled ? 'Ativado' : 'Desativado';
  }

  function createSettingToggle(labelText, descriptionText, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'tm-salic-settings-row';

    const label = document.createElement('div');
    label.className = 'tm-salic-settings-label';

    const title = document.createElement('span');
    title.className = 'tm-salic-settings-title';
    title.textContent = labelText;

    const state = document.createElement('span');
    state.className = 'tm-salic-settings-state';

    if (descriptionText) {
      const description = document.createElement('span');
      description.className = 'tm-salic-settings-state';
      description.textContent = descriptionText;
      label.appendChild(title);
      label.appendChild(description);
      label.appendChild(state);
    } else {
      label.appendChild(title);
      label.appendChild(state);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-salic-switch';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', labelText);
    const knob = document.createElement('span');
    knob.className = 'tm-salic-switch-knob';
    button.appendChild(knob);

    let enabled = Boolean(checked);
    updateSettingSwitch(button, state, enabled);
    button.addEventListener('click', () => {
      enabled = !enabled;
      updateSettingSwitch(button, state, enabled);
      onChange(enabled);
    });

    row.appendChild(label);
    row.appendChild(button);
    return row;
  }

  function createNumberStepper(labelText, descriptionText, value, min, max, onChange) {
    const row = document.createElement('div');
    row.className = 'tm-salic-settings-row';

    const label = document.createElement('div');
    label.className = 'tm-salic-settings-label';

    const title = document.createElement('span');
    title.className = 'tm-salic-settings-title';
    title.textContent = labelText;

    const description = document.createElement('span');
    description.className = 'tm-salic-settings-state';
    description.textContent = descriptionText;

    label.appendChild(title);
    label.appendChild(description);

    const stepper = document.createElement('div');
    stepper.className = 'tm-salic-stepper';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '-';
    minus.setAttribute('aria-label', `Diminuir ${labelText}`);

    const number = document.createElement('span');
    number.className = 'tm-salic-stepper-value';

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Aumentar ${labelText}`);

    let currentValue = clampNumber(value, min, max);
    const update = (nextValue) => {
      currentValue = clampNumber(nextValue, min, max);
      number.textContent = String(currentValue);
      minus.disabled = currentValue <= min;
      plus.disabled = currentValue >= max;
      onChange(currentValue);
    };

    minus.addEventListener('click', () => update(currentValue - 1));
    plus.addEventListener('click', () => update(currentValue + 1));
    number.textContent = String(currentValue);
    minus.disabled = currentValue <= min;
    plus.disabled = currentValue >= max;

    stepper.appendChild(minus);
    stepper.appendChild(number);
    stepper.appendChild(plus);
    row.appendChild(label);
    row.appendChild(stepper);
    return row;
  }

  function positionSettingsMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    const menuWidth = Math.min(320, window.innerWidth - margin * 2);
    menu.style.width = `${menuWidth}px`;
    menu.style.display = 'block';

    const measuredHeight = menu.offsetHeight || 180;
    const fitsBelow = rect.bottom + gap + measuredHeight <= window.innerHeight - margin;
    const top = fitsBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - measuredHeight);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - menuWidth - margin)
    );

    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  }

  function hideSettingsMenu() {
    const menu = document.getElementById(CONFIG.settingsMenuId);
    if (menu) {
      menu.style.display = 'none';
      menu.style.top = '';
      menu.style.left = '';
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    }
    const button = document.getElementById(CONFIG.settingsButtonId);
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function placeSettingsRoot(root) {
    const shortcutsList = document.querySelector('#atalhos > ul');
    if (shortcutsList) {
      let host = document.getElementById(CONFIG.settingsHostId);
      if (!host) {
        host = document.createElement('li');
        host.id = CONFIG.settingsHostId;
        host.className = 'tm-salic-settings-host';
      }
      const sessionItem = document.querySelector('#cronometro-sessao')?.closest('li');
      if (sessionItem && sessionItem.parentElement === shortcutsList) {
        shortcutsList.insertBefore(host, sessionItem);
      } else if (!host.parentElement) {
        shortcutsList.appendChild(host);
      }
      host.appendChild(root);
      return;
    }
    const sidebarInfo = document.querySelector('#sidenav .sidebar-info');
    if (sidebarInfo) {
      sidebarInfo.appendChild(root);
      return;
    }
    const form = document.querySelector('form#frmProposta');
    if (form) {
      form.insertAdjacentElement('afterbegin', root);
      return;
    }
    document.body.appendChild(root);
  }

  function addSettingsMenu() {
    const existingRoot = document.getElementById(CONFIG.settingsRootId);
    const existingMenu = document.getElementById(CONFIG.settingsMenuId);
    if (existingRoot && existingMenu) return;
    if (existingRoot && !existingMenu) existingRoot.remove();
    if (existingMenu && !existingRoot) existingMenu.remove();

    injectStyles();
    const root = document.createElement('div');
    root.id = CONFIG.settingsRootId;
    root.className = 'tm-salic-settings';

    const button = document.createElement('button');
    button.id = CONFIG.settingsButtonId;
    button.type = 'button';
    button.innerHTML = '<i class="bi bi-gear-fill tm-salic-btn-icon" aria-hidden="true"></i><span>Configuracao</span>';
    button.className = 'tm-salic-btn tm-salic-dropdown-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', CONFIG.settingsMenuId);

    const menu = document.createElement('div');
    menu.id = CONFIG.settingsMenuId;
    menu.className = 'tm-salic-dropdown-menu';
    menu.setAttribute('role', 'menu');

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.innerHTML = '<i class="bi bi-trash3 tm-salic-btn-icon" aria-hidden="true"></i><span>Limpar rascunhos salvos</span>';
    clearButton.className = 'tm-salic-btn tm-salic-btn-danger';
    clearButton.addEventListener('click', () => {
      const ok = window.confirm('Limpar todos os dados salvos deste projeto?');
      if (!ok) return;
      clearProjectCache();
      hideSettingsMenu();
    });

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.innerHTML = '<i class="bi bi-filetype-txt tm-salic-btn-icon" aria-hidden="true"></i><span>Exportar TXT</span>';
    exportButton.className = 'tm-salic-btn tm-salic-btn-secondary';
    exportButton.addEventListener('click', () => {
      exportProjectTexts();
      hideSettingsMenu();
    });

    const exportHtmlButton = document.createElement('button');
    exportHtmlButton.type = 'button';
    exportHtmlButton.innerHTML = '<i class="bi bi-filetype-html tm-salic-btn-icon" aria-hidden="true"></i><span>Exportar HTML</span>';
    exportHtmlButton.className = 'tm-salic-btn tm-salic-btn-secondary';
    exportHtmlButton.addEventListener('click', () => {
      exportProjectHtml();
      hideSettingsMenu();
    });

    const updateScriptsButton = document.createElement('button');
    updateScriptsButton.type = 'button';
    updateScriptsButton.innerHTML = '<i class="bi bi-arrow-repeat tm-salic-btn-icon" aria-hidden="true"></i><span>Atualizar scripts</span>';
    updateScriptsButton.className = 'tm-salic-btn tm-salic-btn-secondary';
    updateScriptsButton.addEventListener('click', () => {
      refreshScriptsWithoutReinstall();
      hideSettingsMenu();
    });

    const autoSaveToggle = createSettingToggle('Autosave', 'Salva textos longos enquanto voce digita.', isAutoSaveEnabled(), (checked) => {
      setSetting(CONFIG.autoSaveKey, checked);
      if (checked) {
        scanFields();
      } else {
        hideAutoSaveUi();
      }
    });

    const hideDeleteToggle = createSettingToggle('Esconder excluir', 'Oculta o botao de excluir proposta.', isHideDeleteEnabled(), (checked) => {
      setSetting(CONFIG.hideDeleteKey, checked);
      applyDeleteButtonVisibility(checked);
    });

    const uiMemoryToggle = createSettingToggle('Lembrar tela', 'Lembra abas, menus abertos e filtros. Desativar limpa so essa memoria.', isUiMemoryEnabled(), (checked) => {
      setSetting(CONFIG.uiMemoryKey, checked);
      if (!checked) {
        clearUiMemoryCache();
      } else {
        scheduleCollapsibleRestore();
        scheduleTabRestore();
      }
    });

    const reactSelectToggle = createSettingToggle('Busca em listas', 'Troca selects grandes por listas com busca.', isReactSelectEnabled(), (checked) => {
      setSetting(CONFIG.reactSelectKey, checked);
    });

    const reactSelectOriginalToggle = createSettingToggle('Select original', 'Mostra tambem o dropdown nativo.', isReactSelectOriginalVisible(), (checked) => {
      setSetting(CONFIG.reactSelectShowOriginalKey, checked);
    });

    const richPasteToggle = createSettingToggle('Colar formatado', 'Permite colar mantendo a formatacao do texto.', isRichPasteEnabled(), (checked) => {
      setSetting(CONFIG.richPasteKey, checked);
      updateAllPasteButtonsVisibility();
    });

    const altEditorToggle = createSettingToggle('Editor alternativo', 'Substitui o editor atual por um mais simples e moderno.', isAltEditorEnabled(), (checked) => {
      setSetting(CONFIG.altEditorKey, checked);
      applyAltEditors();
      scanFields();
    });

    const reactSelectMinOptions = createNumberStepper(
      'Minimo de opcoes',
      'So usa busca quando houver opcoes suficientes.',
      getReactSelectMinOptions(),
      CONFIG.reactSelectMinOptionsMin,
      CONFIG.reactSelectMinOptionsMax,
      (value) => {
        setNumberSetting(CONFIG.reactSelectMinOptionsKey, value, CONFIG.reactSelectMinOptionsMin, CONFIG.reactSelectMinOptionsMax);
      }
    );

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'tm-salic-settings-actions';
    const actionsRow = document.createElement('div');
    actionsRow.className = 'tm-salic-settings-actions-row';
    actionsRow.appendChild(exportButton);
    actionsRow.appendChild(exportHtmlButton);
    actionsWrap.appendChild(actionsRow);
    actionsWrap.appendChild(updateScriptsButton);
    actionsWrap.appendChild(clearButton);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = menu.style.display === 'none' || !menu.style.display;
      if (shouldOpen) {
        positionSettingsMenu(button, menu);
        button.setAttribute('aria-expanded', 'true');
      } else {
        hideSettingsMenu();
        button.setAttribute('aria-expanded', 'false');
      }
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    if (!STATE.settingsListenersReady) {
      STATE.settingsListenersReady = true;
      document.addEventListener('click', (event) => {
        const activeMenu = document.getElementById(CONFIG.settingsMenuId);
        const activeButton = document.getElementById(CONFIG.settingsButtonId);
        if (!activeMenu || activeMenu.style.display === 'none') return;
        if ((activeButton && activeButton.contains(event.target)) || activeMenu.contains(event.target)) return;
        hideSettingsMenu();
      });
      window.addEventListener('resize', hideSettingsMenu);
      window.addEventListener('scroll', hideSettingsMenu);
    }

    menu.appendChild(autoSaveToggle);
    menu.appendChild(hideDeleteToggle);
    menu.appendChild(uiMemoryToggle);
    menu.appendChild(reactSelectToggle);
    menu.appendChild(reactSelectOriginalToggle);
    menu.appendChild(richPasteToggle);
    menu.appendChild(altEditorToggle);
    menu.appendChild(reactSelectMinOptions);
    menu.appendChild(actionsWrap);
    root.appendChild(button);
    placeSettingsRoot(root);
    document.body.appendChild(menu);
  }

  function saveField(field, key) {
    if (!isEligibleField(field)) return;
    if (!isAutoSaveEnabled()) {
      hideAutoSaveUi();
      return;
    }
    try {
      const ok = storageSet(key, getFieldValue(field));
      setStatus(field, ok ? CONFIG.statusSaved : CONFIG.statusError);
    } catch (err) {
      setStatus(field, CONFIG.statusError);
    }
  }

  function scheduleSave(field, key) {
    if (!isEligibleField(field)) return;
    if (!isAutoSaveEnabled()) {
      hideAutoSaveUi();
      return;
    }
    setStatus(field, CONFIG.statusSaving);
    const prev = STATE.timers.get(field);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      saveField(field, key);
    }, CONFIG.saveDelayMs);
    STATE.timers.set(field, timer);
  }

  function restoreFieldIfEmpty(field, key) {
    const stored = storageGet(key);
    if (stored === null || stored === undefined) return;
    if (!isValueEmpty(getFieldValue(field)) ) return;
    setFieldValue(field, stored);
    setStatus(field, CONFIG.statusRestored);
  }

  function restoreField(field, key) {
    const stored = storageGet(key);
    if (stored === null || stored === undefined) {
      setStatus(field, CONFIG.statusEmpty);
      return;
    }
    setFieldValue(field, stored);
    STATE.lastValue.set(field, normalizeValue(getFieldValue(field)));
    setStatus(field, CONFIG.statusRestored);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyFieldValue(field, value) {
    const nextValue = value === null || value === undefined ? '' : String(value);
    const tag = field.tagName.toLowerCase();
    if (tag === 'input') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(field, nextValue);
        return;
      }
    }
    if (tag === 'textarea') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(field, nextValue);
        return;
      }
    }
    field.value = nextValue;
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

  function wireField(field) {
    if (!isEligibleField(field)) return;
    if (field.dataset.tmLocalmemProcessed === '1') return;

    const key = getFieldKey(field);
    const stored = storageGet(key);
    restoreFieldIfEmpty(field, key);
    updateRestoreButton(field, key);
    const currentValue = getFieldValue(field);
    if (stored !== null && stored !== undefined) {
      if (!isValueEmpty(currentValue) && String(stored) !== String(currentValue)) {
        setStatus(field, CONFIG.statusServerDiff);
      } else {
        setStatus(field, CONFIG.statusSaved);
      }
    } else {
      setStatus(field, CONFIG.statusIdle);
    }
    STATE.lastValue.set(field, getFieldValue(field));
    STATE.userEdited.set(field, false);

    const onInput = () => {
      const value = getFieldValue(field);
      const comparable = normalizeValue(value);
      if (STATE.lastValue.get(field) === comparable) return;
      STATE.userEdited.set(field, true);
      STATE.lastValue.set(field, comparable);
      updateHiddenTextarea(field, value);
      scheduleSave(field, key);
    };

    field.addEventListener('input', onInput);
    field.addEventListener('change', onInput);
    field.addEventListener('keyup', onInput);
    field.addEventListener('paste', onInput);
    field.addEventListener('cut', onInput);

    if (!STATE.pollers.get(field)) {
      const poller = setInterval(() => {
        if (!field.isConnected) {
          clearInterval(poller);
          STATE.pollers.delete(field);
          return;
        }
        if (!STATE.userEdited.get(field) && !isEditorFocused(field)) return;
        const value = getFieldValue(field);
        const comparable = normalizeValue(value);
        if (STATE.lastValue.get(field) === comparable) return;
        STATE.lastValue.set(field, comparable);
        updateHiddenTextarea(field, value);
        scheduleSave(field, key);
      }, CONFIG.pollIntervalMs);
      STATE.pollers.set(field, poller);
    }

    const iframe = getEditorIframe(field);
    if (iframe) {
      const bindEditor = () => {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return false;
        const initialValue = getFieldValue(field);
        STATE.lastValue.set(field, normalizeValue(initialValue));
        updateHiddenTextarea(field, initialValue);
        STATE.userEdited.set(field, false);
        const onEditorFocus = () => {
          const value = getFieldValue(field);
          STATE.lastValue.set(field, normalizeValue(value));
          STATE.userEdited.set(field, false);
        };
        const onEditorInput = () => {
          const value = getFieldValue(field);
          const comparable = normalizeValue(value);
          if (STATE.lastValue.get(field) === comparable) return;
          STATE.userEdited.set(field, true);
          STATE.lastValue.set(field, comparable);
          updateHiddenTextarea(field, value);
          scheduleSave(field, key);
        };
        const onEditorPaste = (event) => {
          if (!isRichPasteEnabled()) return;
          if (!event.clipboardData) return;
          const html = event.clipboardData.getData('text/html');
          const plain = event.clipboardData.getData('text/plain');
          const payload = html || (plain ? plainTextToHtml(plain) : '');
          if (!payload) return;
          const ok = insertHtmlIntoEditor(field, doc, payload);
          if (!ok) return;
          event.preventDefault();
          event.stopPropagation();
          const value = getFieldValue(field);
          const comparable = normalizeValue(value);
          STATE.userEdited.set(field, true);
          STATE.lastValue.set(field, comparable);
          updateHiddenTextarea(field, value);
          scheduleSave(field, key);
        };
        const onEditorKeydown = (event) => {
          if (!patchLeadingEnter(field, doc, event)) return;
          const value = getFieldValue(field);
          const comparable = normalizeValue(value);
          STATE.userEdited.set(field, true);
          STATE.lastValue.set(field, comparable);
          updateHiddenTextarea(field, value);
          scheduleSave(field, key);
        };
        doc.addEventListener('keydown', onEditorKeydown, true);
        doc.addEventListener('input', onEditorInput);
        doc.addEventListener('keyup', onEditorInput);
        doc.addEventListener('paste', onEditorPaste, true);
        doc.addEventListener('cut', onEditorInput);
        doc.addEventListener('focusin', onEditorFocus);
        return true;
      };
      if (!bindEditor()) {
        iframe.addEventListener('load', () => {
          bindEditor();
        });
      }
    }

    const status = ensureStatusEl(field);
    const restoreBtn = status.querySelector('[data-tm-localmem-restore="1"]');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        restoreField(field, key);
        updateRestoreButton(field, key);
      });
    }
    const pasteBtn = status.querySelector('[data-tm-localmem-paste="1"]');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => {
        pasteFormattedFromClipboard(field);
      });
    }
    field.dataset.tmLocalmemProcessed = '1';
  }

  function refreshFieldStatus(field) {
    if (!isEligibleField(field)) return;
    const key = getFieldKey(field);
    const stored = storageGet(key);
    updateRestoreButton(field, key);
    const currentValue = getFieldValue(field);
    if (stored !== null && stored !== undefined) {
      if (!isValueEmpty(currentValue) && String(stored) !== String(currentValue)) {
        setStatus(field, CONFIG.statusServerDiff);
      } else {
        setStatus(field, CONFIG.statusSaved);
      }
    } else {
      setStatus(field, CONFIG.statusIdle);
    }
    updatePasteButtonVisibility(field);
  }

  function cleanupReactSelectAutosaveUi() {
    const wrappers = Array.from(document.querySelectorAll(CONFIG.reactSelectIgnoreSelector));
    wrappers.forEach((wrapper) => {
      wrapper.querySelectorAll(`.${CONFIG.statusClass}`).forEach((status) => status.remove());
      wrapper.querySelectorAll('[data-tm-localmem-processed="1"]').forEach((field) => {
        field.removeAttribute('data-tm-localmem-processed');
      });
    });
    const dropdownFields = Array.from(document.querySelectorAll('input[type="text"][role="combobox"], input[type="text"][aria-haspopup], input[type="text"][aria-autocomplete], input[type="text"][aria-expanded]'));
    dropdownFields.forEach((field) => {
      const anchor = getStatusAnchor(field);
      const status = anchor.nextElementSibling;
      if (status && status.classList && status.classList.contains(CONFIG.statusClass)) {
        status.remove();
      }
      field.removeAttribute('data-tm-localmem-processed');
    });
  }

  function cleanupInputAutosaveUi() {
    const inputs = Array.from(document.querySelectorAll('input[data-tm-localmem-processed="1"]'));
    inputs.forEach((input) => {
      const anchor = getStatusAnchor(input);
      const status = anchor.nextElementSibling;
      if (status && status.classList && status.classList.contains(CONFIG.statusClass)) {
        status.remove();
      }
      input.removeAttribute('data-tm-localmem-processed');
    });
  }

  function scanFields() {
    cleanupReactSelectAutosaveUi();
    cleanupInputAutosaveUi();
    if (!isAutoSaveEnabled()) {
      hideAutoSaveUi();
      return;
    }
    const fields = Array.from(document.querySelectorAll('textarea'));
    fields.forEach((field) => {
      if (field.dataset.tmLocalmemProcessed === '1') {
        refreshFieldStatus(field);
        return;
      }
      wireField(field);
    });
  }

  function hideAutoSaveUi() {
    const fields = Array.from(document.querySelectorAll(`.${CONFIG.statusClass}`));
    fields.forEach((status) => {
      status.style.display = 'none';
    });
  }

  function getFileInputLabel(input) {
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    const parent = input.closest('.input-field') || input.parentElement;
    const label = parent ? parent.querySelector('label') : null;
    if (label && label.textContent.trim()) return label.textContent.trim();
    return 'Arquivo';
  }

  function getFileNames(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return 'Nenhum arquivo selecionado';
    return files.map((file) => file.name).join(', ');
  }

  function updateFileDropzone(input) {
    const dropzone = input.nextElementSibling;
    if (!dropzone || !dropzone.classList.contains('tm-salic-file-dropzone')) return;
    const fileName = dropzone.querySelector('[data-tm-salic-file-name="1"]');
    const fileHelp = dropzone.querySelector('.tm-salic-file-help');
    if (fileName) {
      fileName.textContent = getFileNames(input);
      const hasFile = input.files && input.files.length > 0;
      if (hasFile) {
        dropzone.classList.add('tm-salic-file-has-file');
        if (fileHelp) fileHelp.textContent = 'Clique para substituir';
      } else {
        dropzone.classList.remove('tm-salic-file-has-file');
        if (fileHelp) fileHelp.textContent = 'Arraste e solte o arquivo aqui ou clique para selecionar.';
      }
    }
  }

  function enhanceFileInput(input) {
    if (!input || input.dataset.tmSalicFileEnhanced === '1') return;
    input.dataset.tmSalicFileEnhanced = '1';
    input.classList.add('tm-salic-file-input-hidden');

    const dropzone = document.createElement('div');
    dropzone.className = 'tm-salic-file-dropzone';
    dropzone.tabIndex = 0;
    dropzone.setAttribute('role', 'button');
    dropzone.setAttribute('aria-label', `Selecionar ${getFileInputLabel(input)}`);

    const main = document.createElement('div');
    main.className = 'tm-salic-file-main';

    const icon = document.createElement('i');
    icon.className = 'bi bi-filetype-pdf tm-salic-file-icon';
    icon.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'tm-salic-file-content';

    const title = document.createElement('span');
    title.className = 'tm-salic-file-title';
    title.textContent = 'Anexar ' + escapeHtml(getFileInputLabel(input));

    const help = document.createElement('span');
    help.className = 'tm-salic-file-help';
    help.textContent = 'Arraste e solte o arquivo aqui ou clique para selecionar.';

    const name = document.createElement('span');
    name.className = 'tm-salic-file-name';
    name.dataset.tmSalicFileName = '1';
    name.textContent = getFileNames(input);

    main.appendChild(icon);
    content.appendChild(title);
    content.appendChild(help);
    content.appendChild(name);
    main.appendChild(content);
    dropzone.appendChild(main);
    input.insertAdjacentElement('afterend', dropzone);

    const openPicker = () => {
      input.click();
    };
    dropzone.addEventListener('click', openPicker);
    dropzone.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPicker();
    });
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add('tm-salic-file-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.remove('tm-salic-file-dragover');
      });
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      const files = event.dataTransfer ? event.dataTransfer.files : null;
      if (!files || !files.length) return;
      try {
        input.files = files;
      } catch (_) {
        return;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      updateFileDropzone(input);
    });
    input.addEventListener('change', () => updateFileDropzone(input));
    updateFileDropzone(input);
  }

  function scanFileInputs() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    inputs.forEach((input) => enhanceFileInput(input));
  }

  function rememberDisplay(target) {
    if (!target || target.dataset.tmSalicDisplaySaved === '1') return;
    target.dataset.tmSalicPreviousDisplay = target.style.display || '';
    target.dataset.tmSalicDisplaySaved = '1';
  }

  function restoreDisplay(target, fallbackDisplay) {
    if (!target) return;
    target.hidden = false;
    target.removeAttribute('aria-hidden');
    if (target.dataset.tmSalicDisplaySaved === '1') {
      target.style.display = target.dataset.tmSalicPreviousDisplay || '';
    } else {
      target.style.removeProperty('display');
    }
    if (window.getComputedStyle(target).display === 'none') {
      target.style.display = fallbackDisplay;
    }
  }

  function applyDeleteButtonVisibility(forceHide) {
    const link = document.querySelector(CONFIG.hideDeleteSelector);
    if (!link) return;
    const shouldHide = typeof forceHide === 'boolean' ? forceHide : isHideDeleteEnabled();
    const listItem = link.closest('li');
    if (shouldHide) {
      rememberDisplay(link);
      rememberDisplay(listItem);
      if (listItem) listItem.style.display = 'none';
      else link.style.display = 'none';
      return;
    }
    restoreDisplay(listItem, 'list-item');
    restoreDisplay(link, 'inline');
  }

  function getCollapsibleScope(item) {
    return item && item.closest('#sidenav') ? 'sidenav' : 'page';
  }

  function getCollapsibleStateKey(scope) {
    const normalizedScope = scope === 'sidenav' ? 'sidenav' : 'page';
    return [
      CONFIG.collapsibleStatePrefix,
      getProjectId(),
      normalizedScope === 'sidenav' ? 'sidebar' : window.location.pathname
    ].join('::');
  }

  function getDirectCollapsiblePart(item, className) {
    return Array.from(item.children || []).find((child) => child.classList && child.classList.contains(className)) || item.querySelector(`.${className}`);
  }

  function getCollapsibleItemKey(item) {
    const list = item.closest('ul.collapsible');
    const header = getDirectCollapsiblePart(item, 'collapsible-header');
    const siblings = list ? Array.from(list.children).filter((child) => child.tagName === 'LI') : [];
    const index = Math.max(0, siblings.indexOf(item));
    const listClass = list ? normalizeText(list.className) : '';
    const headerText = header ? normalizeText(header.textContent) : '';
    if (getCollapsibleScope(item) === 'sidenav') {
      const headerId = header ? (header.id || '') : '';
      const sidebarLists = Array.from(document.querySelectorAll('#sidenav ul.collapsible'));
      const listIndex = list ? Math.max(0, sidebarLists.indexOf(list)) : 0;
      return ['sidenav', listIndex, headerId, headerText].join('|');
    }
    return [listClass, index, headerText].join('|');
  }

  function getCollapsibleItems() {
    return Array.from(document.querySelectorAll('.planilha-produtos ul.collapsible > li, #container-list ul.collapsible > li, #sidenav ul.collapsible > li'));
  }

  function getStoredOpenCollapsibles(scope) {
    if (!isUiMemoryEnabled()) return null;
    const raw = storageGet(getCollapsibleStateKey(scope));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : null;
    } catch (_) {
      return null;
    }
  }

  function saveOpenCollapsibles() {
    if (!isUiMemoryEnabled()) return;
    const openKeysByScope = {
      page: [],
      sidenav: []
    };
    const items = getCollapsibleItems();
    items.forEach((item) => {
      const header = getDirectCollapsiblePart(item, 'collapsible-header');
      const body = getDirectCollapsiblePart(item, 'collapsible-body');
      const isOpen = item.classList.contains('active') || (header && header.classList.contains('active')) || (body && window.getComputedStyle(body).display !== 'none');
      if (isOpen) openKeysByScope[getCollapsibleScope(item)].push(getCollapsibleItemKey(item));
    });
    storageSet(getCollapsibleStateKey('page'), JSON.stringify(openKeysByScope.page));
    storageSet(getCollapsibleStateKey('sidenav'), JSON.stringify(openKeysByScope.sidenav));
  }

  function setCollapsibleItemOpen(item, shouldOpen) {
    const header = getDirectCollapsiblePart(item, 'collapsible-header');
    const body = getDirectCollapsiblePart(item, 'collapsible-body');
    item.classList.toggle('active', shouldOpen);
    if (header) header.classList.toggle('active', shouldOpen);
    if (body) {
      body.style.display = shouldOpen ? 'block' : 'none';
      if (shouldOpen && body.classList.contains('padding10')) {
        if (!body.style.paddingTop) body.style.paddingTop = '10px';
        if (!body.style.paddingBottom) body.style.paddingBottom = '10px';
      }
    }
  }

  function restoreOpenCollapsibles() {
    if (!isUiMemoryEnabled()) return;
    if (Date.now() < STATE.collapsibleInteractionUntil) return;
    const storedByScope = {
      page: getStoredOpenCollapsibles('page'),
      sidenav: getStoredOpenCollapsibles('sidenav')
    };
    if (!storedByScope.page && !storedByScope.sidenav) return;
    const items = getCollapsibleItems();
    items.forEach((item) => {
      const scope = getCollapsibleScope(item);
      const stored = storedByScope[scope];
      if (!stored) return;
      setCollapsibleItemOpen(item, stored.has(getCollapsibleItemKey(item)));
    });
    if (storedByScope.page && storedByScope.page.size) {
      const expandAll = document.querySelector('#container-list .expandall, .planilha-produtos .expandall');
      const collapseAll = document.querySelector('#container-list .collapseall, .planilha-produtos .collapseall');
      if (expandAll) expandAll.style.display = '';
      if (collapseAll) collapseAll.style.display = '';
    }
  }

  function scheduleCollapsibleRestore() {
    if (!isUiMemoryEnabled()) return;
    if (STATE.collapsibleRestoreTimer) clearTimeout(STATE.collapsibleRestoreTimer);
    const interactionDelay = Math.max(0, STATE.collapsibleInteractionUntil - Date.now() + 100);
    STATE.collapsibleRestoreTimer = setTimeout(() => {
      STATE.collapsibleRestoreTimer = null;
      restoreOpenCollapsibles();
    }, Math.max(350, interactionDelay));
  }

  function setupCollapsibleMemory() {
    if (STATE.collapsibleListenersReady) {
      scheduleCollapsibleRestore();
      return;
    }
    STATE.collapsibleListenersReady = true;
    document.addEventListener('click', (event) => {
      if (event.target.closest('.collapsible-header')) {
        STATE.collapsibleInteractionUntil = Date.now() + 900;
        setTimeout(saveOpenCollapsibles, 500);
        return;
      }
      if (event.target.closest('.expandall, .collapseall')) {
        STATE.collapsibleInteractionUntil = Date.now() + 1200;
        setTimeout(saveOpenCollapsibles, 900);
      }
    }, true);
    scheduleCollapsibleRestore();
    setTimeout(restoreOpenCollapsibles, 1000);
  }

  function getTabStateKey() {
    return [
      CONFIG.tabStatePrefix,
      getProjectId(),
      window.location.pathname
    ].join('::');
  }

  function getTabGroupKey(tabs) {
    const parentCollapsible = tabs.closest('ul.collapsible');
    const parentLocal = tabs.closest('[class*="local-"]');
    const localClass = parentLocal ? Array.from(parentLocal.classList).find((className) => /^local-\d+/.test(className)) : '';
    const tabsIndex = Array.from(document.querySelectorAll('ul.tabs')).indexOf(tabs);
    const parentClass = parentCollapsible ? normalizeText(parentCollapsible.className) : '';
    return [localClass, parentClass, tabsIndex].join('|');
  }

  function getStoredTabs() {
    if (!isUiMemoryEnabled()) return {};
    const raw = storageGet(getTabStateKey());
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveActiveTabs() {
    if (!isUiMemoryEnabled()) return;
    const state = {};
    const tabsGroups = Array.from(document.querySelectorAll('ul.tabs'));
    tabsGroups.forEach((tabs) => {
      const activeLink = tabs.querySelector('a.active[href^="#"]') || Array.from(tabs.querySelectorAll('a[href^="#"]')).find((link) => {
        const panel = document.querySelector(link.getAttribute('href'));
        return panel && window.getComputedStyle(panel).display !== 'none';
      });
      if (!activeLink) return;
      state[getTabGroupKey(tabs)] = activeLink.getAttribute('href');
    });
    storageSet(getTabStateKey(), JSON.stringify(state));
  }

  function saveClickedTab(tabLink) {
    if (!isUiMemoryEnabled()) return;
    const tabs = tabLink.closest('ul.tabs');
    const href = tabLink.getAttribute('href');
    if (!tabs || !href || href.charAt(0) !== '#') return;
    const state = getStoredTabs();
    state[getTabGroupKey(tabs)] = href;
    storageSet(getTabStateKey(), JSON.stringify(state));
  }

  function updateTabIndicator(tabs, activeLink) {
    const indicator = tabs.querySelector('.indicator');
    if (!indicator || !activeLink) return;
    const tabsRect = tabs.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const left = Math.max(0, linkRect.left - tabsRect.left + tabs.scrollLeft);
    const right = Math.max(0, tabsRect.right - linkRect.right - tabs.scrollLeft);
    indicator.style.left = `${left}px`;
    indicator.style.right = `${right}px`;
  }

  function forceTabDomState(link) {
    const tabs = link.closest('ul.tabs');
    if (!tabs) return;
    const targetSelector = link.getAttribute('href');
    if (!targetSelector || targetSelector.charAt(0) !== '#') return;
    const target = document.querySelector(targetSelector);
    if (!target) return;

    tabs.querySelectorAll('a[href^="#"]').forEach((tabLink) => {
      const selector = tabLink.getAttribute('href');
      const panel = selector ? document.querySelector(selector) : null;
      const isActive = tabLink === link;
      tabLink.classList.toggle('active', isActive);
      if (panel) {
        panel.classList.toggle('active', isActive);
        panel.style.display = isActive ? '' : 'none';
      }
    });
    target.style.display = '';
    updateTabIndicator(tabs, link);
  }

  function syncVisibleTabIndicators() {
    document.querySelectorAll('ul.tabs').forEach((tabs) => {
      if (tabs.getBoundingClientRect().width <= 0) return;
      const activeLink = tabs.querySelector('a.active[href^="#"]');
      if (activeLink) updateTabIndicator(tabs, activeLink);
    });
  }

  function activateTabLink(link) {
    const tabs = link.closest('ul.tabs');
    if (!tabs) return;
    const targetSelector = link.getAttribute('href');
    if (!targetSelector || targetSelector.charAt(0) !== '#') return;
    const target = document.querySelector(targetSelector);
    if (!target) return;

    let materializeHandled = false;
    try {
      if (typeof window.$3 === 'function') {
        window.$3(tabs).tabs();
        window.$3(tabs).tabs('select_tab', targetSelector.slice(1));
        materializeHandled = true;
      }
    } catch (_) {}
    if (!materializeHandled) {
      forceTabDomState(link);
      return;
    }
    window.requestAnimationFrame(() => {
      forceTabDomState(link);
      window.requestAnimationFrame(() => updateTabIndicator(tabs, link));
    });
  }

  function restoreActiveTabs() {
    if (!isUiMemoryEnabled()) return;
    if (Date.now() < STATE.tabInteractionUntil) return;
    const state = getStoredTabs();
    Object.keys(state).forEach((groupKey) => {
      const tabs = Array.from(document.querySelectorAll('ul.tabs')).find((candidate) => getTabGroupKey(candidate) === groupKey);
      if (!tabs) return;
      const href = state[groupKey];
      if (!href) return;
      const link = tabs.querySelector(`a[href="${href}"]`);
      if (link) {
        activateTabLink(link);
      }
    });
  }

  function scheduleTabRestore() {
    if (!isUiMemoryEnabled()) return;
    if (STATE.tabRestoreTimer) clearTimeout(STATE.tabRestoreTimer);
    const interactionDelay = Math.max(0, STATE.tabInteractionUntil - Date.now() + 100);
    STATE.tabRestoreTimer = setTimeout(() => {
      STATE.tabRestoreTimer = null;
      restoreActiveTabs();
    }, Math.max(350, interactionDelay));
  }

  function setupTabMemory() {
    if (STATE.tabListenersReady) {
      scheduleTabRestore();
      return;
    }
    STATE.tabListenersReady = true;
    document.addEventListener('click', (event) => {
      const tabLink = event.target.closest('ul.tabs a[href^="#"]');
      if (!tabLink) {
        if (event.target.closest('.collapsible-header')) {
          setTimeout(syncVisibleTabIndicators, 300);
          setTimeout(syncVisibleTabIndicators, 700);
        }
        return;
      }
      STATE.tabInteractionUntil = Date.now() + 1200;
      saveClickedTab(tabLink);
      const tabs = tabLink.closest('ul.tabs');
      if (tabs) {
        setTimeout(() => forceTabDomState(tabLink), 80);
        setTimeout(() => forceTabDomState(tabLink), 250);
      }
    }, false);
    window.addEventListener('resize', syncVisibleTabIndicators);
    scheduleTabRestore();
    setTimeout(() => {
      restoreActiveTabs();
      syncVisibleTabIndicators();
    }, 1000);
  }

  function getFilterStateKey(filterName) {
    return `${CONFIG.filterStatePrefix}::${getProjectId()}::${filterName}`;
  }

  function getProposalFilters() {
    const filters = {};
    const mechanismSelect = document.querySelector('input[aria-label="Mecanismo"]');
    const proponentSelect = document.querySelector('input[aria-label="Proponentes"]');
    if (mechanismSelect) {
      const display = mechanismSelect.parentElement?.querySelector('.v-select__selection');
      if (display) filters.mechanism = display.textContent.trim();
    }
    if (proponentSelect) {
      const display = proponentSelect.parentElement?.querySelector('.v-select__selection');
      if (display) filters.proponent = display.textContent.trim();
    }
    return filters;
  }

  function getStoredFilters() {
    if (!isUiMemoryEnabled()) return {};
    const stored = {};
    const mechanismKey = getFilterStateKey('mechanism');
    const proponentKey = getFilterStateKey('proponent');
    const mechanismValue = storageGet(mechanismKey);
    const proponentValue = storageGet(proponentKey);
    if (mechanismValue) stored.mechanism = mechanismValue;
    if (proponentValue) stored.proponent = proponentValue;
    return stored;
  }

  function saveProposalFilters() {
    if (!isUiMemoryEnabled()) return;
    const filters = getProposalFilters();
    if (filters.mechanism) storageSet(getFilterStateKey('mechanism'), filters.mechanism);
    if (filters.proponent) storageSet(getFilterStateKey('proponent'), filters.proponent);
  }

  function restoreProposalFilters() {
    if (!isUiMemoryEnabled()) return;
    if (Date.now() < STATE.filterInteractionUntil) return;
    const stored = getStoredFilters();
    if (!stored.mechanism && !stored.proponent) return;

    const mechanismInput = document.querySelector('input[aria-label="Mecanismo"]');
    const proponentInput = document.querySelector('input[aria-label="Proponentes"]');

    if (mechanismInput && stored.mechanism) {
      const mechanismMenu = mechanismInput.closest('.v-input')?.querySelector('.v-menu__content');
      if (mechanismMenu && mechanismMenu.style.display !== 'none') {
        const option = Array.from(mechanismMenu.querySelectorAll('.v-list__tile__title')).find(
          (el) => el.textContent.trim() === stored.mechanism
        );
        if (option) {
          setTimeout(() => {
            option.closest('.v-list__tile')?.click();
          }, 50);
        }
      }
    }

    if (proponentInput && stored.proponent) {
      const proponentMenu = proponentInput.closest('.v-input')?.querySelector('.v-menu__content');
      if (proponentMenu && proponentMenu.style.display !== 'none') {
        const option = Array.from(proponentMenu.querySelectorAll('.v-list__tile__title')).find(
          (el) => el.textContent.trim() === stored.proponent
        );
        if (option) {
          setTimeout(() => {
            option.closest('.v-list__tile')?.click();
          }, 50);
        }
      }
    }
  }

  function scheduleFilterRestore() {
    if (!isUiMemoryEnabled()) return;
    if (STATE.filterRestoreTimer) clearTimeout(STATE.filterRestoreTimer);
    const interactionDelay = Math.max(0, STATE.filterInteractionUntil - Date.now() + 100);
    STATE.filterRestoreTimer = setTimeout(() => {
      STATE.filterRestoreTimer = null;
      restoreProposalFilters();
    }, Math.max(350, interactionDelay));
  }

  function setupFilterMemory() {
    if (STATE.filterListenersReady) {
      scheduleFilterRestore();
      return;
    }
    STATE.filterListenersReady = true;

    document.addEventListener('change', (event) => {
      const input = event.target;
      if (input.getAttribute('aria-label') === 'Mecanismo' || input.getAttribute('aria-label') === 'Proponentes') {
        STATE.filterInteractionUntil = Date.now() + 1200;
        saveProposalFilters();
      }
    }, false);

    document.addEventListener('click', (event) => {
      const listItem = event.target.closest('.v-list__tile');
      if (listItem) {
        const title = listItem.querySelector('.v-list__tile__title');
        if (title) {
          const menu = listItem.closest('.v-menu__content');
          if (menu) {
            const input = menu.previousElementSibling?.querySelector('input[aria-label]');
            if (input && (input.getAttribute('aria-label') === 'Mecanismo' || input.getAttribute('aria-label') === 'Proponentes')) {
              STATE.filterInteractionUntil = Date.now() + 1200;
              setTimeout(saveProposalFilters, 100);
            }
          }
        }
      }
    }, false);

    scheduleFilterRestore();
    setTimeout(() => {
      restoreProposalFilters();
    }, 1500);
  }

  function isOwnMutation(mutation) {
    const nodes = [mutation.target].concat(Array.from(mutation.addedNodes || []));
    return nodes.every((node) => {
      if (!node || node.nodeType !== 1) return true;
      if (node.id === CONFIG.settingsRootId || node.id === CONFIG.settingsMenuId || node.id === CONFIG.customStyleId) return true;
      if (node.classList && node.classList.contains(CONFIG.statusClass)) return true;
      if (node.classList && node.classList.contains('tm-salic-file-dropzone')) return true;
      if (node.closest) {
        return Boolean(node.closest(`#${CONFIG.settingsRootId}, #${CONFIG.settingsMenuId}, .${CONFIG.statusClass}, .tm-salic-file-dropzone`));
      }
      return false;
    });
  }

  function scheduleDomRefresh() {
    if (STATE.observerTimer) clearTimeout(STATE.observerTimer);
    STATE.observerTimer = setTimeout(() => {
      STATE.observerTimer = null;
      applyAltEditors();
      scanFields();
      scanFileInputs();
      applyDeleteButtonVisibility();
      addSettingsMenu();
      setupCollapsibleMemory();
      setupTabMemory();
      setupFilterMemory();
    }, 200);
  }

  function startObserver() {
    injectStyles();
    applyAltEditors();
    scanFields();
    scanFileInputs();
    applyDeleteButtonVisibility();
    addSettingsMenu();
    setupCollapsibleMemory();
    setupTabMemory();
    setupFilterMemory();

    const observer = new MutationObserver((mutations) => {
      if (mutations.length && mutations.every(isOwnMutation)) return;
      scheduleDomRefresh();
    });

    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
