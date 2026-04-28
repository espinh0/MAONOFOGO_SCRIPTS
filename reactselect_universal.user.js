// ==UserScript==
// @name         Universal Select -> React Select
// @namespace    universal-react-select
// @updateURL    https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/reactselect_universal.user.js
// @downloadURL  https://raw.githubusercontent.com/espinh0/MAONOFOGO_SCRIPTS/main/reactselect_universal.user.js
// @version      2.7
// @description  Converts plain HTML select dropdowns into React Select components with sync.
// @match        https://aplicacoes.cultura.gov.br/*
// @match        https://salic.cultura.gov.br/*
// @match        https://cultura.gov.br/*
// @match        https://*.cultura.gov.br/*
// @grant        GM_xmlhttpRequest
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @connect      esm.sh
// @connect      unpkg.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    reactVersion: '18.3.1',
    reactDomVersion: '18.3.1',
    reactSelectEsmUrl: 'https://esm.sh/react-select@5.10.2?deps=react@18.3.1,react-dom@18.3.1',
    reactEsmUrl: 'https://esm.sh/react@18.3.1',
    reactDomEsmUrl: 'https://esm.sh/react-dom@18.3.1',
    reactSelectStyleUrls: [],
    placeholderText: 'Select...',
    hideOriginalSelect: false,
    ignoreSelector: '.tm-reactselect-ignore, [data-tm-reactselect="off"]',
    scanIntervalMs: 500,
    maxMenuZIndex: 999999,
    minControlWidth: 240,
    menuMinWidth: 320,
    cssId: 'tm-reactselect-css',
    hiddenClass: 'tm-reactselect-hidden',
    enabledKey: 'tm-salic-setting-reactselect',
    showOriginalKey: 'tm-salic-setting-reactselect-show-original',
    minOptionsKey: 'tm-salic-setting-reactselect-min-options',
    minOptionsDefault: 10,
    minOptionsMin: 0,
    minOptionsMax: 99,
    settingEventName: 'tm-salic-setting-change',
    settingOn: '1',
    settingOff: '0'
  };

  const STATE = {
    bootPromise: null,
    initialized: false,
    instanceBySelect: new Map(),
    scanTimer: null,
    lastLoadError: null,
    lastLoadErrorAt: 0,
    react: null,
    reactDom: null,
    reactSelect: null
  };

  const ROOT = window;

  function isReactSelectEnabled() {
    try {
      const stored = localStorage.getItem(CONFIG.enabledKey);
      if (stored === CONFIG.settingOn) return true;
      if (stored === CONFIG.settingOff) return false;
    } catch (_) {}
    return true;
  }

  function shouldShowOriginalSelect() {
    try {
      const stored = localStorage.getItem(CONFIG.showOriginalKey);
      if (stored === CONFIG.settingOn) return true;
      if (stored === CONFIG.settingOff) return false;
    } catch (_) {}
    return true;
  }

  function applyOriginalSelectVisibility(select, previousTabIndex) {
    if (shouldShowOriginalSelect()) {
      select.classList.remove(CONFIG.hiddenClass);
      if (previousTabIndex === null || previousTabIndex === undefined) {
        select.removeAttribute('tabindex');
      } else {
        select.setAttribute('tabindex', previousTabIndex);
      }
      return;
    }
    select.classList.add(CONFIG.hiddenClass);
    select.tabIndex = -1;
  }

  function applyOriginalVisibilityToInstances() {
    Array.from(STATE.instanceBySelect.entries()).forEach(([select, instance]) => {
      applyOriginalSelectVisibility(select, instance.previousTabIndex);
    });
  }

  function clampNumber(value, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function getMinOptionsThreshold() {
    try {
      const stored = localStorage.getItem(CONFIG.minOptionsKey);
      return clampNumber(stored === null || stored === undefined ? CONFIG.minOptionsDefault : stored, CONFIG.minOptionsMin, CONFIG.minOptionsMax);
    } catch (_) {
      return CONFIG.minOptionsDefault;
    }
  }

  async function loadEsmModules() {
    if (STATE.react && STATE.reactDom && STATE.reactSelect) return;
    const [reactMod, reactDomMod, reactSelectMod] = await Promise.all([
      import(CONFIG.reactEsmUrl),
      import(CONFIG.reactDomEsmUrl),
      import(CONFIG.reactSelectEsmUrl)
    ]);
    STATE.react = reactMod?.default || reactMod;
    STATE.reactDom = reactDomMod?.default || reactDomMod;
    STATE.reactSelect = reactSelectMod?.default || reactSelectMod;
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
            resolve(resp.responseText);
          } else {
            reject(new Error(`Failed to fetch ${url} (${resp.status})`));
          }
        },
        onerror: () => reject(new Error(`Failed to fetch ${url}`))
      });
    });
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)));
        if (existing.dataset.tmLoaded === '1') resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.tmLoaded = '1';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(script);
    });
  }

  async function injectScriptText(code, urlLabel) {
    const script = document.createElement('script');
    script.textContent = `/* tm-inline: ${urlLabel} */\n${code}`;
    document.head.appendChild(script);
    script.remove();
  }

  async function loadScriptAny(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        await loadScript(url);
        return;
      } catch (err) {
        lastError = err;
        try {
          const code = await fetchText(url);
          await injectScriptText(code, url);
          return;
        } catch (inlineErr) {
          lastError = inlineErr;
        }
      }
    }
    if (lastError) throw lastError;
  }

  function loadStyle(url, id) {
    return new Promise((resolve) => {
      if (id && document.getElementById(id)) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      if (id) link.id = id;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }

  async function loadStyleAny(urls, id) {
    for (const url of urls) {
      await loadStyle(url, id);
      if (id && document.getElementById(id)) return;
      try {
        const cssText = await fetchText(url);
        const style = document.createElement('style');
        if (id) style.id = id;
        style.textContent = cssText;
        document.head.appendChild(style);
        return;
      } catch (_) {}
    }
  }

  function injectBaseStyles() {
    if (document.getElementById('tm-reactselect-base')) return;
    const style = document.createElement('style');
    style.id = 'tm-reactselect-base';
    style.textContent = `
.${CONFIG.hiddenClass} {
  position: absolute !important;
  opacity: 0 !important;
  pointer-events: none !important;
  width: 1px !important;
  height: 1px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  overflow: hidden !important;
  white-space: nowrap !important;
}
.tm-reactselect-wrapper {
  display: inline-block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  position: relative;
}
`;
    document.head.appendChild(style);
  }

  function ensureReactSelect() {
    if (STATE.bootPromise) return STATE.bootPromise;
    STATE.bootPromise = (async () => {
      if (!document.head) return;
      if (STATE.lastLoadError && Date.now() - STATE.lastLoadErrorAt < 10000) {
        throw STATE.lastLoadError;
      }
      await loadStyleAny(CONFIG.reactSelectStyleUrls, CONFIG.cssId);
      injectBaseStyles();
      await loadEsmModules();
      if (!STATE.react || !STATE.reactDom || !STATE.reactSelect) {
        throw new Error('React Select resources not available');
      }
    })();
    STATE.bootPromise.catch((err) => {
      STATE.lastLoadError = err;
      STATE.lastLoadErrorAt = Date.now();
    });
    return STATE.bootPromise;
  }

  function isEligibleSelect(select) {
    if (!select || select.tagName !== 'SELECT') return false;
    if (select.dataset.tmReactselectProcessed === '1') return false;
    if (select.matches(CONFIG.ignoreSelector)) return false;
    if (select.closest && select.closest(CONFIG.ignoreSelector)) return false;
    if (select.getAttribute('data-tm-reactselect') === 'off') return false;
    if (getSelectableOptionCount(select) < getMinOptionsThreshold()) return false;
    return true;
  }

  function getPlaceholder(select) {
    const explicit = select.getAttribute('data-placeholder') || select.getAttribute('placeholder');
    if (explicit && explicit.trim()) return explicit.trim();
    const firstOption = select.options && select.options.length ? select.options[0] : null;
    if (firstOption && firstOption.value === '' && firstOption.textContent.trim()) {
      return firstOption.textContent.trim();
    }
    return CONFIG.placeholderText;
  }

  function isPlaceholderOption(option, index) {
    if (!option) return false;
    if (index !== 0) return false;
    const rawValue = option.getAttribute('value');
    const hasExplicitValue = rawValue !== null;
    const value = hasExplicitValue ? rawValue : option.value;
    if (value !== '' && hasExplicitValue) return false;
    if (option.disabled || option.hidden) return true;
    if (option.getAttribute('data-placeholder') === 'true') return true;
    return true;
  }

  function buildOptions(select) {
    const options = [];
    const flat = [];
    const children = Array.from(select.children || []);
    children.forEach((child) => {
      if (child.tagName === 'OPTGROUP') {
        const groupOptions = [];
        Array.from(child.children || []).forEach((opt, idx) => {
          if (opt.tagName !== 'OPTION') return;
          if (isPlaceholderOption(opt, idx)) return;
          const rawValue = opt.getAttribute('value');
          const value = rawValue !== null ? rawValue : opt.value;
          const option = {
            value,
            label: opt.label || opt.textContent || String(opt.value),
            isDisabled: opt.disabled
          };
          groupOptions.push(option);
          flat.push(option);
        });
        options.push({
          label: child.label || 'Group',
          options: groupOptions,
          isDisabled: child.disabled
        });
      } else if (child.tagName === 'OPTION') {
        const idx = flat.length;
        if (!isPlaceholderOption(child, idx)) {
          const rawValue = child.getAttribute('value');
          const value = rawValue !== null ? rawValue : child.value;
          const option = {
            value,
            label: child.label || child.textContent || String(child.value),
            isDisabled: child.disabled
          };
          options.push(option);
          flat.push(option);
        }
      }
    });
    return { options, flat };
  }

  function getSelectableOptionCount(select) {
    return Array.from(select.options || []).filter((option, index) => !isPlaceholderOption(option, index)).length;
  }

  function getSelectedValue(select, isMulti) {
    const selected = Array.from(select.selectedOptions || []);
    let selectedValues = selected.map((opt) => opt.value);
    if (isMulti && !selectedValues.length) {
      return [];
    }
    if (!selectedValues.length) {
      const value = select.value;
      if (value !== undefined && value !== null && String(value) !== '') {
        selectedValues = [String(value)];
      } else if (select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
        selectedValues = [String(select.options[select.selectedIndex].value)];
      }
    }
    return isMulti ? selectedValues.map((val) => String(val)) : (selectedValues.length ? String(selectedValues[0]) : null);
  }

  function syncSelectFromReact(select, selected, isMulti) {
    if (isMulti) {
      const values = new Set((selected || []).map((value) => String(value)));
      Array.from(select.options || []).forEach((opt) => {
        opt.selected = values.has(String(opt.value));
      });
    } else {
      const value = selected ? String(selected) : '';
      select.value = value;
      if (!value && select.options && select.options.length) {
        select.selectedIndex = 0;
      }
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createReactSelect(select) {
    const previousTabIndex = select.getAttribute('tabindex');
    const wrapper = document.createElement('div');
    wrapper.className = 'tm-reactselect-wrapper';
    wrapper.dataset.tmReactselectHost = '1';
    select.insertAdjacentElement('afterend', wrapper);

    const computedWidthRaw = window.getComputedStyle(select).width;
    const computedWidth = Number.parseFloat(computedWidthRaw);
    if (Number.isFinite(computedWidth) && computedWidth > 0) {
      wrapper.style.width = `${computedWidth}px`;
    }
    wrapper.style.maxWidth = '100%';
    wrapper.style.minWidth = '0';

    applyOriginalSelectVisibility(select, previousTabIndex);

    const SelectComponent = STATE.reactSelect;
    const React = STATE.react;
    const ReactDOM = STATE.reactDom;
    const isMulti = !!select.multiple;
    const placeholder = getPlaceholder(select);

    let currentOptions = buildOptions(select);
    let currentFlat = currentOptions.flat;
    let currentValue = getSelectedValue(select, isMulti);
    let suppressSelectChange = false;

    function render() {
      const styles = {
        container: (base) => ({ ...base, width: '100%', minWidth: 0, maxWidth: '100%' }),
        control: (base, state) => ({
          ...base,
          minHeight: 30,
          minWidth: 0,
          borderColor: state.isFocused ? '#0d6efd' : '#8bb8f5',
          borderLeftWidth: 4,
          borderLeftColor: '#0d6efd',
          backgroundColor: '#f8fbff',
          boxShadow: state.isFocused ? '0 0 0 2px rgba(13, 110, 253, 0.16)' : 'none',
          '&:hover': {
            borderColor: '#0d6efd'
          }
        }),
        valueContainer: (base) => ({ ...base, minWidth: 0, padding: '1px 6px 1px 10px' }),
        input: (base) => ({ ...base, margin: 0, padding: 0 }),
        singleValue: (base) => ({ ...base, color: '#12385f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
        placeholder: (base) => ({ ...base, color: '#5f7894' }),
        indicatorsContainer: (base) => ({ ...base, flexShrink: 0, minHeight: 28 }),
        dropdownIndicator: (base) => ({ ...base, padding: '3px 4px', color: '#0d6efd' }),
        clearIndicator: (base) => ({ ...base, padding: '3px 4px' }),
        indicatorSeparator: (base) => ({ ...base, marginTop: 5, marginBottom: 5, backgroundColor: '#b7d1f4' }),
        menu: (base) => ({ ...base, minWidth: Math.min(CONFIG.menuMinWidth, window.innerWidth - 16), border: '1px solid #8bb8f5', boxShadow: '0 8px 18px rgba(13, 110, 253, 0.14)' }),
        menuPortal: (base) => ({ ...base, zIndex: CONFIG.maxMenuZIndex, minWidth: Math.min(CONFIG.menuMinWidth, window.innerWidth - 16) }),
        option: (base, state) => ({
          ...base,
          padding: '5px 10px',
          backgroundColor: state.isSelected ? '#0d6efd' : (state.isFocused ? '#eaf3ff' : base.backgroundColor),
          color: state.isSelected ? '#fff' : '#17324d'
        })
      };
      const valueProp = isMulti
        ? currentFlat.filter((opt) => (currentValue || []).includes(String(opt.value)))
        : currentFlat.find((opt) => String(opt.value) === String(currentValue)) || null;
      const element = React.createElement(SelectComponent, {
        options: currentOptions.options,
        value: valueProp,
        isMulti,
        isDisabled: select.disabled,
        placeholder,
        isClearable: !select.required,
        menuPortalTarget: document.body,
        menuPosition: 'fixed',
        styles,
        onChange: (next) => {
          currentValue = isMulti
            ? (next || []).map((opt) => String(opt.value))
            : (next ? String(next.value) : null);
          suppressSelectChange = true;
          syncSelectFromReact(select, currentValue, isMulti);
          suppressSelectChange = false;
          setTimeout(refreshFromSelect, 0);
        }
      });

      if (ReactDOM.createRoot) {
        if (!wrapper._tmRoot) {
          wrapper._tmRoot = ReactDOM.createRoot(wrapper);
        }
        wrapper._tmRoot.render(element);
      } else if (ReactDOM.render) {
        ReactDOM.render(element, wrapper);
      }
    }

    function refreshFromSelect() {
      currentOptions = buildOptions(select);
      currentFlat = currentOptions.flat;
      currentValue = getSelectedValue(select, isMulti);
      render();
    }

    const selectChangeHandler = () => {
      if (suppressSelectChange) return;
      refreshFromSelect();
    };

    select.addEventListener('change', selectChangeHandler);
    select.addEventListener('input', selectChangeHandler);

    const optionObserver = new MutationObserver(() => {
      refreshFromSelect();
    });
    optionObserver.observe(select, { childList: true, subtree: true, attributes: true });

    const form = select.closest('form');
    if (form) {
      form.addEventListener('reset', () => {
        setTimeout(refreshFromSelect, 0);
      });
    }

    render();

    const instance = {
      select,
      wrapper,
      optionObserver,
      selectChangeHandler,
      refreshFromSelect,
      previousTabIndex
    };

    STATE.instanceBySelect.set(select, instance);
    select.dataset.tmReactselectProcessed = '1';
  }

  function destroyInstance(select, instance) {
    try {
      if (instance.optionObserver) instance.optionObserver.disconnect();
      select.removeEventListener('change', instance.selectChangeHandler);
      select.removeEventListener('input', instance.selectChangeHandler);
      if (instance.wrapper && instance.wrapper._tmRoot && instance.wrapper._tmRoot.unmount) {
        instance.wrapper._tmRoot.unmount();
      } else if (instance.wrapper && STATE.reactDom && STATE.reactDom.unmountComponentAtNode) {
        STATE.reactDom.unmountComponentAtNode(instance.wrapper);
      }
      if (instance.wrapper && instance.wrapper.parentElement) {
        instance.wrapper.remove();
      }
      select.classList.remove(CONFIG.hiddenClass);
      if (instance.previousTabIndex === null || instance.previousTabIndex === undefined) select.removeAttribute('tabindex');
      else select.setAttribute('tabindex', instance.previousTabIndex);
      delete select.dataset.tmReactselectProcessed;
    } catch (_) {}
    STATE.instanceBySelect.delete(select);
  }

  function destroyAllInstances() {
    Array.from(STATE.instanceBySelect.entries()).forEach(([select, instance]) => {
      destroyInstance(select, instance);
    });
  }

  function cleanupOrphaned() {
    Array.from(STATE.instanceBySelect.entries()).forEach(([select, instance]) => {
      if (!select.isConnected) {
        destroyInstance(select, instance);
      }
    });
  }

  async function scanAndEnhance() {
    if (!document.body) return;
    if (!isReactSelectEnabled()) {
      destroyAllInstances();
      return;
    }
    Array.from(STATE.instanceBySelect.entries()).forEach(([select, instance]) => {
      if (getSelectableOptionCount(select) < getMinOptionsThreshold()) {
        destroyInstance(select, instance);
      }
    });
    await ensureReactSelect();
    const selects = Array.from(document.querySelectorAll('select'));
    selects.forEach((select) => {
      if (isEligibleSelect(select)) {
        createReactSelect(select);
      }
    });
    cleanupOrphaned();
  }

  function startObserver() {
    if (STATE.initialized) return;
    STATE.initialized = true;

    const observer = new MutationObserver(() => {
      if (STATE.scanTimer) return;
      STATE.scanTimer = setTimeout(() => {
        STATE.scanTimer = null;
        scanAndEnhance();
      }, CONFIG.scanIntervalMs);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener(CONFIG.settingEventName, (event) => {
      if (!event.detail || event.detail.key !== CONFIG.enabledKey) return;
      if (event.detail.enabled) {
        scanAndEnhance();
      } else {
        destroyAllInstances();
      }
    });
    window.addEventListener(CONFIG.settingEventName, (event) => {
      if (!event.detail || event.detail.key !== CONFIG.minOptionsKey) return;
      scanAndEnhance();
    });
    window.addEventListener(CONFIG.settingEventName, (event) => {
      if (!event.detail || event.detail.key !== CONFIG.showOriginalKey) return;
      applyOriginalVisibilityToInstances();
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CONFIG.enabledKey) return;
      if (isReactSelectEnabled()) {
        scanAndEnhance();
      } else {
        destroyAllInstances();
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CONFIG.minOptionsKey) return;
      scanAndEnhance();
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CONFIG.showOriginalKey) return;
      applyOriginalVisibilityToInstances();
    });
    scanAndEnhance();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
