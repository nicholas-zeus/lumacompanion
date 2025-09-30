// /js/index-role-guards.js
// Purpose:
// - Hide "Create" on sign-in screen (no user)
// - Hide "Create" for role === 'doctor'
// - Show "Create" only when signed in AND role is not 'doctor'
// No imports. Works via DOM + common globals + localStorage fallbacks.

(function () {
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 1) Locate the Create button (extensible list of candidates)
  let createBtn, originalDisplay = "";
  function findCreateBtn() {
    if (createBtn && document.body.contains(createBtn)) return createBtn;

    const candidates = [
      "#createBtn",
      "#newCaseBtn",
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

    // Fallback: any prominent button that says "Create" or "New Case"
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
    btn.style.display = "none";
    btn.setAttribute("aria-hidden", "true");
  }
  function showBtn(btn) {
    if (!btn) return;
    btn.style.display = originalDisplay ?? "";
    btn.removeAttribute("aria-hidden");
  }

  // 2) Detect "sign-in screen" vs "signed-in"
  function isSignInScreen() {
    // Common sign-in DOM hints — extend as needed
    const signInHints = [
      "#signin", "#login", ".sign-in", ".login-card", ".auth-card",
      'form[action*="signin"]', 'form[action*="login"]',
      "#googleSignIn", "[data-action='sign-in']", "[data-test='sign-in']",
    ];
    if (signInHints.some(sel => q(sel))) return true;

    // If we know user is absent, treat as sign-in screen
    const user = getUser();
    if (!user) return true;

    return false;
  }

  function getUser() {
    // Try common global places
    // Firebase Auth (modular or namespaced)
    try {
      if (window.firebase?.auth?.().currentUser) return window.firebase.auth().currentUser;
    } catch (_) {}
    try {
      if (window.auth && typeof window.auth.currentUser !== "undefined") return window.auth.currentUser;
    } catch (_) {}
    // App globals (custom)
    if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) return window.currentUser;
    if (window.APP_USER && (window.APP_USER.uid || window.APP_USER.id)) return window.APP_USER;
    if (window.state?.user) return window.state.user;

    // LocalStorage hint
    try {
      const lsUser = JSON.parse(localStorage.getItem("user") || "null");
      if (lsUser && (lsUser.uid || lsUser.id)) return lsUser;
    } catch (_) {}

    return null;
  }

  // 3) Detect role (doctor/nurse/admin/etc.)
  function getRole() {
    // DOM data attributes
    const roleDataEl = q("[data-user-role], [data-role], [data-role-current]");
    const roleData = roleDataEl?.dataset?.userRole || roleDataEl?.dataset?.role || roleDataEl?.dataset?.roleCurrent;
    if (roleData) return String(roleData).toLowerCase();

    // Meta tag
    const metaRole = q('meta[name="user-role"]')?.getAttribute("content");
    if (metaRole) return String(metaRole).toLowerCase();

    // Visible role chip/text
    const roleTextEl = q(".user-role, #userRole, [data-label='role']");
    if (roleTextEl && roleTextEl.textContent) {
      const t = roleTextEl.textContent.trim().toLowerCase();
      if (t) return t;
    }

    // App globals
    if (window.currentUser?.role) return String(window.currentUser.role).toLowerCase();
    if (window.APP_ROLE) return String(window.APP_ROLE).toLowerCase();
    if (window.state?.role) return String(window.state.role).toLowerCase();

    // LocalStorage fallback
    try {
      const lsRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (lsRole) return String(lsRole).toLowerCase();
    } catch (_) {}

    return ""; // unknown yet
  }

  function applyGuard() {
    const btn = findCreateBtn();
    if (!btn) return;

    // Hide by default
    hideBtn(btn);

    // If we're on the sign-in screen → keep hidden
    if (isSignInScreen()) return;

    // If signed in, decide by role
    const user = getUser();
    if (!user) return; // treat as sign-in state

    const role = getRole();
    if (!role) return; // unknown role yet; keep hidden until we know

    if (role === "doctor") {
      hideBtn(btn);
    } else {
      showBtn(btn);
    }
  }

  // 4) Wire it up: run now, retry a few times, and observe DOM/app changes
  function init() {
    applyGuard();

    // Retry to catch late role/user injection
    let tries = 0;
    const maxTries = 15;
    const iv = setInterval(() => {
      applyGuard();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);

    // Observe DOM mutations (SPA nav, injected buttons)
    const mo = new MutationObserver(() => applyGuard());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Listen for likely custom events/apps (adjust if you have specific ones)
    ["authChanged", "userChanged", "roleChanged", "appReady"].forEach(ev =>
      document.addEventListener(ev, applyGuard)
    );

    // If Firebase modular auth is available, hook into it (optional)
    try {
      if (window.firebase?.auth) {
        window.firebase.auth().onAuthStateChanged?.(() => applyGuard());
      }
    } catch (_) {}
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
