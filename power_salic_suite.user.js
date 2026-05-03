// ==UserScript==
// @name         Power Salic Suite
// @namespace    power-salic
// @version      1.1.5
// @description  Loader dinamico do Power SALIC e ReactSelect com modo developer via localhost.
// @updateURL    https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/power_salic_suite.user.js
// @downloadURL  https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/power_salic_suite.user.js
// @match        https://aplicacoes.cultura.gov.br/*
// @match        https://salic.cultura.gov.br/*
// @match        https://cultura.gov.br/*
// @match        https://*.cultura.gov.br/*
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @connect      esm.sh
// @connect      unpkg.com
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__tmPowerSalicSuiteLoaderRunning) return;
  window.__tmPowerSalicSuiteLoaderRunning = true;

  const CONFIG = {
    forceParam: 'tm_ps_update',
    devParam: 'tm_ps_dev',
    devKey: 'tm-salic-suite-dev-mode',
    buildToken: '1.1.5',
    settingOn: '1',
    settingOff: '0',

    productionScriptUrls: [
      'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/salic_melhorias_locais.user.js',
      'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/reactselect_universal.user.js',
      'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/upgradetexteditor.js'
    ],

    // VS Code Live Server geralmente usa http://127.0.0.1:5500
    // Ajuste a pasta se seus arquivos estiverem dentro de subdiretório.
    developerScriptUrls: [
      'http://127.0.0.1:5500/salic_melhorias_locais.user.js',
      'http://127.0.0.1:5500/reactselect_universal.user.js',
      'http://127.0.0.1:5500/upgradetexteditor.js'
    ]
  };

  function getQueryParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (_) {
      return '';
    }
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

  function isDeveloperMode() {
    const value = getQueryParam(CONFIG.devParam).toLowerCase();

    if (
      value === '1' ||
      value === 'true' ||
      value === 'yes' ||
      value === 'on'
    ) {
      return true;
    }

    if (
      value === '0' ||
      value === 'false' ||
      value === 'no' ||
      value === 'off'
    ) {
      return false;
    }

    const stored = storageGet(CONFIG.devKey);
    return stored === CONFIG.settingOn || stored === true;
  }

  function getForceToken() {
    const token = getQueryParam(CONFIG.forceParam);
    return token ? String(token) : '';
  }

  function buildUrl(baseUrl, forceToken, devMode) {
    const cacheToken = forceToken || (devMode ? Date.now() : CONFIG.buildToken);

    if (!cacheToken) return baseUrl;

    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}v=${encodeURIComponent(cacheToken)}`;
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest not available'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (resp) => {
          if (resp.status >= 200 && resp.status < 300) {
            resolve(resp.responseText || '');
          } else {
            reject(new Error(`Failed to fetch ${url} (${resp.status})`));
          }
        },
        onerror: () => reject(new Error(`Failed to fetch ${url}`))
      });
    });
  }

  function runScript(source, url) {
    eval(`${source}\n//# sourceURL=${url}`);
  }

  async function loadScripts() {
    const devMode = isDeveloperMode();
    const forceToken = getForceToken();

    const scriptUrls = devMode
      ? CONFIG.developerScriptUrls
      : CONFIG.productionScriptUrls;

    console.info(
      `[Power Salic Suite] Loading in ${devMode ? 'DEVELOPER' : 'PRODUCTION'} mode`
    );

    for (const baseUrl of scriptUrls) {
      const url = buildUrl(baseUrl, forceToken, devMode);
      const source = await fetchText(url);

      try {
        runScript(source, url);
      } catch (err) {
        console.error('[Power Salic Suite] Script error:', url, err);
        throw err;
      }
    }
  }

  loadScripts().catch((err) => {
    console.error('[Power Salic Suite] Loader error:', err);
  });
})();
