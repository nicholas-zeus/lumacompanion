// /js/theme.js
(function () {
  const KEY = "theme";
  const root = document.documentElement;
  const THEMES = ["light", "sunrise", "sunset", "dark"];
  const DEFAULT = "light";

  function normalize(t) { return THEMES.includes(t) ? t : DEFAULT; }

  function apply(theme) {
    const t = normalize(theme);
    root.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch {}
    updateCheckmarks(t);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }));
  }

  function current() {
    try { return normalize(localStorage.getItem(KEY) || DEFAULT); }
    catch { return DEFAULT; }
  }

  function updateCheckmarks(theme) {
    document.querySelectorAll("#themesList .drawer-sub-item").forEach(item => {
      const mark = item.querySelector(".checkmark");
      if (mark) mark.hidden = item.dataset.theme !== theme;
      item.setAttribute("aria-selected", String(item.dataset.theme === theme));
    });
  }

  // Drawer toggle
  const gearBtn = document.getElementById("gearBtn");
  const drawer  = document.getElementById("settingsDrawer");
  function toggleDrawer() { drawer?.classList.toggle("hidden"); }
  gearBtn?.addEventListener("click", toggleDrawer);

  // Close drawer on outside click
  document.addEventListener("click", (e) => {
    if (!drawer || drawer.classList.contains("hidden")) return;
    if (drawer.contains(e.target) || gearBtn?.contains(e.target)) return;
    drawer.classList.add("hidden");
  });

  // Theme selection (delegated)
  document.addEventListener("click", (e) => {
    const item = e.target.closest("#themesList .drawer-sub-item");
    if (!item) return;
    apply(item.dataset.theme);
  });

  // Expand/collapse “Themes >”
  const themesToggle = document.getElementById("themesToggle");
  const themesList   = document.getElementById("themesList");
  themesToggle?.addEventListener("click", () => themesList?.classList.toggle("hidden"));

  // Optional: Ctrl/Cmd + T to cycle themes
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "t") return;
    e.preventDefault();
    const i = (THEMES.indexOf(current()) + 1) % THEMES.length;
    apply(THEMES[i]);
  });

  // Bootstrap
  apply(current());

  // Expose helpers
  window.setTheme = apply;
  window.getTheme = current;
})();