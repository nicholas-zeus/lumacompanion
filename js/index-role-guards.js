// /js/index-role-guards.js
// Show "Create" for everyone EXCEPT doctors.
// Do NOT fight initial state while role is unknown (prevents race with index.html).

(function () {
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Button lookup ----------
  let createBtn, originalDisplay = "";
  function findCreateBtn() {
    if (createBtn && document.body.contains(createBtn)) return createBtn;

    const candidates = [
      "#newCaseBtn",               // your index.html
      "#createBtn",
      "[data-action='create-case']",
      ".btn-create",
      "button#create",
      "a#create",
      "[data-test='create']",
    ];
    for (const sel of candidates) {
      const el = q(sel);
      if (el) {
        createBtn = el;
        const cs = getComputedStyle(el);
        originalDisplay = el.style.display || (cs && cs.display !== "none" ? "" : "");
        return createBtn;
      }
    }
    // Fallback by text (rarely used here)
    const guess = qa("button, a").find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return t === "create" || t.includes("create case") || t.includes("new case");
    });
    if (guess) {
      createBtn = guess;
      const cs = getComputedStyle(guess);
      originalDisplay = guess.style.display || (cs && cs.display !== "none" ? "" : "");
    }
    return createBtn;
  }

  function hideBtn(btn) {
    if (!btn) return;
    btn.hidden = true;
    btn.setAttribute("aria-hidden", "true");
    btn.style.display = "none";
  }
  function showBtn(btn) {
    if (!btn) return;
    btn.hidden = false;
    btn.removeAttribute("aria-hidden");
    btn.style.display = originalDisplay ?? "";
  }

  // ---------- Environment detection ----------
  function getUser() {
    try { if (window.firebase?.auth?.().currentUser) return window.firebase.auth().currentUser; } catch {}
    try { if (window.auth && typeof window.auth.currentUser !== "undefined") return window.auth.currentUser; } catch {}
    if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) return window.currentUser;
    if (window.APP_USER && (window.APP_USER.uid || window.APP_USER.id)) return window.APP_USER;
    if (window.state?.user) return window.state.user;
    try {
      const lsUser = JSON.parse(localStorage.getItem("user") || "null");
      if (lsUser && (lsUser.uid || lsUser.id)) return lsUser;
    } catch {}
    return null;
  }
  function normalizeRole(val) {
    if (!val) return "";
    if (Array.isArray(val)) {
      const first = val.map(x => String(x || "").toLowerCase()).find(Boolean);
      return first || "";
    }
    return String(val).toLowerCase();
  }
  function getRole() {
    // 1) Your UI pill
    const pill = q("#rolePill");
    if (pill && pill.textContent) return normalizeRole(pill.textContent.trim());

    // 2) Data/meta (future-proof)
    const roleDataEl = q("[data-user-role], [data-role], [data-role-current]");
    const roleData = roleDataEl?.dataset?.userRole || roleDataEl?.dataset?.role || roleDataEl?.dataset?.roleCurrent;
    if (roleData) return normalizeRole(roleData);

    const metaRole = q('meta[name="user-role"]')?.getAttribute("content");
    if (metaRole) return normalizeRole(metaRole);

    // 3) App globals
    if (window.currentUser?.role) return normalizeRole(window.currentUser.role);
    if (window.APP_ROLE) return normalizeRole(window.APP_ROLE);
    if (window.state?.role) return normalizeRole(window.state.role);

    // 4) LocalStorage fallback
    try {
      const lsRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (lsRole) return normalizeRole(lsRole);
    } catch {}
    return "";
  }
  function isSignInScreen() {
    const box = q("#signinBox");
    if (box && !box.classList.contains("hidden")) return true;
    // generic hints
    const hints = [
      "#signin", ".sign-in", ".login-card", ".auth-card",
      'form[action*="signin"]', 'form[action*="login"]',
      "#googleSignIn", "#microsoftSignIn",
      "[data-action='sign-in']", "[data-action='microsoft-sign-in']",
    ];
    if (hints.some(sel => q(sel))) return true;
    if (!getUser()) return true;
    return false;
  }

  // ---------- Guard logic (conflict-free) ----------
  function applyGuard() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Only force-hide on truly not-signed-in screens
    if (isSignInScreen() || !getUser()) { hideBtn(btn); return; }

    const role = getRole();

    // If role is unknown, DO NOTHING — let index.html's own logic decide.
    if (!role) return;

    // Only doctors are blocked; everyone else is allowed.
    if (role === "doctor") hideBtn(btn);
    else showBtn(btn);
  }

  // ---------- Wire up ----------
  function init() {
    applyGuard();

    // Retry briefly for late role/user
    let tries = 0, maxTries = 20;
    const iv = setInterval(() => {
      applyGuard();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    // React to DOM/UI updates
    const mo = new MutationObserver(() => applyGuard());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // App events (fire these from your app when role/user changes)
    ["authChanged", "userChanged", "roleChanged", "appReady"].forEach(ev =>
      document.addEventListener(ev, applyGuard)
    );

    // Firebase auth listener if available
    try { window.firebase?.auth?.().onAuthStateChanged?.(() => applyGuard()); } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
