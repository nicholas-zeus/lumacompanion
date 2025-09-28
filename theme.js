// /js/theme.js
(function () {
  const KEY = "theme";
  const root = document.documentElement;

  function apply(theme) {
    root.dataset.theme = theme;            // "light" | "sunset"
    try { localStorage.setItem(KEY, theme); } catch {}
    updateCheckmarks(theme);
  }

  function current() {
    try { return localStorage.getItem(KEY) || "light"; } catch { return "light"; }
  }

  function updateCheckmarks(theme) {
    document.querySelectorAll("#themesList .drawer-sub-item").forEach(item => {
      const mark = item.querySelector(".checkmark");
      if (mark) mark.hidden = item.dataset.theme !== theme;
    });
  }

  // Drawer toggle
  const gearBtn = document.getElementById("gearBtn");
  const drawer  = document.getElementById("settingsDrawer");

  function toggleDrawer() {
    if (!drawer) return;
    drawer.classList.toggle("hidden");
  }

  gearBtn?.addEventListener("click", toggleDrawer);

  // Close drawer if clicked outside
  document.addEventListener("click", (e) => {
    if (!drawer || drawer.classList.contains("hidden")) return;
    if (drawer.contains(e.target) || gearBtn.contains(e.target)) return;
    drawer.classList.add("hidden");
  });

  // Theme selection
  document.querySelectorAll("#themesList .drawer-sub-item").forEach(item => {
    item.addEventListener("click", () => {
      const theme = item.dataset.theme;
      apply(theme);
    });
  });

  // Expand/collapse "Themes >"
  const themesToggle = document.getElementById("themesToggle");
  const themesList   = document.getElementById("themesList");
  themesToggle?.addEventListener("click", () => {
    themesList.classList.toggle("hidden");
  });

  // Bootstrap
  apply(current());

  // Expose globally if needed
  window.setTheme = apply;
  window.getTheme = current;
})();