// ==UserScript==
// @name         Power Salic Suite
// @namespace    power-salic
// @version      1.1.0
// @description  Loader dinamico do Power SALIC e ReactSelect com opcao de atualizar sem reinstalar.
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
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.__tmPowerSalicSuiteLoaderRunning) return;
  window.__tmPowerSalicSuiteLoaderRunning = true;

  const CONFIG = {
    forceParam: 'tm_ps_update',
    scriptUrls: [
      'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/salic_melhorias_locais.user.js',
      'https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/reactselect_universal.user.js'
    ]
  };

  function getForceToken() {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get(CONFIG.forceParam);
      return token ? String(token) : '';
    } catch (_) {
      return '';
    }
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
    const script = document.createElement('script');
    script.textContent = `${source}\n//# sourceURL=${url}`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  async function loadScripts() {
    const forceToken = getForceToken();
    for (const baseUrl of CONFIG.scriptUrls) {
      const url = forceToken ? `${baseUrl}?v=${encodeURIComponent(forceToken)}` : baseUrl;
      const source = await fetchText(url);
      runScript(source, url);
    }
  }

  loadScripts().catch((err) => {
    try {
      console.error('[Power Salic Suite] Loader error:', err);
    } catch (_) {}
  });
})();
