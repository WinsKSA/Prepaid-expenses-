/* Muqeem Desk — design helpers (no business logic).
   - Light / dark theme toggle (follows the device until the user picks one)
   - Arabic-Indic digits option for the Arabic interface (display only; inputs keep Western digits)
   - "Skip to content" link for keyboard users */
(function () {
  "use strict";
  const KEY_T = "mqd-theme", KEY_D = "mqd-digits";
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const root = document.documentElement;
  const isAr = () => root.lang === "ar";
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;

  /* ---- theme ---- */
  function themeNow() { return root.dataset.theme || (mq && mq.matches ? "dark" : "light"); }
  function applyTheme(t) {
    if (t) root.dataset.theme = t; else delete root.dataset.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themeNow() === "dark" ? "#0B1210" : "#12261F");
    paint();
  }
  applyTheme(get(KEY_T));
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (!get(KEY_T)) applyTheme(null); });

  /* ---- digits ---- */
  const AR = "٠١٢٣٤٥٦٧٨٩";
  const toAr = s => s.replace(/[0-9]/g, d => AR[d]);
  const digitsOn = () => get(KEY_D) === "arab" && isAr();
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|CODE)$/;
  function conv(node) {
    if (!digitsOn() || !node) return;
    if (node.nodeType === 3) { const p = node.parentNode; if (p && p.closest && p.closest(".no-digits,script,style,textarea,code")) return; if (/[0-9]/.test(node.nodeValue)) node.nodeValue = toAr(node.nodeValue); return; }
    if (node.nodeType !== 1 || SKIP.test(node.tagName) || node.classList.contains("no-digits")) return;
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode(n) {
      const p = n.parentNode; return p && (SKIP.test(p.tagName) || (p.closest && p.closest(".no-digits,code"))) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    const list = []; let n; while ((n = tw.nextNode())) if (/[0-9]/.test(n.nodeValue)) list.push(n);
    list.forEach(t => { t.nodeValue = toAr(t.nodeValue); });
  }
  let mo = null;
  function watchDigits() {
    if (mo) { mo.disconnect(); mo = null; }
    if (!digitsOn()) return;
    conv(document.body);
    mo = new MutationObserver(ms => ms.forEach(m => { if (m.type === "characterData") conv(m.target); else m.addedNodes.forEach(conv); }));
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---- controls in the top bar ---- */
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
  function paint() {
    const tb = document.getElementById("themeBtn");
    if (tb) {
      const dark = themeNow() === "dark";
      tb.innerHTML = dark ? SUN : MOON;
      const lbl = isAr() ? (dark ? "الوضع الفاتح" : "الوضع الداكن") : (dark ? "Switch to light theme" : "Switch to dark theme");
      tb.setAttribute("aria-label", lbl); tb.title = lbl;
    }
    const db = document.getElementById("digitsBtn");
    if (db) {
      db.hidden = !isAr();
      const on = get(KEY_D) === "arab";
      db.textContent = on ? "123" : "١٢٣";
      db.setAttribute("aria-pressed", String(on));
      const lbl = on ? "أرقام إنجليزية (123)" : "أرقام عربية (١٢٣)";
      db.setAttribute("aria-label", lbl); db.title = lbl;
    }
  }
  function mount() {
    const top = document.querySelector(".top");
    if (top && !document.getElementById("themeBtn")) {
      const anchor = top.querySelector(".langsw") || top.querySelector(".bell");
      const d = document.createElement("button"); d.type = "button"; d.id = "digitsBtn"; d.className = "tbtn digits no-digits";
      const t = document.createElement("button"); t.type = "button"; t.id = "themeBtn"; t.className = "tbtn";
      top.insertBefore(d, anchor); top.insertBefore(t, anchor);
      t.addEventListener("click", () => { const next = themeNow() === "dark" ? "light" : "dark"; put(KEY_T, next); applyTheme(next); });
      d.addEventListener("click", () => {
        const on = get(KEY_D) === "arab"; put(KEY_D, on ? null : "arab");
        watchDigits(); paint();
        if (on && window.__rerender) window.__rerender(); /* redraw restores Western digits */
      });
    }
    const view = document.getElementById("view");
    if (view && !document.querySelector(".skip")) {
      view.setAttribute("tabindex", "-1");
      const a = document.createElement("a"); a.className = "skip"; a.href = "#view"; a.textContent = "Skip to content";
      a.addEventListener("click", ev => { ev.preventDefault(); view.focus(); });
      document.body.insertBefore(a, document.body.firstChild);
    }
    paint();
  }
  /* react to language switches (the app sets <html lang>) */
  new MutationObserver(() => { paint(); watchDigits(); }).observe(root, { attributes: true, attributeFilter: ["lang"] });

  function boot() { mount(); setTimeout(watchDigits, 0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MQDesign = { theme: themeNow, setTheme: t => { put(KEY_T, t); applyTheme(t); } };
})();
