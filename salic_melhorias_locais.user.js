// ==UserScript==
// @name         SALIC Melhorias Locais
// @namespace    collar3
// @version      1.0
// @description  Salvamento local automatico de campos de texto e ocultacao do botao excluir proposta.
// @match        https://aplicacoes.cultura.gov.br/*
// @match        https://salic.cultura.gov.br/*
// @match        https://cultura.gov.br/*
// @match        https://*.cultura.gov.br/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    saveDelayMs: 500,
    statusClass: 'tm-salic-local-status',
    statusSaving: 'Salvando...','
    statusSaved: 'Salvo',
    statusRestored: 'Restaurado',
    statusError: 'Erro ao salvar',
    hideDeleteSelector: '#sidenav #excluirproposta',
    ignoreSelector: '.tm-localmem-ignore, [data-tm-localmem="off"]'
  };

  const STATE = {
    timers: new WeakMap(),
    lastValue: new WeakMap()
  };

  function getProjectId() {
    const match = window.location.pathname.match(/idPreProjeto\/(\d+)/i);
    return match ? match[1] : 'unknown';
  }

  function getFieldKey(field, index) {
    const projectId = getProjectId();
    const pagePath = window.location.pathname;
    const idPart = field.id || '';
    const namePart = field.name || '';
    const placeholderPart = field.getAttribute('placeholder') || '';
    return [
      'tm-salic-localmem',
      projectId,
      pagePath,
      idPart,
      namePart,
      placeholderPart,
      String(index)
    ].join('::');
  }

  function ensureStatusEl(field) {
    let status = field.nextElementSibling;
    if (!status || !status.classList.contains(CONFIG.statusClass)) {
      status = document.createElement('div');
      status.className = CONFIG.statusClass;
      status.style.fontSize = '12px';
      status.style.opacity = '0.75';
      status.style.marginTop = '4px';
      status.style.color = '#546e7a';
      field.insertAdjacentElement('afterend', status);
    }
    return status;
  }

  function setStatus(field, text) {
    const status = ensureStatusEl(field);
    status.textContent = text;
  }

  function saveField(field, key) {
    try {
      localStorage.setItem(key, field.value || '');
      setStatus(field, CONFIG.statusSaved);
    } catch (err) {
      setStatus(field, CONFIG.statusError);
    }
  }

  function scheduleSave(field, key) {
    setStatus(field, CONFIG.statusSaving);
    const prev = STATE.timers.get(field);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      saveField(field, key);
    }, CONFIG.saveDelayMs);
    STATE.timers.set(field, timer);
  }

  function restoreFieldIfEmpty(field, key) {
    const stored = localStorage.getItem(key);
    if (!stored) return;
    if (field.value && field.value.trim()) return;
    field.value = stored;
    setStatus(field, CONFIG.statusRestored);
  }

  function isEligibleField(field) {
    if (!field) return false;
    if (field.matches(CONFIG.ignoreSelector)) return false;
    if (field.closest && field.closest(CONFIG.ignoreSelector)) return false;
    if (field.getAttribute('data-tm-localmem') === 'off') return false;
    return true;
  }

  function wireField(field, index) {
    if (!isEligibleField(field)) return;
    if (field.dataset.tmLocalmemProcessed === '1') return;

    const key = getFieldKey(field, index);
    restoreFieldIfEmpty(field, key);
    setStatus(field, CONFIG.statusSaved);
    STATE.lastValue.set(field, field.value || '');

    const onInput = () => {
      if (STATE.lastValue.get(field) === field.value) return;
      STATE.lastValue.set(field, field.value);
      scheduleSave(field, key);
    };

    field.addEventListener('input', onInput);
    field.dataset.tmLocalmemProcessed = '1';
  }

  function scanFields() {
    const fields = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
    fields.forEach((field, index) => wireField(field, index));
  }

  function hideDeleteButton() {
    const link = document.querySelector(CONFIG.hideDeleteSelector);
    if (!link) return;
    const listItem = link.closest('li');
    if (listItem) {
      listItem.style.display = 'none';
    } else {
      link.style.display = 'none';
    }
  }

  function startObserver() {
    scanFields();
    hideDeleteButton();

    const observer = new MutationObserver(() => {
      scanFields();
      hideDeleteButton();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
