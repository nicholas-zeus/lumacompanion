// /js/fab.js
function mk(id, text, title) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement("button");
    b.id = id; b.className = "fab";
    b.type = "button";
    b.setAttribute("aria-label", title || text || "");
    b.style.display = "none";
    document.body.appendChild(b);
  }
  b.textContent = text || "";
  b.title = title || "";
  return b;
}
function isMobile(){ return window.matchMedia("(max-width: 860px)").matches; }

const els = {};
function ensure() {
  els.details   = mk("fab-details",      "💾", "Save");
  els.docTop    = mk("fab-docview-top",  "↑",  "Go to top");
  els.mToggle   = mk("fab-manage-toggle","≡",  "Open drawer");
  els.mSave     = mk("fab-manage-save",  "💾", "Save changes");
  // positions
  Object.assign(els.details.style, { right:"16px", bottom:"16px" });
  Object.assign(els.docTop.style,  { right:"16px", bottom:"72px" });
  Object.assign(els.mToggle.style, { right:"16px", bottom:"16px" });
  Object.assign(els.mSave.style,   { right:"16px", bottom:"72px" });
}

let activeTab = "details";
let manageDirty = false;

export const fab = {
  init() { ensure(); this.apply(); },
  setTab(name){ activeTab = name; this.apply(); },
  // ----- Details tab -----
  setDetails(mode, handler){
    ensure();
    const map = {
      create: { icon:"💾", label:"Create" },
      save:   { icon:"💾", label:"Save"   },
      edit:   { icon:"✏️", label:"Edit"   },
    };
    const cfg = map[String(mode).toLowerCase()] || map.save;
    els.details.textContent = cfg.icon;
    els.details.title = cfg.label;
    els.details.setAttribute("aria-label", cfg.label);
    els.details.onclick = (e)=>{ e.preventDefault(); handler?.(); };
    this.apply();
  },
  // ----- DocView tab -----
  useDocTop(handler){
    ensure();
    els.docTop.onclick = (e)=>{ e.preventDefault(); handler ? handler() : window.scrollTo({top:0,behavior:"smooth"}); };
    this.apply();
  },
  // ----- Manage tab (mobile only FABs) -----
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
  apply(){
    ensure();
    const mobile = isMobile();

    // Details FAB visible only on Details tab
    els.details.style.display = (activeTab === "details") ? "grid" : "none";

    // DocView "go to top" visible only on DocView tab (desktop + mobile)
    els.docTop.style.display = (activeTab === "docview") ? "grid" : "none";

    // Manage FABs: only on Manage tab + mobile
    const onManage = (activeTab === "documents");
    els.mToggle.style.display = (onManage && mobile) ? "inline-grid" : "none";
    els.mSave.style.display   = (onManage && mobile && manageDirty) ? "inline-grid" : "none";
  }
};

window.addEventListener("resize", () => fab.apply());
