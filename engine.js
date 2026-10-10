/*
 * Vouch engine: tiering, scoring, findings, residual risk, evidence expiry, and
 * reassessment priority. Pure functions only. No DOM, no storage, no clock: every
 * function that depends on the date takes `today` as an ISO date string, which keeps
 * the math testable with `node --test`.
 *
 * Works as a plain browser script (sets window.VouchEngine) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VouchEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 86400000;

  /* ---------- dates (UTC, ISO yyyy-mm-dd) ---------- */
  function toMs(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function isDate(iso) { return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) && !isNaN(toMs(iso)); }
  function daysBetween(fromIso, toIso) { return Math.round((toMs(toIso) - toMs(fromIso)) / DAY); }
  function addDays(iso, n) { return fromMs(toMs(iso) + n * DAY); }
  function addMonths(iso, n) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return fromMs(target.getTime());
  }
  function todayIso() { return fromMs(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())); }

  /* ---------- tiering ---------- */
  function ruleMatches(when, v) {
    const data = Array.isArray(v.dataTypes) ? v.dataTypes : [];
    if (when.dataAny && !when.dataAny.some(t => data.includes(t))) return false;
    if (when.access && !when.access.includes(v.access)) return false;
    if (when.criticalityMin != null && !(Number(v.criticality) >= when.criticalityMin)) return false;
    if (when.subprocessor != null && Boolean(v.subprocessor) !== when.subprocessor) return false;
    return true;
  }
  function computeTier(v, cfg) {
    const matched = cfg.tierRules.filter(r => ruleMatches(r.when, v));
    const tierNum = matched.length ? Math.min(...matched.map(r => r.tier)) : cfg.defaultTier.tier;
    const def = cfg.tiers.find(t => t.tier === tierNum);
    const reasons = matched.length ? matched.filter(r => r.tier === tierNum).map(r => r.reason) : [cfg.defaultTier.reason];
    return { tier: tierNum, label: def.label, reassessMonths: def.reassessMonths, reasons, matched };
  }

  /* ---------- scoring ---------- */
  function scoreAssessment(v, cfg) {
    const answers = v.answers || {};
    const dom = {};
    cfg.domains.forEach(d => { dom[d.id] = { id: d.id, name: d.name, total: 0, answered: 0, na: 0, earned: 0, possible: 0, score: null }; });
    let earned = 0, possible = 0, answered = 0;
    cfg.questions.forEach(q => {
      const s = dom[q.d]; s.total++;
      const a = answers[q.id] && answers[q.id].a;
      if (!a) return;
      s.answered++; answered++;
      if (a === "na") { s.na++; return; }
      const val = cfg.answerValues[a];
      if (val == null) return;
      s.earned += val * q.w; s.possible += q.w;
      earned += val * q.w; possible += q.w;
    });
    Object.values(dom).forEach(s => { s.score = s.possible ? Math.round((s.earned / s.possible) * 1000) / 10 : null; });
    return {
      overall: possible ? Math.round((earned / possible) * 1000) / 10 : null,
      domains: dom,
      answered,
      total: cfg.questions.length,
      completion: Math.round((answered / cfg.questions.length) * 100)
    };
  }
  function controlBand(score, cfg) {
    if (score == null) return null;
    return cfg.controlBands.find(b => score >= b.min) || cfg.controlBands[cfg.controlBands.length - 1];
  }

  /* ---------- evidence ---------- */
  function evidenceState(expiry, today, cfg) {
    if (!isDate(expiry)) return { state: "none", daysLeft: null };
    const daysLeft = daysBetween(today, expiry);
    if (daysLeft < 0) return { state: "expired", daysLeft };
    if (daysLeft <= cfg.alertWindows.evidenceExpiringDays) return { state: "expiring", daysLeft };
    return { state: "current", daysLeft };
  }

  /* ---------- findings ---------- */
  function agingBucket(days, cfg) {
    return cfg.agingBuckets.find(b => days <= b.max).label;
  }
  function isOpenStatus(f) { return f.status === "open" || f.status === "in_progress" || (f.status === "accepted" && f.acceptanceExpired); }

  function generateFindings(v, cfg, today) {
    const answers = v.answers || {};
    const meta = v.findings || {};
    const out = [];
    const base = isDate(v.lastAssessed) ? v.lastAssessed : today;
    function push(id, q, severity, kind, detail) {
      const m = meta[id] || {};
      const openedAt = isDate(m.openedAt) ? m.openedAt : base;
      const due = isDate(m.due) ? m.due : addDays(openedAt, cfg.remediationSlaDays[severity]);
      const status = m.status || "open";
      const accept = m.accept || {};
      const acceptanceExpired = status === "accepted" && isDate(accept.expiry) && daysBetween(today, accept.expiry) < 0;
      const f = {
        id, vendorId: v.id, vendorName: v.name, questionId: q.id, domain: q.d, question: q.q,
        severity, kind, detail, owner: m.owner != null ? m.owner : (v.owner || ""), openedAt, due, status,
        accept: { justification: accept.justification || "", approver: accept.approver || "", expiry: accept.expiry || "" },
        acceptanceExpired, note: m.note || ""
      };
      f.open = isOpenStatus(f);
      f.daysOpen = Math.max(0, daysBetween(openedAt, today));
      f.overdue = f.open && f.status !== "accepted" && daysBetween(today, due) < 0;
      f.daysOverdue = f.overdue ? daysBetween(due, today) : 0;
      f.aging = agingBucket(f.daysOpen, cfg);
      out.push(f);
    }
    cfg.questions.forEach(q => {
      const ans = answers[q.id];
      if (!ans || !ans.a) return;
      const sevSet = q.critical ? cfg.findingSeverity.critical : cfg.findingSeverity.standard;
      if (ans.a === "no" || ans.a === "partial") {
        push(v.id + ":" + q.id, q, sevSet[ans.a], "gap", ans.a === "no" ? "Control not in place" : "Control partially in place");
      }
      if (q.expires && (ans.a === "yes" || ans.a === "partial")) {
        const ev = evidenceState(ans.exp, today, cfg);
        if (ev.state === "expired") {
          push(v.id + ":" + q.id + ":exp", q, cfg.findingSeverity.expiredEvidence, "expired_evidence", "Supporting evidence expired " + ans.exp);
        }
      }
    });
    const rank = s => cfg.severityOrder.indexOf(s);
    return out.sort((a, b) => rank(b.severity) - rank(a.severity) || a.questionId.localeCompare(b.questionId));
  }

  /* ---------- residual risk ---------- */
  function residualRisk(tierNum, band, findings, cfg) {
    if (!band) return { level: "Not assessed", base: null, floored: false };
    const base = cfg.residualMatrix[tierNum][band.id];
    const floor = cfg.highFindingFloor;
    // f.open covers open, in progress, and accepted risks whose acceptance has expired
    const openHigh = (findings || []).some(f => f.severity === "High" && f.open);
    if (floor && floor.tiers.includes(tierNum) && openHigh && cfg.residualLevels.indexOf(base) < cfg.residualLevels.indexOf(floor.level)) {
      return { level: floor.level, base, floored: true };
    }
    return { level: base, base, floored: false };
  }

  /* ---------- reassessment and priority ---------- */
  function reassessment(v, tierInfo, today) {
    if (!isDate(v.lastAssessed)) return { due: today, daysOverdue: 0, status: "never" };
    const due = addMonths(v.lastAssessed, tierInfo.reassessMonths);
    const daysOverdue = daysBetween(due, today);
    return { due, daysOverdue, status: daysOverdue > 0 ? "overdue" : daysOverdue > -60 ? "due_soon" : "current" };
  }
  function priorityScore(residualLevel, reass, cfg) {
    const p = cfg.priority;
    const residualPoints = p.residualPoints[residualLevel] != null ? p.residualPoints[residualLevel] : 0;
    const months = Math.min(p.monthsCap, Math.max(p.monthsFloor, reass.daysOverdue / 30));
    const overduePoints = Math.round(months * p.pointsPerMonthOverdue * 10) / 10;
    return { score: Math.round((residualPoints + overduePoints) * 10) / 10, residualPoints, overduePoints };
  }

  /* ---------- evaluate ---------- */
  function evaluateVendor(v, cfg, today) {
    const tier = computeTier(v, cfg);
    const scores = scoreAssessment(v, cfg);
    const band = controlBand(scores.overall, cfg);
    const findings = generateFindings(v, cfg, today);
    const residual = residualRisk(tier.tier, band, findings, cfg);
    const reass = reassessment(v, tier, today);
    const prio = priorityScore(residual.level, reass, cfg);
    const evidence = [];
    cfg.questions.forEach(q => {
      if (!q.expires) return;
      const ans = (v.answers || {})[q.id];
      if (!ans || !isDate(ans.exp)) return;
      const s = evidenceState(ans.exp, today, cfg);
      evidence.push({ vendorId: v.id, vendorName: v.name, questionId: q.id, label: q.ev, expiry: ans.exp, state: s.state, daysLeft: s.daysLeft });
    });
    let renewal = null;
    if (isDate(v.renewal)) {
      const daysUntil = daysBetween(today, v.renewal);
      renewal = { date: v.renewal, daysUntil, upcoming: daysUntil >= 0 && daysUntil <= cfg.alertWindows.renewalDays };
    }
    const open = findings.filter(f => f.open);
    return {
      vendor: v, tier, scores, band, findings, residual, reassessment: reass, priority: prio, evidence, renewal,
      counts: {
        open: open.length,
        high: open.filter(f => f.severity === "High").length,
        overdue: findings.filter(f => f.overdue).length,
        accepted: findings.filter(f => f.status === "accepted" && !f.acceptanceExpired).length
      }
    };
  }
  function evaluatePortfolio(vendors, cfg, today) {
    const results = vendors.map(v => evaluateVendor(v, cfg, today));
    const ranked = results.slice().sort((a, b) => b.priority.score - a.priority.score || a.tier.tier - b.tier.tier || a.vendor.name.localeCompare(b.vendor.name));
    return { results, ranked };
  }

  /* ---------- config validation ---------- */
  function validateConfig(cfg) {
    const errs = [];
    const ids = new Set();
    const domainIds = new Set(cfg.domains.map(d => d.id));
    cfg.questions.forEach(q => {
      if (ids.has(q.id)) errs.push("Duplicate question id " + q.id);
      ids.add(q.id);
      if (!domainIds.has(q.d)) errs.push(q.id + " uses unknown domain " + q.d);
      if (!(q.w >= 1 && q.w <= 3)) errs.push(q.id + " weight must be 1 to 3");
    });
    cfg.tiers.forEach(t => {
      if (!cfg.residualMatrix[t.tier]) errs.push("Residual matrix missing tier " + t.tier);
      else cfg.controlBands.forEach(b => {
        const lvl = cfg.residualMatrix[t.tier][b.id];
        if (!cfg.residualLevels.includes(lvl)) errs.push("Residual matrix tier " + t.tier + " / " + b.id + " has invalid level");
      });
    });
    cfg.tierRules.forEach((r, i) => { if (!cfg.tiers.some(t => t.tier === r.tier)) errs.push("Tier rule " + (i + 1) + " points to unknown tier " + r.tier); });
    return errs;
  }

  /* ---------- CSV ---------- */
  function toCSV(rows) {
    return rows.map(r => r.map(c => {
      const s = c == null ? "" : String(c);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\r\n");
  }

  return {
    toMs, daysBetween, addDays, addMonths, isDate, todayIso,
    ruleMatches, computeTier, scoreAssessment, controlBand, evidenceState, agingBucket,
    generateFindings, residualRisk, reassessment, priorityScore, evaluateVendor, evaluatePortfolio,
    validateConfig, toCSV
  };
});
