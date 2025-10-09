// /js/fab.js

// ---- element factory ----
function mk(id, text, title) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement("button");
    b.id = id;
    b.type = "button";
    // base class; specific variants will be added in ensure()
    b.className = "fab";
    // start hidden; JS controls visibility
    b.style.display = "none";
    document.body.appendChild(b);
  }
  b.textContent = text || "";
  b.title = title || text || "";
  b.setAttribute("aria-label", title || text || "");
  return b;
}

// ---- layout helpers ----
function isMobile(){ return window.matchMedia("(max-width: 860px)").matches; }

function setPos(el, slot) {
  if (!el) return;
  const primary   = { right: "16px", bottom: "72px" };
  const secondary = { right: "16px", bottom: "16px" };
  const pos = (slot === "secondary") ? secondary : primary;
  Object.assign(el.style, pos);

  // Breathing room when stacked: add margin to primary, none to secondary
  el.style.marginBottom = (slot === "secondary") ? "0px" : "20px";
}

// ---- singleton refs ----
const els = {};
function ensure() {
  // create (or get) all FABs once
  els.details = mk("fab-details",       "✏", "Edit");
  els.docTop  = mk("fab-docview-top",   "↑",  "Go to top");
  els.mToggle = mk("fab-manage-toggle", "≡",  "Open drawer");
  els.mSave   = mk("fab-manage-save",   "💾", "Save changes");

  // apply variant classes so CSS can style/position by theme
  els.details.className = "fab";              // primary slot (details tab)
  els.docTop.className  = "fab";              // primary slot (docview)
  els.mToggle.className = "fab fab-toggle";   // secondary slot (manage)
  els.mSave.className   = "fab fab-save";     // higher primary slot (manage dirty)

  // normalize base style (size, positioning layer) WITHOUT colors/borders
  [els.details, els.docTop, els.mToggle, els.mSave].forEach(el => {
    Object.assign(el.style, {
      position: "fixed",
      zIndex: 1001,
      width: "56px",
      height: "56px",
      // keep hidden by default; do NOT override with "grid" here
      display: "none",
      // center contents (CSS uses display:grid; this is safe if CSS not loaded yet)
      placeItems: "center",
      borderRadius: "50%",
      cursor: "pointer",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent"
      // NOTE: no background/color/border here — theme CSS owns those
    });
  });

  setPos(els.details, "primary");
  setPos(els.docTop,  "primary");
  setPos(els.mToggle, "secondary");
  setPos(els.mSave,   "primary");
}

// ---- state ----
let activeTab = "details"; // "details" | "docview" | "documents"
let manageDirty = false;

// ---- API ----
export const fab = {
  init() { ensure(); this.apply(); },

  setTab(name){
    activeTab = String(name || "").toLowerCase();
    this.apply();
  },

  // ----- Details tab -----
  setDetails(mode, handler){
    ensure();
    const map = {
      create: { icon:"✓",  label:"Create" },
      save:   { icon:"✓",  label:"Save"   },
      edit:   { icon:"✏",  label:"Edit"   },
    };
    const key = String(mode || "").toLowerCase();
    const cfg = map[key] || map.save;

    els.details.textContent = cfg.icon;
    els.details.title = cfg.label;
    els.details.setAttribute("aria-label", cfg.label);
    els.details.onclick = (e)=>{ e.preventDefault(); handler?.(); };

    this.apply();
  },

  // ----- DocView tab -----
  useDocTop(handler){
    ensure();
    els.docTop.onclick = (e)=>{
      e.preventDefault();
      if (handler) handler();
      else window.scrollTo({ top: 0, behavior: "smooth" });
    };
    this.apply();
  },

  // ----- Manage tab (mobile-only) -----
  setManageToggle(handler){
    ensure();
    els.mToggle.onclick = (e)=>{ e.preventDefault(); handler?.(); };
    this.apply();
  },

  setManageSave(handler){
    ensure();
    els.mSave.onclick = (e)=>{ e.preventDefault(); handler?.(); };
    this.apply();
  },

  setManageDirty(flag){
    manageDirty = !!flag;
    this.apply();
  },

  // ----- visibility + consistent positions -----
  apply(){
    ensure();
    const mobile = isMobile();
    const tab = String(activeTab || "").toLowerCase();

    // Always start hidden
    els.details.style.display = "none";
    els.docTop.style.display  = "none";
    els.mToggle.style.display = "none";
    els.mSave.style.display   = "none";

    // Reassert slots every time
    setPos(els.details, "primary");
    setPos(els.docTop,  "primary");
    setPos(els.mToggle, "secondary");
    setPos(els.mSave,   "primary");

    if (tab === "details") {
      els.details.style.display = "grid";
    } else if (tab === "docview") {
      els.docTop.style.display = "grid";
    } else if (tab === "documents" || tab === "manage") {
      if (mobile) {
        els.mToggle.style.display = "grid";          // burger on Manage only
        if (manageDirty) els.mSave.style.display = "grid";
      }
    }
  }
};

// keep layout correct on viewport changes
window.addEventListener("resize", () => fab.apply());