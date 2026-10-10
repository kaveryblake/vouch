/*
 * Vouch UI. Reads rules from config.js, does all math through engine.js, and keeps
 * the portfolio in localStorage. Routes are hash based so the app works on GitHub
 * Pages and straight from the file system.
 */
(function () {
  "use strict";
  const CFG = window.VOUCH_CONFIG, E = window.VouchEngine, SAMPLE = window.VouchSample;
  const KEY = "vouch.v1";
  const TODAY = E.todayIso();
  const CONFIG_ERRORS = E.validateConfig(CFG);

  /* ---------- state ---------- */
  function load() { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  let S = load() || { vendors: [] };
  if (!Array.isArray(S.vendors)) S = { vendors: [] };
  let P = null, R = {};
  function compute() {
    P = E.evaluatePortfolio(S.vendors, CFG, TODAY);
    R = {}; P.results.forEach(r => { R[r.vendor.id] = r; });
  }
  function commit() { save(); compute(); }
  compute();

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const QBY = Object.fromEntries(CFG.questions.map(q => [q.id, q]));
  const DBY = Object.fromEntries(CFG.domains.map(d => [d.id, d]));
  const DTY = Object.fromEntries(CFG.dataTypes.map(d => [d.id, d.label]));
  const ACC = Object.fromEntries(CFG.accessLevels.map(a => [a.id, a.label]));
  const STATUS = Object.fromEntries(CFG.findingStatuses.map(s => [s.id, s.label]));
  const EVS = Object.fromEntries(CFG.evidenceStatuses.map(s => [s.id, s.label]));
  const RES_ORDER = ["Critical", "High", "Medium", "Low", "Not assessed"];
  function fmtDate(iso) {
    if (!E.isDate(iso)) return "";
    return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function rel(days) {
    if (days === 0) return "today";
    const n = Math.abs(days), u = n === 1 ? "day" : "days";
    return days > 0 ? "in " + n + " " + u : n + " " + u + " ago";
  }
  function fmtScore(n) { return n == null ? "Not scored" : (Number.isInteger(n) ? String(n) : n.toFixed(1)); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function resChip(level) { return `<span class="chip res-${esc(level.replace(/\s+/g, "-"))}">${esc(level)}</span>`; }
  function tierChip(t) { return `<span class="chip tier t${t.tier}" title="${esc(t.label)} inherent risk">Tier ${t.tier}</span>`; }
  function sevChip(s) { return `<span class="chip plain sev-${esc(s)}">${esc(s)}</span>`; }
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, 2600); }
  function vendorById(id) { return S.vendors.find(v => v.id === id); }
  function slug(name) {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "vendor";
    let id = base, n = 2;
    while (vendorById(id)) id = base + "-" + n++;
    return id;
  }
  function download(name, text, type) {
    try {
      const blob = new Blob(["﻿" + text], { type: type || "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Downloaded " + name);
    } catch (e) { toast("Download is not available in this browser."); }
  }
  function ownersList() { return [...new Set(S.vendors.map(v => v.owner).concat(P.results.flatMap(r => r.findings.map(f => f.owner))).filter(Boolean))].sort(); }

  /* ---------- router ---------- */
  function route() {
    const h = (location.hash || "#/").slice(1);
    const [path, qs] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    return { name: parts[0] || "dash", id: parts[1] ? decodeURIComponent(parts[1]) : "", tab: parts[2] || "", query, key: h };
  }
  let lastKey = null;
  function render(keepScroll) {
    const r = route();
    const y = scrollY;
    document.querySelectorAll("[data-nav]").forEach(a => {
      const on = a.dataset.nav === r.name || (a.dataset.nav === "vendors" && r.name === "vendor");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const views = { dash: viewDash, vendors: viewVendors, vendor: viewVendor, findings: viewFindings, rules: viewRules, report: viewReport };
    (views[r.name] || viewDash)(r);
    document.body.classList.toggle("is-report", r.name === "report");
    if (keepScroll || r.key === lastKey) scrollTo(0, y); else scrollTo(0, 0);
    lastKey = r.key;
  }
  function rerender(focusSel) {
    render(true);
    if (focusSel) { const el = $(focusSel); if (el) el.focus({ preventScroll: true }); }
  }
  window.addEventListener("hashchange", () => render(false));

  /* ---------- landing ---------- */
  function viewLanding() {
    $("#main").innerHTML = `
    <section class="wrap hero">
      <div><h1>Know which vendors deserve your attention first.</h1></div>
      <div>
        <p>Vouch tiers each vendor by inherent risk, scores its security questionnaire, turns gaps into findings, and ranks the portfolio by what to reassess next. Every rule is visible and editable.</p>
        <div class="ctas"><button class="btn primary" type="button" data-act="load-sample">Open the sample portfolio</button><button class="btn" type="button" data-act="add-vendor">Add your first vendor</button></div>
      </div>
    </section>
    <section class="wrap steps">
      <div><span class="n">01</span><b>Intake and tier</b><span>Data shared, system access, and criticality set Tier 1 to 4, with the rule that put it there.</span></div>
      <div><span class="n">02</span><b>Assess</b><span>35 weighted questions across 8 domains. Critical gaps become High findings automatically.</span></div>
      <div><span class="n">03</span><b>Residual risk</b><span>Inherent tier and control score meet in a matrix. Open High findings hold the line.</span></div>
      <div><span class="n">04</span><b>Track</b><span>Owners, due dates, risk acceptances, expiring SOC 2 reports, and an aging view.</span></div>
    </section>`;
  }

  /* ---------- dashboard ---------- */
  function bar(label, n, max, color, href, title) {
    const w = max ? (n / max) * 100 : 0;
    const inner = `<span>${esc(label)}</span><span class="btrack"><span class="bfill" style="width:${w}%;background:${color}"></span></span><span class="n">${n}</span>`;
    return href ? `<a class="brow" href="${href}" title="${esc(title || label + ": " + n)}">${inner}</a>` : `<div class="brow" title="${esc(title || label + ": " + n)}">${inner}</div>`;
  }
  function viewDash() {
    if (!S.vendors.length) return viewLanding();
    const res = P.results;
    const allF = res.flatMap(r => r.findings);
    const openF = allF.filter(f => f.open);
    const overdueF = allF.filter(f => f.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue);
    const ev = res.flatMap(r => r.evidence).filter(e => e.state === "expired" || e.state === "expiring").sort((a, b) => a.daysLeft - b.daysLeft);
    const renewals = res.filter(r => r.renewal && r.renewal.upcoming).sort((a, b) => a.renewal.daysUntil - b.renewal.daysUntil);
    const tierCounts = CFG.tiers.map(t => res.filter(r => r.tier.tier === t.tier).length);
    const resCounts = RES_ORDER.map(l => res.filter(r => r.residual.level === l).length);
    const t1 = tierCounts[0];
    const hiRes = res.filter(r => r.residual.level === "Critical" || r.residual.level === "High").length;
    const overdueReass = res.filter(r => r.reassessment.status === "overdue" || r.reassessment.status === "never").length;
    const tierColors = ["var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)"];
    const resColors = { Critical: "var(--red)", High: "var(--r2)", Medium: "var(--amber)", Low: "var(--green)", "Not assessed": "var(--rule)" };
    const tmax = Math.max(...tierCounts, 1), rmax = Math.max(...resCounts, 1);
    // tier x residual matrix
    const cell = {}; let cmax = 1;
    res.forEach(r => { const k = r.tier.tier + "|" + r.residual.level; cell[k] = (cell[k] || 0) + 1; cmax = Math.max(cmax, cell[k]); });
    const heat = n => n ? "heat-" + Math.min(4, Math.max(1, Math.ceil((n / cmax) * 4))) : "heat-0 z";
    const matrix = `<div class="matrix" role="table" aria-label="Vendors by inherent tier and residual risk">
      <span></span>${RES_ORDER.map(l => `<span class="h" role="columnheader">${l === "Not assessed" ? "Not<br>assessed" : esc(l)}</span>`).join("")}
      ${CFG.tiers.map(t => `<span class="rh" role="rowheader">Tier ${t.tier}</span>${RES_ORDER.map(l => { const n = cell[t.tier + "|" + l] || 0; return `<span class="c ${heat(n)}" role="cell" title="Tier ${t.tier}, ${esc(l)}: ${plural(n, "vendor")}">${n}</span>`; }).join("")}`).join("")}
    </div>`;

    const rankRows = P.ranked.slice(0, 8).map((r, i) => {
      const ra = r.reassessment;
      const due = ra.status === "never" ? `<span class="warn">Never assessed</span>` : ra.status === "overdue" ? `<span class="bad">Overdue ${ra.daysOverdue} days</span><span class="sub">Due ${fmtDate(ra.due)}</span>` : `<span>Due ${fmtDate(ra.due)}</span><span class="sub">${rel(-ra.daysOverdue)}</span>`;
      return `<div class="tr t-rank"><span class="rank">${i + 1}</span>
        <span><a class="name" href="#/vendor/${encodeURIComponent(r.vendor.id)}">${esc(r.vendor.name)}</a><span class="sub">${esc(r.vendor.service || "")}</span></span>
        <span class="hide-m">${tierChip(r.tier)}</span><span>${resChip(r.residual.level)}</span><span class="hide-m">${due}</span>
        <span class="prio hide-m" title="${r.priority.residualPoints} points for ${esc(r.residual.level)} residual risk, ${r.priority.overduePoints} for timing">${r.priority.score}<small>${r.priority.residualPoints} ${r.priority.overduePoints < 0 ? "-" : "+"} ${Math.abs(r.priority.overduePoints)}</small></span></div>`;
    }).join("");

    const list = (items, fn, emptyText) => items.length ? `<div class="tbl">${items.map(fn).join("")}</div>` : `<div class="empty">${emptyText}</div>`;
    $("#main").innerHTML = `
    <section class="wrap phead">
      <div><h1>Vendor risk portfolio</h1><div class="meta">${plural(S.vendors.length, "vendor")} as of ${fmtDate(TODAY)}</div></div>
      <div class="acts"><button class="btn" type="button" data-act="add-vendor">Add vendor</button><button class="btn" type="button" data-act="export-portfolio">Export CSV</button></div>
    </section>
    ${CONFIG_ERRORS.length ? `<section class="wrap"><div class="card bad">Config problems: ${esc(CONFIG_ERRORS.join("; "))}</div></section>` : ""}
    <section class="wrap">
      <div class="tiles">
        <div><div class="k">Vendors</div><div class="v">${S.vendors.length}</div><div class="s">${t1} in Tier 1</div></div>
        <div><div class="k">High or critical residual</div><div class="v" style="${hiRes ? "color:var(--red)" : ""}">${hiRes}</div><div class="s">after controls</div></div>
        <div><div class="k">Open findings</div><div class="v">${openF.length}</div><div class="s">${openF.filter(f => f.severity === "High").length} High</div></div>
        <div><div class="k">Overdue findings</div><div class="v" style="${overdueF.length ? "color:var(--amber)" : ""}">${overdueF.length}</div><div class="s">past due date</div></div>
        <div><div class="k">Reassessments due</div><div class="v">${overdueReass}</div><div class="s">overdue or never done</div></div>
        <div><div class="k">Evidence alerts</div><div class="v">${ev.length}</div><div class="s">${ev.filter(e => e.state === "expired").length} expired</div></div>
      </div>
      <div class="grid3">
        <div class="card"><h2>Vendors by inherent tier</h2><div class="bars">${CFG.tiers.map((t, i) => bar("Tier " + t.tier, tierCounts[i], tmax, tierColors[i], "#/vendors?tier=" + t.tier, "Tier " + t.tier + " (" + t.label + "): " + plural(tierCounts[i], "vendor"))).join("")}</div></div>
        <div class="card"><h2>Vendors by residual risk</h2><div class="bars">${RES_ORDER.map((l, i) => bar(l, resCounts[i], rmax, resColors[l], "#/vendors?res=" + encodeURIComponent(l), l + ": " + plural(resCounts[i], "vendor"))).join("")}</div></div>
        <div class="card"><h2>Tier against residual risk</h2>${matrix}</div>
      </div>
      <div class="card section"><h2>Reassess first <small>Priority = residual risk points + months overdue x ${CFG.priority.pointsPerMonthOverdue}</small></h2>
        <div class="tbl"><div class="tr th t-rank"><span>#</span><span>Vendor</span><span class="hide-m">Tier</span><span>Residual</span><span class="hide-m">Reassessment</span><span class="hide-m">Priority</span></div>${rankRows}</div>
      </div>
      <div class="grid3">
        <div class="card"><h2>Overdue findings <small><a href="#/findings?overdue=1">View all</a></small></h2>
          ${list(overdueF.slice(0, 6), f => `<div class="tr t-alert"><span><a class="name" href="#/vendor/${encodeURIComponent(f.vendorId)}/findings">${esc(f.vendorName)}</a><span class="sub">${esc(f.questionId)}: ${esc(f.question)}</span></span><span>${sevChip(f.severity)}<span class="sub bad" style="text-align:right">${f.daysOverdue}d late</span></span></div>`, "No overdue findings.")}</div>
        <div class="card"><h2>Evidence expiring or expired <small>${CFG.alertWindows.evidenceExpiringDays}-day window</small></h2>
          ${list(ev.slice(0, 6), e => `<div class="tr t-alert"><span><a class="name" href="#/vendor/${encodeURIComponent(e.vendorId)}/questionnaire">${esc(e.vendorName)}</a><span class="sub">${esc(e.label)}</span></span><span class="${e.state === "expired" ? "bad" : "warn"}" style="font-size:13px;text-align:right">${e.state === "expired" ? "Expired" : "Expires"}<span class="sub">${rel(e.daysLeft)}</span></span></div>`, "No evidence expiring in the window.")}</div>
        <div class="card"><h2>Contract renewals <small>next ${CFG.alertWindows.renewalDays} days</small></h2>
          ${list(renewals, r => `<div class="tr t-alert"><span><a class="name" href="#/vendor/${encodeURIComponent(r.vendor.id)}">${esc(r.vendor.name)}</a><span class="sub">${tierChip(r.tier)} ${r.counts.open ? plural(r.counts.open, "open finding") : "No open findings"}</span></span><span style="font-size:13px;text-align:right">${fmtDate(r.renewal.date)}<span class="sub">${rel(r.renewal.daysUntil)}</span></span></div>`, "No renewals in the window.")}</div>
      </div>
    </section>`;
  }

  /* ---------- vendors list ---------- */
  function viewVendors(r) {
    if (!S.vendors.length) return viewLanding();
    const q = r.query;
    const f = { s: q.s || "", tier: q.tier || "", res: q.res || "", sort: q.sort || "priority" };
    let rows = P.results.slice();
    if (f.s) { const s = f.s.toLowerCase(); rows = rows.filter(x => (x.vendor.name + " " + (x.vendor.service || "") + " " + (x.vendor.owner || "")).toLowerCase().includes(s)); }
    if (f.tier) rows = rows.filter(x => String(x.tier.tier) === f.tier);
    if (f.res) rows = rows.filter(x => x.residual.level === f.res);
    const sorters = {
      priority: (a, b) => b.priority.score - a.priority.score,
      name: (a, b) => a.vendor.name.localeCompare(b.vendor.name),
      tier: (a, b) => a.tier.tier - b.tier.tier || a.vendor.name.localeCompare(b.vendor.name),
      score: (a, b) => (a.scores.overall == null ? 999 : a.scores.overall) - (b.scores.overall == null ? 999 : b.scores.overall)
    };
    rows.sort(sorters[f.sort] || sorters.priority);
    $("#main").innerHTML = `
    <section class="wrap phead"><div><h1>Vendors</h1><div class="meta">${plural(rows.length, "vendor")}${rows.length !== S.vendors.length ? " of " + S.vendors.length : ""}</div></div>
      <div class="acts"><button class="btn" type="button" data-act="add-vendor">Add vendor</button><button class="btn" type="button" data-act="export-portfolio">Export CSV</button></div></section>
    <section class="wrap">
      <div class="tools">
        <label class="sr" for="vs">Search vendors</label><input class="input grow" id="vs" type="search" placeholder="Search name, service, or owner" value="${esc(f.s)}">
        <label class="sr" for="vt">Tier</label><select class="input" id="vt"><option value="">All tiers</option>${CFG.tiers.map(t => `<option value="${t.tier}" ${f.tier == t.tier ? "selected" : ""}>Tier ${t.tier} (${esc(t.label)})</option>`).join("")}</select>
        <label class="sr" for="vr">Residual risk</label><select class="input" id="vr"><option value="">All residual risk</option>${RES_ORDER.map(l => `<option ${f.res === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <label class="sr" for="vo">Sort</label><select class="input" id="vo">${[["priority", "Sort by priority"], ["tier", "Sort by tier"], ["score", "Sort by lowest score"], ["name", "Sort by name"]].map(([k, l]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="card">
        ${rows.length ? `<div class="tbl"><div class="tr th t-vend"><span>Vendor</span><span class="hide-m">Tier</span><span class="hide-m">Control score</span><span>Residual</span><span class="hide-m">Open findings</span><span class="hide-m">Next reassessment</span></div>
        ${rows.map(x => {
          const ra = x.reassessment;
          return `<div class="tr t-vend"><span><a class="name" href="#/vendor/${encodeURIComponent(x.vendor.id)}">${esc(x.vendor.name)}</a><span class="sub">${esc(x.vendor.service || "")}${x.vendor.owner ? ", " + esc(x.vendor.owner) : ""}</span></span>
            <span class="hide-m">${tierChip(x.tier)}</span>
            <span class="hide-m"><b>${fmtScore(x.scores.overall)}</b><span class="sub">${x.band ? esc(x.band.label) : x.scores.completion + "% answered"}</span></span>
            <span>${resChip(x.residual.level)}</span>
            <span class="hide-m"><b>${x.counts.open}</b><span class="sub">${x.counts.high ? x.counts.high + " High" : "No High"}</span></span>
            <span class="hide-m">${ra.status === "never" ? `<span class="warn">Never assessed</span>` : ra.status === "overdue" ? `<span class="bad">Overdue ${ra.daysOverdue} days</span>` : esc(fmtDate(ra.due))}<span class="sub">${esc(x.tier.reassessMonths)}-month cycle</span></span></div>`;
        }).join("")}</div>` : `<div class="empty">No vendors match these filters.</div>`}
      </div>
    </section>`;
    const go = () => {
      const p = new URLSearchParams();
      const s = $("#vs").value.trim(); if (s) p.set("s", s);
      if ($("#vt").value) p.set("tier", $("#vt").value);
      if ($("#vr").value) p.set("res", $("#vr").value);
      if ($("#vo").value !== "priority") p.set("sort", $("#vo").value);
      const h = "#/vendors" + (p.toString() ? "?" + p : "");
      history.replaceState(null, "", h); lastKey = h.slice(1); viewVendors(route());
    };
    $("#vt").onchange = go; $("#vr").onchange = go; $("#vo").onchange = go;
    let t; $("#vs").oninput = () => { clearTimeout(t); t = setTimeout(() => { go(); const el = $("#vs"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 220); };
  }

  /* ---------- vendor page ---------- */
  function intakeFields(v, prefix) {
    const p = prefix || "vk";
    return `<div class="fields" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
      <div class="field"><label for="${p}-name">Vendor name</label><input class="input" id="${p}-name" data-${p}="name" value="${esc(v.name)}" autocomplete="off"></div>
      <div class="field"><label for="${p}-service">Service provided</label><input class="input" id="${p}-service" data-${p}="service" value="${esc(v.service || "")}" placeholder="Payroll processing"></div>
      <div class="field"><label for="${p}-owner">Business owner</label><input class="input" id="${p}-owner" data-${p}="owner" value="${esc(v.owner || "")}" placeholder="Human resources" list="owners"></div>
      <div class="field"><label for="${p}-access">System access</label><select class="input" id="${p}-access" data-${p}="access">${CFG.accessLevels.map(a => `<option value="${a.id}" ${v.access === a.id ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>
      <div class="field"><label for="${p}-crit">Criticality to operations</label><select class="input" id="${p}-crit" data-${p}="criticality">${[[1, "1, minimal impact"], [2, "2, minor impact"], [3, "3, moderate impact"], [4, "4, major impact"], [5, "5, operations stop"]].map(([n, l]) => `<option value="${n}" ${Number(v.criticality) === n ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="${p}-renewal">Contract renewal</label><input class="input" type="date" id="${p}-renewal" data-${p}="renewal" value="${esc(v.renewal || "")}"></div>
      <div class="field"><label for="${p}-last">Last assessed</label><input class="input" type="date" id="${p}-last" data-${p}="lastAssessed" value="${esc(v.lastAssessed || "")}"><span class="hint">Leave blank if never assessed</span></div>
      <div class="field"><span class="lab">Subprocessor</span><label class="chk" style="align-self:flex-start"><input type="checkbox" data-${p}="subprocessor" ${v.subprocessor ? "checked" : ""}> Yes, handles customer data</label></div>
    </div>
    <div class="field" style="margin-top:14px"><span class="lab">Data shared with the vendor</span><div class="checks">${CFG.dataTypes.map(d => `<label class="chk"><input type="checkbox" data-${p}-data="${d.id}" ${(v.dataTypes || []).includes(d.id) ? "checked" : ""}> ${esc(d.label)}</label>`).join("")}</div></div>
    <datalist id="owners">${ownersList().map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;
  }
  function readIntake(root, prefix, v) {
    const p = prefix;
    root.querySelectorAll(`[data-${p}]`).forEach(el => {
      const k = el.dataset[p];
      if (k === "subprocessor") v.subprocessor = el.checked;
      else if (k === "criticality") v.criticality = Number(el.value);
      else v[k] = el.value.trim ? el.value.trim() : el.value;
    });
    const data = [...root.querySelectorAll(`[data-${p}-data]`)].filter(x => x.checked).map(x => x.dataset[p + "Data"]);
    v.dataTypes = data.length ? data : ["none"];
  }
  function ruleText(when) {
    const parts = [];
    const SHORT = { none: "no", internal: "internal", personal: "personal", financial: "financial", health: "health" };
    const orList = xs => xs.length < 3 ? xs.join(" or ") : xs.slice(0, -1).join(", ") + ", or " + xs[xs.length - 1];
    if (when.dataAny) parts.push("shares " + orList(when.dataAny.map(d => SHORT[d] || d)) + " data");
    if (when.access) parts.push("has " + orList(when.access.map(a => ({ none: "no", read: "read-only", privileged: "privileged" }[a] || a))) + " system access");
    if (when.criticalityMin != null) parts.push("criticality is " + when.criticalityMin + (when.criticalityMin < 5 ? " or higher" : ""));
    if (when.subprocessor != null) parts.push(when.subprocessor ? "is a subprocessor" : "is not a subprocessor");
    return parts.join(", and ");
  }

  function viewVendor(r) {
    const v = vendorById(r.id);
    if (!v) { $("#main").innerHTML = `<section class="wrap phead"><div><a class="crumb" href="#/vendors">All vendors</a><h1>Vendor not found</h1></div></section>`; return; }
    const x = R[v.id];
    const tab = ["questionnaire", "findings"].includes(r.tab) ? r.tab : "overview";
    const base = "#/vendor/" + encodeURIComponent(v.id);
    const openCount = x.findings.filter(f => f.open).length;
    let body = "";
    if (tab === "overview") body = vendorOverview(v, x);
    if (tab === "questionnaire") body = vendorQuestionnaire(v, x);
    if (tab === "findings") body = (x.findings.length ? x.findings.map(f => findingRow(f, false)).join("") : `<div class="empty">No findings. Gaps appear here automatically when a question is answered No or Partial, or when evidence expires.</div>`) + `<datalist id="owners">${ownersList().map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;
    $("#main").innerHTML = `
    <section class="wrap phead">
      <div><a class="crumb" href="#/vendors">All vendors</a><h1>${esc(v.name)}</h1>
        <div class="meta" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${tierChip(x.tier)} ${resChip(x.residual.level)} <span>${esc(v.service || "")}${v.owner ? ", owned by " + esc(v.owner) : ""}</span></div></div>
      <div class="acts"><a class="btn" href="#/report/${encodeURIComponent(v.id)}">Vendor summary report</a><button class="btn ghost danger" type="button" data-act="delete-vendor" data-vid="${esc(v.id)}">Delete</button></div>
    </section>
    <section class="wrap">
      <nav class="tabs" aria-label="Vendor sections">
        <a href="${base}" ${tab === "overview" ? 'aria-current="page"' : ""}>Overview</a>
        <a href="${base}/questionnaire" ${tab === "questionnaire" ? 'aria-current="page"' : ""}>Questionnaire <span class="muted">${x.scores.answered}/${x.scores.total}</span></a>
        <a href="${base}/findings" ${tab === "findings" ? 'aria-current="page"' : ""}>Findings <span class="muted">${openCount} open</span></a>
      </nav>
      <div data-vendor="${esc(v.id)}">${body}</div>
    </section>`;
  }
  function vendorOverview(v, x) {
    const lower = x.tier.matched.filter(m => m.tier !== x.tier.tier);
    const ra = x.reassessment;
    const resLine = x.band
      ? `Tier ${x.tier.tier} with ${esc(x.band.label)} controls (${fmtScore(x.scores.overall)}) = <b>${esc(x.residual.base)}</b>${x.residual.floored ? `<br><span class="bad">Raised to ${esc(x.residual.level)}</span>: an open High finding holds Tier ${x.tier.tier} vendors at ${esc(CFG.highFindingFloor.level)} or above.` : ""}`
      : `No answers yet. Complete the questionnaire to calculate residual risk.`;
    return `<div class="vgrid">
      <div class="stack">
        <div class="grid2" style="margin-top:0">
          <div class="card"><h2>Inherent risk <small>${esc(x.tier.reassessMonths)}-month cycle</small></h2>
            <div style="display:flex;align-items:baseline;gap:10px"><span class="big">Tier ${x.tier.tier}</span><span class="muted">${esc(x.tier.label)}</span></div>
            <ul class="reasons">${x.tier.reasons.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
            ${lower.length ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Also matched at lower tiers: ${lower.map(m => esc(m.reason)).join("; ")}.</p>` : ""}
          </div>
          <div class="card"><h2>Residual risk <small>${x.scores.completion}% answered</small></h2>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="big">${x.scores.overall == null ? "--" : fmtScore(x.scores.overall)}</span><span class="muted">control score</span>${resChip(x.residual.level)}</div>
            <div class="formula">${resLine}</div>
          </div>
        </div>
        <div class="card"><h2>Domain scores <small>N/A answers excluded</small></h2>
          ${CFG.domains.map(d => { const s = x.scores.domains[d.id]; return `<div class="dbar"><span>${esc(d.name)}</span><span class="btrack" title="${esc(d.name)}: ${s.score == null ? "not scored" : fmtScore(s.score)}"><span class="bfill" style="width:${s.score || 0}%;${s.score != null && s.score < 50 ? "background:var(--red)" : s.score != null && s.score < 70 ? "background:var(--amber)" : ""}"></span></span><span class="n">${s.score == null ? (s.answered && s.na === s.answered ? "N/A" : "--") : fmtScore(s.score)}</span></div>`; }).join("")}
        </div>
        <div class="card"><h2>Vendor profile <small>Changes re-tier the vendor immediately</small></h2><div data-intake>${intakeFields(v, "vk")}</div></div>
      </div>
      <div class="stack">
        <div class="card"><h2>Reassessment</h2>
          <dl class="kv"><dt>Last assessed</dt><dd>${v.lastAssessed ? fmtDate(v.lastAssessed) : "Never"}</dd>
          <dt>Cycle</dt><dd>Every ${x.tier.reassessMonths} months</dd>
          <dt>Next due</dt><dd>${fmtDate(ra.due)}</dd>
          <dt>Status</dt><dd>${ra.status === "overdue" ? `<span class="bad">Overdue ${ra.daysOverdue} days</span>` : ra.status === "never" ? `<span class="warn">Never assessed</span>` : ra.status === "due_soon" ? `<span class="warn">Due ${rel(-ra.daysOverdue)}</span>` : "Current"}</dd>
          <dt>Priority</dt><dd>${x.priority.score} <span class="muted" style="font-weight:400">(rank ${P.ranked.findIndex(y => y.vendor.id === v.id) + 1} of ${S.vendors.length})</span></dd></dl>
          <button class="btn small" type="button" data-act="mark-assessed" data-vid="${esc(v.id)}" style="margin-top:12px">Mark assessed today</button>
        </div>
        <div class="card"><h2>Findings</h2>
          <dl class="kv"><dt>Open</dt><dd>${x.counts.open}</dd><dt>High, open</dt><dd>${x.counts.high}</dd><dt>Overdue</dt><dd>${x.counts.overdue}</dd><dt>Risk accepted</dt><dd>${x.counts.accepted}</dd></dl>
          <a class="btn small" style="margin-top:12px" href="#/vendor/${encodeURIComponent(v.id)}/findings">Open findings</a>
        </div>
        <div class="card"><h2>Evidence with expiry</h2>
          ${x.evidence.length ? `<div class="tbl">${x.evidence.map(e => `<div class="tr t-alert"><span>${esc(e.label)}<span class="sub">${fmtDate(e.expiry)}</span></span><span class="${e.state === "expired" ? "bad" : e.state === "expiring" ? "warn" : "muted"}" style="font-size:13px">${e.state === "expired" ? "Expired" : e.state === "expiring" ? "Expiring" : "Current"}</span></div>`).join("")}</div>` : `<p class="muted" style="margin:0;font-size:14px">No dated evidence recorded yet.</p>`}
        </div>
        <div class="card"><h2>Contract</h2><dl class="kv"><dt>Renewal</dt><dd>${v.renewal ? fmtDate(v.renewal) + ` <span class="muted" style="font-weight:400">(${rel(x.renewal.daysUntil)})</span>` : "Not set"}</dd></dl></div>
      </div>
    </div>`;
  }
  function vendorQuestionnaire(v, x) {
    const answers = v.answers || {};
    const opts = [["yes", "Yes"], ["partial", "Partial"], ["no", "No"], ["na", "N/A"]];
    return `<div class="qprog"><div class="meter" aria-hidden="true"><i style="width:${x.scores.completion}%"></i></div>
      <span class="muted">${x.scores.answered} of ${x.scores.total} answered</span><b>Score ${fmtScore(x.scores.overall)}</b>
      <button class="btn small" type="button" data-act="mark-assessed" data-vid="${esc(v.id)}">Mark assessed today</button></div>
    ${CFG.domains.map(d => {
      const s = x.scores.domains[d.id];
      return `<section class="qdom"><header><h3>${esc(d.name)}</h3><span>${s.score == null ? "Not scored" : "Score " + fmtScore(s.score)} | NIST CSF ${esc(d.csf)} | ISO 27001 ${esc(d.iso)}</span></header>
      ${CFG.questions.filter(q => q.d === d.id).map(q => {
        const a = answers[q.id] || {};
        const evs = q.expires ? E.evidenceState(a.exp, TODAY, CFG) : null;
        return `<div class="q" data-q="${q.id}">
          <div><div class="qt">${esc(q.q)}</div>
            <div class="qm"><span class="mono">${q.id}</span><span>Weight ${q.w}</span>${q.critical ? `<span class="crit" title="A No answer creates a High finding">Critical</span>` : ""}<span>Evidence: ${esc(q.ev)}</span></div></div>
          <div class="seg" role="group" aria-label="Answer for ${q.id}">${opts.map(([k, l]) => `<button type="button" id="ans-${q.id}-${k}" data-a="${k}" data-qa="${q.id}" aria-pressed="${a.a === k}">${l}</button>`).join("")}</div>
          <div class="qe">
            <label for="ev-${q.id}">Evidence</label><select class="input" id="ev-${q.id}" data-qk="ev" data-qid="${q.id}"><option value="">Not tracked</option>${CFG.evidenceStatuses.map(e => `<option value="${e.id}" ${a.ev === e.id ? "selected" : ""}>${esc(e.label)}</option>`).join("")}</select>
            ${q.expires ? `<label for="exp-${q.id}">Expires</label><input class="input" type="date" id="exp-${q.id}" data-qk="exp" data-qid="${q.id}" value="${esc(a.exp || "")}">${evs.state === "expired" ? `<span class="evx bad">Expired ${rel(evs.daysLeft)}</span>` : evs.state === "expiring" ? `<span class="evx warn">Expires ${rel(evs.daysLeft)}</span>` : ""}` : ""}
            <label class="sr" for="nt-${q.id}">Notes</label><input class="input note" id="nt-${q.id}" data-qk="note" data-qid="${q.id}" placeholder="Notes or vendor response" value="${esc(a.note || "")}">
          </div></div>`;
      }).join("")}</section>`;
    }).join("")}`;
  }

  /* ---------- findings ---------- */
  function findingRow(f, showVendor) {
    const kind = f.kind === "expired_evidence" ? "Expired evidence" : f.detail;
    const closed = !f.open;
    return `<article class="fx ${closed ? "closed" : ""}" data-fid="${esc(f.id)}" data-vid="${esc(f.vendorId)}">
      <div class="c-main">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:5px">${sevChip(f.severity)}<span class="mono">${esc(f.questionId)}</span>${QBY[f.questionId] && QBY[f.questionId].critical && f.kind === "gap" ? `<span class="crit">Critical</span>` : ""}${f.overdue ? `<span class="bad" style="font-size:12.5px">Overdue ${f.daysOverdue} days</span>` : ""}${f.acceptanceExpired ? `<span class="bad" style="font-size:12.5px">Acceptance expired</span>` : ""}</div>
        <div class="ft">${esc(f.question)}</div>
        <div class="fm">${showVendor ? `<a href="#/vendor/${encodeURIComponent(f.vendorId)}/findings">${esc(f.vendorName)}</a>` : ""}<span>${esc(kind)}</span><span>${esc(DBY[f.domain].name)}</span><span>Opened ${fmtDate(f.openedAt)}${f.open ? ", " + esc(f.aging) : ""}</span></div>
      </div>
      <div class="cell c-owner"><label for="fo-${esc(f.id)}">Owner</label><input class="input" id="fo-${esc(f.id)}" data-fk="owner" list="owners" value="${esc(f.owner)}"></div>
      <div class="cell c-due"><label for="fd-${esc(f.id)}">Due</label><input class="input" type="date" id="fd-${esc(f.id)}" data-fk="due" value="${esc(f.due)}"></div>
      <div class="cell c-status"><label for="fs-${esc(f.id)}">Status</label><select class="input" id="fs-${esc(f.id)}" data-fk="status">${CFG.findingStatuses.map(s => `<option value="${s.id}" ${f.status === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
      ${f.status === "accepted" ? `<div class="acc"><span><b>Risk accepted by ${esc(f.accept.approver || "unknown")}</b>, until ${fmtDate(f.accept.expiry) || "no date"}. ${esc(f.accept.justification)}</span><button class="btn small" type="button" data-act="edit-accept">Edit</button></div>` : ""}
    </article>`;
  }
  function viewFindings(r) {
    if (!S.vendors.length) return viewLanding();
    const q = r.query;
    const f = { s: q.s || "", sev: q.sev || "", status: q.status || "active", vendor: q.vendor || "", overdue: q.overdue === "1" };
    const all = P.results.flatMap(x => x.findings);
    let rows = all.slice();
    if (f.status === "active") rows = rows.filter(x => x.open);
    else if (f.status) rows = rows.filter(x => x.status === f.status);
    if (f.sev) rows = rows.filter(x => x.severity === f.sev);
    if (f.vendor) rows = rows.filter(x => x.vendorId === f.vendor);
    if (f.overdue) rows = rows.filter(x => x.overdue);
    if (f.s) { const s = f.s.toLowerCase(); rows = rows.filter(x => [x.vendorName, x.question, x.questionId, x.owner].join(" ").toLowerCase().includes(s)); }
    const rank = s => CFG.severityOrder.indexOf(s);
    rows.sort((a, b) => (b.overdue - a.overdue) || rank(b.severity) - rank(a.severity) || b.daysOpen - a.daysOpen);
    const open = all.filter(x => x.open);
    const buckets = CFG.agingBuckets.map(b => ({ label: b.label, n: open.filter(x => x.aging === b.label).length }));
    const bmax = Math.max(1, ...buckets.map(b => b.n));
    const statusCounts = CFG.findingStatuses.map(s => ({ s, n: all.filter(x => x.status === s.id).length }));
    const smax = Math.max(1, ...statusCounts.map(x => x.n));
    const agingColors = ["var(--r4)", "var(--r3)", "var(--r2)", "var(--r1)"];
    const shown = rows.slice(0, 200);
    $("#main").innerHTML = `
    <section class="wrap phead"><div><h1>Remediation tracker</h1><div class="meta">${plural(open.length, "open finding")}, ${all.filter(x => x.overdue).length} overdue, ${all.filter(x => x.status === "accepted" && !x.acceptanceExpired).length} risk accepted</div></div>
      <div class="acts"><button class="btn" type="button" data-act="export-findings">Export CSV</button></div></section>
    <section class="wrap">
      <div class="grid2" style="margin-top:0;margin-bottom:14px">
        <div class="card"><h2>Open findings by age <small>days since opened</small></h2><div class="bars">${buckets.map((b, i) => bar(b.label, b.n, bmax, agingColors[i], null, b.label + ": " + plural(b.n, "open finding"))).join("")}</div></div>
        <div class="card"><h2>All findings by status</h2><div class="bars">${statusCounts.map(x => bar(x.s.label, x.n, smax, "var(--graphite)", "#/findings?status=" + x.s.id, x.s.label + ": " + x.n)).join("")}</div></div>
      </div>
      <div class="tools">
        <label class="sr" for="fq">Search findings</label><input class="input grow" id="fq" type="search" placeholder="Search vendor, question, or owner" value="${esc(f.s)}">
        <label class="sr" for="fsv">Severity</label><select class="input" id="fsv"><option value="">All severities</option>${CFG.severityOrder.slice().reverse().map(s => `<option ${f.sev === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label class="sr" for="fst">Status</label><select class="input" id="fst"><option value="active" ${f.status === "active" ? "selected" : ""}>Open and in progress</option><option value="" ${f.status === "" ? "selected" : ""}>All statuses</option>${CFG.findingStatuses.map(s => `<option value="${s.id}" ${f.status === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        <label class="sr" for="fvn">Vendor</label><select class="input" id="fvn"><option value="">All vendors</option>${S.vendors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v => `<option value="${esc(v.id)}" ${f.vendor === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
        <label class="chk"><input type="checkbox" id="fov" ${f.overdue ? "checked" : ""}> Overdue only</label>
      </div>
      <p class="muted" style="font-size:13.5px;margin:0 0 10px">${plural(rows.length, "finding")}${rows.length > shown.length ? ", showing the first " + shown.length : ""}. Overdue items first, then by severity and age.</p>
      ${shown.length ? shown.map(x => findingRow(x, true)).join("") : `<div class="empty">No findings match these filters.</div>`}
      <datalist id="owners">${ownersList().map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    </section>`;
    const go = () => {
      const p = new URLSearchParams();
      const s = $("#fq").value.trim(); if (s) p.set("s", s);
      if ($("#fsv").value) p.set("sev", $("#fsv").value);
      if ($("#fst").value !== "active") p.set("status", $("#fst").value);
      if ($("#fvn").value) p.set("vendor", $("#fvn").value);
      if ($("#fov").checked) p.set("overdue", "1");
      const h = "#/findings" + (p.toString() ? "?" + p : "");
      history.replaceState(null, "", h); lastKey = h.slice(1); viewFindings(route());
    };
    ["#fsv", "#fst", "#fvn", "#fov"].forEach(sel => { $(sel).onchange = go; });
    let t; $("#fq").oninput = () => { clearTimeout(t); t = setTimeout(() => { go(); const el = $("#fq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 220); };
  }

  /* ---------- rules ---------- */
  function viewRules() {
    const bands = CFG.controlBands;
    $("#main").innerHTML = `
    <section class="wrap phead"><div><h1>Rules</h1><div class="meta">Every rule Vouch applies, read live from <span class="mono">config.js</span>. Edit that file to change them. ${CONFIG_ERRORS.length ? `<span class="bad">Config problems: ${esc(CONFIG_ERRORS.join("; "))}</span>` : "Config validation passed."}</div></div></section>
    <section class="wrap stack">
      <div class="card"><h2>Inherent risk tiering <small>Most severe matching rule wins. All matching rules at that tier are shown as the reason.</small></h2>
        <div class="scroll"><table class="rtable"><thead><tr><th>Tier</th><th>When the vendor</th><th>Reason shown</th></tr></thead><tbody>
        ${CFG.tierRules.map(r => `<tr><td>${tierChip(CFG.tiers.find(t => t.tier === r.tier))}</td><td>${esc(ruleText(r.when))}</td><td>${esc(r.reason)}</td></tr>`).join("")}
        <tr><td>${tierChip(CFG.tiers.find(t => t.tier === CFG.defaultTier.tier))}</td><td class="muted">matches no rule above</td><td>${esc(CFG.defaultTier.reason)}</td></tr></tbody></table></div></div>
      <div class="grid2" style="margin-top:0">
        <div class="card"><h2>Reassessment cadence</h2><table class="rtable"><thead><tr><th>Tier</th><th>Label</th><th>Reassess every</th></tr></thead><tbody>${CFG.tiers.map(t => `<tr><td>Tier ${t.tier}</td><td>${esc(t.label)}</td><td>${t.reassessMonths} months</td></tr>`).join("")}</tbody></table></div>
        <div class="card"><h2>Control rating bands</h2><table class="rtable"><thead><tr><th>Band</th><th>Weighted score</th></tr></thead><tbody>${bands.map((b, i) => `<tr><td>${esc(b.label)}</td><td>${b.min}${i ? " to " + (bands[i - 1].min - 0.1) : " to 100"}</td></tr>`).join("")}</tbody></table>
          <p class="muted" style="font-size:13px;margin:10px 0 0">Yes earns full weight, Partial ${CFG.answerValues.partial * 100}%, No 0. N/A and unanswered questions are left out of the denominator.</p></div>
      </div>
      <div class="card"><h2>Residual risk matrix <small>Inherent tier against control band</small></h2>
        <div class="scroll"><table class="rtable rmatrix"><thead><tr><th>Tier</th>${bands.map(b => `<th>${esc(b.label)}</th>`).join("")}</tr></thead><tbody>
        ${CFG.tiers.map(t => `<tr><td>Tier ${t.tier}</td>${bands.map(b => `<td>${resChip(CFG.residualMatrix[t.tier][b.id])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Floor: an open High finding keeps Tier ${CFG.highFindingFloor.tiers.join(" and ")} vendors at ${esc(CFG.highFindingFloor.level)} or above, regardless of the overall score. Risk-accepted findings do not trigger the floor until the acceptance expires.</p></div>
      <div class="grid2" style="margin-top:0">
        <div class="card"><h2>Finding generation</h2><table class="rtable"><thead><tr><th>Trigger</th><th>Severity</th><th>Due in</th></tr></thead><tbody>
          <tr><td>Critical question answered No</td><td>${sevChip(CFG.findingSeverity.critical.no)}</td><td>${CFG.remediationSlaDays[CFG.findingSeverity.critical.no]} days</td></tr>
          <tr><td>Critical question answered Partial</td><td>${sevChip(CFG.findingSeverity.critical.partial)}</td><td>${CFG.remediationSlaDays[CFG.findingSeverity.critical.partial]} days</td></tr>
          <tr><td>Standard question answered No</td><td>${sevChip(CFG.findingSeverity.standard.no)}</td><td>${CFG.remediationSlaDays[CFG.findingSeverity.standard.no]} days</td></tr>
          <tr><td>Standard question answered Partial</td><td>${sevChip(CFG.findingSeverity.standard.partial)}</td><td>${CFG.remediationSlaDays[CFG.findingSeverity.standard.partial]} days</td></tr>
          <tr><td>Dated evidence past its expiry</td><td>${sevChip(CFG.findingSeverity.expiredEvidence)}</td><td>${CFG.remediationSlaDays[CFG.findingSeverity.expiredEvidence]} days</td></tr></tbody></table></div>
        <div class="card"><h2>Priority and alerts</h2><table class="rtable"><tbody>
          <tr><td>Reassess-first priority</td><td>Residual points + months overdue x ${CFG.priority.pointsPerMonthOverdue} (between ${CFG.priority.monthsFloor} and ${CFG.priority.monthsCap} months)</td></tr>
          <tr><td>Residual points</td><td>${Object.entries(CFG.priority.residualPoints).map(([k, n]) => esc(k) + " " + n).join(", ")}</td></tr>
          <tr><td>Evidence alert</td><td>Expires within ${CFG.alertWindows.evidenceExpiringDays} days</td></tr>
          <tr><td>Renewal alert</td><td>Contract renews within ${CFG.alertWindows.renewalDays} days</td></tr>
          <tr><td>Aging buckets</td><td>${CFG.agingBuckets.map(b => esc(b.label)).join(", ")}</td></tr></tbody></table></div>
      </div>
      <div class="card"><h2>Questionnaire <small>${CFG.questions.length} questions, ${CFG.domains.length} domains</small></h2>
        <div class="scroll"><table class="rtable"><thead><tr><th>Domain</th><th>Questions</th><th>Total weight</th><th>Critical</th><th>NIST CSF 2.0</th><th>ISO/IEC 27001:2022</th></tr></thead><tbody>
        ${CFG.domains.map(d => { const qs = CFG.questions.filter(q => q.d === d.id); return `<tr><td>${esc(d.name)}</td><td>${qs.length}</td><td>${qs.reduce((a, q) => a + q.w, 0)}</td><td>${qs.filter(q => q.critical).length}</td><td>${esc(d.csf)}</td><td>${esc(d.iso)}</td></tr>`; }).join("")}</tbody></table></div></div>
      <div class="card"><h2>Data</h2><p class="muted" style="margin:0 0 12px;font-size:14px">The portfolio is stored only in this browser.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-act="load-sample">Load the sample portfolio</button><button class="btn" type="button" data-act="export-json">Download a backup (JSON)</button><button class="btn ghost danger" type="button" data-act="clear-all">Clear all data</button></div></div>
    </section>`;
  }

  /* ---------- report ---------- */
  function viewReport(r) {
    const v = vendorById(r.id);
    if (!v) { location.hash = "#/vendors"; return; }
    const x = R[v.id];
    const open = x.findings.filter(f => f.open);
    const accepted = x.findings.filter(f => f.status === "accepted" && !f.acceptanceExpired);
    const shown = open.slice().sort((p, q) => (q.overdue - p.overdue) || CFG.severityOrder.indexOf(q.severity) - CFG.severityOrder.indexOf(p.severity)).slice(0, 8);
    const logo = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2.5 24 6v7.5c0 6-4.3 10.3-10 12-5.7-1.7-10-6-10-12V6z" fill="none" stroke="#16221E" stroke-width="2" stroke-linejoin="round"/><path d="M8.6 14.6c1.6 1 2.8 2.3 3.8 3.8 2.2-4.2 4.6-7.2 7.2-9" fill="none" stroke="#B3302A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    $("#main").innerHTML = `
    <div class="rbar"><a class="btn" href="#/vendor/${encodeURIComponent(v.id)}">Back to vendor</a><button class="btn primary" type="button" data-act="print">Print or save as PDF</button></div>
    <article class="report">
      <div class="rhead"><div><div class="rbrand">${logo} Vouch | Vendor risk summary</div><h1 style="margin-top:8px">${esc(v.name)}</h1><div>${esc(v.service || "")}${v.owner ? ", business owner: " + esc(v.owner) : ""}</div></div>
        <div style="text-align:right">Prepared ${fmtDate(TODAY)}<br>Last assessed ${v.lastAssessed ? fmtDate(v.lastAssessed) : "never"}<br>Next reassessment ${fmtDate(x.reassessment.due)}${x.reassessment.status === "overdue" ? " (overdue)" : ""}</div></div>
      <div class="facts">
        <div><span>Inherent risk</span><b>Tier ${x.tier.tier}</b>${esc(x.tier.label)}</div>
        <div><span>Control score</span><b>${x.scores.overall == null ? "--" : fmtScore(x.scores.overall)}</b>${x.band ? esc(x.band.label) : "Not assessed"}, ${x.scores.completion}% answered</div>
        <div><span>Residual risk</span><b>${esc(x.residual.level)}</b>${x.residual.floored ? "Raised by open High finding" : x.band ? "Tier x control band" : ""}</div>
        <div><span>Open findings</span><b>${open.length}</b>${x.counts.high} High, ${x.counts.overdue} overdue</div>
      </div>
      <div class="two">
        <div><h2>Why Tier ${x.tier.tier}</h2><ul style="margin:0;padding-left:16px">${x.tier.reasons.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
          <h2>Profile</h2><table><tbody>
          <tr><td>Data shared</td><td>${esc((v.dataTypes || []).map(d => DTY[d] || d).join(", "))}</td></tr>
          <tr><td>System access</td><td>${esc(ACC[v.access] || v.access)}</td></tr>
          <tr><td>Criticality</td><td>${esc(v.criticality)} of 5</td></tr>
          <tr><td>Subprocessor</td><td>${v.subprocessor ? "Yes" : "No"}</td></tr>
          <tr><td>Contract renewal</td><td>${v.renewal ? fmtDate(v.renewal) : "Not set"}</td></tr></tbody></table></div>
        <div><h2>Domain scores</h2><table><thead><tr><th>Domain</th><th>Score</th><th>Answered</th></tr></thead><tbody>
          ${CFG.domains.map(d => { const s = x.scores.domains[d.id]; return `<tr><td>${esc(d.name)}</td><td>${s.score == null ? (s.answered && s.na === s.answered ? "N/A" : "--") : fmtScore(s.score)}</td><td>${s.answered}/${s.total}</td></tr>`; }).join("")}</tbody></table></div>
      </div>
      <h2>Open findings${open.length > shown.length ? ` (${shown.length} most urgent of ${open.length})` : ""}</h2>
      ${shown.length ? `<table><thead><tr><th>Severity</th><th>Ref</th><th>Finding</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>
        ${shown.map(f => `<tr><td class="nw">${sevChip(f.severity)}</td><td class="nw">${esc(f.questionId)}</td><td>${esc(f.question)}${f.kind === "expired_evidence" ? " (evidence expired)" : ""}</td><td>${esc(f.owner)}</td><td class="nw">${fmtDate(f.due)}${f.overdue ? "<br><b>Overdue</b>" : ""}</td><td class="nw">${esc(f.acceptanceExpired ? "Acceptance expired" : STATUS[f.status])}</td></tr>`).join("")}</tbody></table>` : `<p>No open findings.</p>`}
      ${accepted.length ? `<h2>Accepted risks</h2><table><tbody>${accepted.map(f => `<tr><td>${esc(f.questionId)}</td><td>${esc(f.accept.justification)}</td><td>${esc(f.accept.approver)}, until ${fmtDate(f.accept.expiry)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${x.evidence.length ? `<h2>Dated evidence</h2><table><tbody>${x.evidence.map(e => `<tr><td>${esc(e.label)}</td><td>${fmtDate(e.expiry)}</td><td>${e.state === "expired" ? "Expired" : e.state === "expiring" ? "Expires " + rel(e.daysLeft) : "Current"}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="sign"><div>Reviewed by (third-party risk)</div><div>Approved by (business owner)</div></div>
    </article>`;
  }

  /* ---------- drawers ---------- */
  let drawerCancel = null;
  function openDrawer(html, onCancel) {
    const d = $("#drawer"); d.innerHTML = html; document.body.classList.add("open"); drawerCancel = onCancel || null;
    const f = d.querySelector("input,select,textarea,button"); if (f) f.focus();
    d.querySelectorAll("[data-close]").forEach(b => { b.onclick = () => closeDrawer(true); });
  }
  function closeDrawer(cancelled) {
    document.body.classList.remove("open");
    if (cancelled && drawerCancel) drawerCancel();
    drawerCancel = null;
  }
  $("#scrim").onclick = () => closeDrawer(true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("open")) closeDrawer(true); });

  function openAddVendor() {
    const v = { name: "", service: "", owner: "", dataTypes: ["none"], access: "none", criticality: 3, subprocessor: false, renewal: "", lastAssessed: "" };
    openDrawer(`<header><div style="flex:1"><h2 id="dTitle">Add a vendor</h2><p>Intake answers set the inherent risk tier. You can change them later.</p></div><button class="btn ghost small" data-close type="button">Close</button></header>
      <div class="content"><div id="addForm">${intakeFields(v, "nv")}</div><div class="formula" id="tierPreview"></div><p class="err" id="addErr" role="alert"></p></div>
      <footer><button class="btn" data-close type="button">Cancel</button><button class="btn primary" type="button" id="addSave">Add and start questionnaire</button></footer>`);
    const form = $("#addForm");
    const preview = () => {
      readIntake(form, "nv", v);
      const t = E.computeTier(v, CFG);
      $("#tierPreview").innerHTML = `<b>Tier ${t.tier} (${esc(t.label)})</b>, reassessed every ${t.reassessMonths} months. ${t.reasons.map(esc).join("; ")}.`;
    };
    form.addEventListener("change", e => {
      if (e.target.dataset.nvData === "none" && e.target.checked) form.querySelectorAll("[data-nv-data]").forEach(c => { if (c.dataset.nvData !== "none") c.checked = false; });
      else if (e.target.dataset.nvData && e.target.checked) { const n = form.querySelector('[data-nv-data="none"]'); if (n) n.checked = false; }
      preview();
    });
    form.addEventListener("input", preview);
    preview();
    $("#addSave").onclick = () => {
      readIntake(form, "nv", v);
      if (!v.name) { $("#addErr").textContent = "Enter the vendor name."; $("#nv-name").focus(); return; }
      const nv = Object.assign({ id: slug(v.name), answers: {}, findings: {} }, v);
      S.vendors.push(nv); commit(); closeDrawer(false);
      location.hash = "#/vendor/" + encodeURIComponent(nv.id) + "/questionnaire";
      toast(v.name + " added as Tier " + R[nv.id].tier.tier);
    };
  }
  function openAccept(fid, vid, prevStatus) {
    const v = vendorById(vid); const f = R[vid].findings.find(x => x.id === fid);
    const a = f.accept || {};
    const revert = () => rerender();
    openDrawer(`<header><div style="flex:1"><h2 id="dTitle">Accept this risk</h2><p>${esc(v.name)}, ${esc(f.questionId)}: ${esc(f.question)}</p></div><button class="btn ghost small" data-close type="button">Close</button></header>
      <div class="content">
        <div class="field"><label for="ac-j">Justification and compensating controls</label><textarea class="input" id="ac-j" placeholder="Why the residual exposure is acceptable and what offsets it">${esc(a.justification)}</textarea></div>
        <div class="fields"><div class="field"><label for="ac-a">Approved by</label><input class="input" id="ac-a" value="${esc(a.approver)}" placeholder="CISO"></div>
        <div class="field"><label for="ac-e">Acceptance expires</label><input class="input" type="date" id="ac-e" value="${esc(a.expiry || E.addDays(TODAY, 180))}"><span class="hint">The finding reopens on this date</span></div></div>
        <p class="err" id="ac-err" role="alert"></p></div>
      <footer><button class="btn" data-close type="button">Cancel</button><button class="btn primary" type="button" id="ac-save">Accept risk</button></footer>`, revert);
    $("#ac-save").onclick = () => {
      const j = $("#ac-j").value.trim(), ap = $("#ac-a").value.trim(), ex = $("#ac-e").value;
      if (!j || !ap || !E.isDate(ex)) { $("#ac-err").textContent = "A justification, an approver, and an expiry date are all required."; return; }
      if (E.daysBetween(TODAY, ex) <= 0) { $("#ac-err").textContent = "The expiry date must be in the future."; return; }
      const m = metaFor(v, fid);
      m.status = "accepted"; m.accept = { justification: j, approver: ap, expiry: ex };
      commit(); closeDrawer(false); rerender(); toast("Risk accepted until " + fmtDate(ex));
    };
  }
  function metaFor(v, fid) {
    v.findings = v.findings || {};
    if (!v.findings[fid]) {
      const f = R[v.id] && R[v.id].findings.find(x => x.id === fid);
      v.findings[fid] = f ? { owner: f.owner, openedAt: f.openedAt, due: f.due, status: f.status } : {};
    }
    return v.findings[fid];
  }

  /* ---------- exports ---------- */
  function exportPortfolio() {
    const head = ["Vendor", "Service", "Business owner", "Data shared", "System access", "Criticality", "Subprocessor", "Inherent tier", "Tier reasons", "Control score", "Control band", "Answered", "Residual risk", "Raised by High finding", "Open findings", "Open High", "Overdue findings", "Risk accepted", "Last assessed", "Next reassessment", "Reassessment status", "Priority score", "Contract renewal", "Evidence expired", "Evidence expiring"];
    const rows = P.ranked.map(x => {
      const v = x.vendor;
      return [v.name, v.service, v.owner, (v.dataTypes || []).map(d => DTY[d] || d).join("; "), ACC[v.access] || v.access, v.criticality, v.subprocessor ? "Yes" : "No",
        "Tier " + x.tier.tier, x.tier.reasons.join("; "), x.scores.overall == null ? "" : x.scores.overall, x.band ? x.band.label : "", x.scores.answered + "/" + x.scores.total,
        x.residual.level, x.residual.floored ? "Yes" : "No", x.counts.open, x.counts.high, x.counts.overdue, x.counts.accepted, v.lastAssessed || "", x.reassessment.due,
        { overdue: "Overdue", never: "Never assessed", due_soon: "Due soon", current: "Current" }[x.reassessment.status], x.priority.score, v.renewal || "",
        x.evidence.filter(e => e.state === "expired").map(e => e.label).join("; "), x.evidence.filter(e => e.state === "expiring").map(e => e.label).join("; ")];
    });
    download("vouch-portfolio-" + TODAY + ".csv", E.toCSV([head, ...rows]));
  }
  function exportFindings() {
    const head = ["Vendor", "Ref", "Domain", "Finding", "Type", "Severity", "Owner", "Opened", "Due", "Status", "Overdue days", "Aging", "Accepted by", "Acceptance expires", "Justification"];
    const rows = P.results.flatMap(x => x.findings).map(f => [f.vendorName, f.questionId, DBY[f.domain].name, f.question, f.kind === "expired_evidence" ? "Expired evidence" : f.detail, f.severity, f.owner, f.openedAt, f.due,
      f.acceptanceExpired ? "Acceptance expired" : STATUS[f.status], f.daysOverdue || "", f.open ? f.aging : "", f.accept.approver, f.accept.expiry, f.accept.justification]);
    download("vouch-findings-" + TODAY + ".csv", E.toCSV([head, ...rows]));
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const qa = e.target.closest("[data-qa]");
    if (qa) {
      const v = vendorById(qa.closest("[data-vendor]").dataset.vendor);
      const qid = qa.dataset.qa, a = qa.dataset.a;
      v.answers = v.answers || {};
      const cur = v.answers[qid] || {};
      cur.a = cur.a === a ? "" : a; // clicking the active answer clears it
      if (!cur.a) delete cur.a;
      if (cur.a === "no" && !cur.ev) cur.ev = "not_provided";
      v.answers[qid] = cur;
      if (cur.a === "no" || cur.a === "partial") { // stamp the open date the first time a gap appears
        const fid = v.id + ":" + qid; v.findings = v.findings || {};
        if (!v.findings[fid]) v.findings[fid] = { openedAt: TODAY, owner: v.owner || "" };
      }
      commit(); rerender("#ans-" + qid + "-" + a);
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const k = act.dataset.act;
    if (k === "load-sample") {
      if (S.vendors.length && !confirm("Replace the current portfolio with the sample portfolio?")) return;
      S = { vendors: SAMPLE.build(CFG, E, TODAY) }; commit();
      if (location.hash === "#/" || location.hash === "" || location.hash === "#") render(false); else location.hash = "#/";
      toast("Sample portfolio loaded: 15 fictional vendors");
    }
    if (k === "add-vendor") openAddVendor();
    if (k === "export-portfolio") exportPortfolio();
    if (k === "export-findings") exportFindings();
    if (k === "export-json") download("vouch-backup-" + TODAY + ".json", JSON.stringify(S, null, 2), "application/json");
    if (k === "clear-all") { if (confirm("Delete every vendor, answer, and finding stored in this browser?")) { S = { vendors: [] }; commit(); location.hash = "#/"; render(false); toast("All data cleared"); } }
    if (k === "print") window.print();
    if (k === "delete-vendor") {
      const v = vendorById(act.dataset.vid);
      if (v && confirm("Delete " + v.name + " and all of its answers and findings?")) { S.vendors = S.vendors.filter(x => x !== v); commit(); location.hash = "#/vendors"; toast(v.name + " deleted"); }
    }
    if (k === "mark-assessed") {
      const v = vendorById(act.dataset.vid); v.lastAssessed = TODAY; commit(); rerender(); toast("Last assessed set to today. Next reassessment " + fmtDate(R[v.id].reassessment.due));
    }
    if (k === "edit-accept") { const fx = act.closest("[data-fid]"); openAccept(fx.dataset.fid, fx.dataset.vid, "accepted"); }
  });
  document.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.qk === "note") { const v = vendorById(el.closest("[data-vendor]").dataset.vendor); const a = (v.answers[el.dataset.qid] = v.answers[el.dataset.qid] || {}); a.note = el.value; save(); }
    if (el.dataset.fk === "owner") { const fx = el.closest("[data-fid]"); metaFor(vendorById(fx.dataset.vid), fx.dataset.fid).owner = el.value; save(); }
    if (el.dataset.vk && el.type !== "checkbox" && el.tagName === "INPUT" && el.type !== "date") { const v = vendorById(el.closest("[data-vendor]").dataset.vendor); v[el.dataset.vk] = el.value; save(); }
  });
  document.addEventListener("change", e => {
    const el = e.target;
    if (el.dataset.qk === "ev" || el.dataset.qk === "exp") {
      const v = vendorById(el.closest("[data-vendor]").dataset.vendor);
      const a = (v.answers[el.dataset.qid] = v.answers[el.dataset.qid] || {});
      a[el.dataset.qk] = el.value; commit(); rerender("#" + el.id);
    }
    if (el.dataset.fk === "due") { const fx = el.closest("[data-fid]"); metaFor(vendorById(fx.dataset.vid), fx.dataset.fid).due = el.value; commit(); rerender("#" + CSS.escape(el.id)); }
    if (el.dataset.fk === "owner") { commit(); }
    if (el.dataset.fk === "status") {
      const fx = el.closest("[data-fid]"); const v = vendorById(fx.dataset.vid);
      if (el.value === "accepted") { openAccept(fx.dataset.fid, fx.dataset.vid); return; }
      const m = metaFor(v, fx.dataset.fid); m.status = el.value; if (el.value !== "accepted") delete m.accept;
      commit(); rerender("#" + CSS.escape(el.id)); toast("Status set to " + STATUS[el.value]);
    }
    if (el.dataset.vk || el.dataset.vkData) {
      const root = el.closest("[data-intake]"); const v = vendorById(el.closest("[data-vendor]").dataset.vendor);
      if (el.dataset.vkData === "none" && el.checked) root.querySelectorAll("[data-vk-data]").forEach(c => { if (c.dataset.vkData !== "none") c.checked = false; });
      else if (el.dataset.vkData && el.checked) { const n = root.querySelector('[data-vk-data="none"]'); if (n) n.checked = false; }
      const before = R[v.id].tier.tier;
      readIntake(root, "vk", v);
      if (!v.name) v.name = "Unnamed vendor";
      commit(); rerender(el.id ? "#" + el.id : null);
      if (R[v.id].tier.tier !== before) toast(v.name + " moved from Tier " + before + " to Tier " + R[v.id].tier.tier);
    }
  });

  /* ---------- theme ---------- */
  $("#themeBtn").onclick = () => {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("vouch.theme", r.dataset.theme); } catch (e) { }
  };

  render(false);
})();
