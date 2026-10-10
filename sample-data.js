/*
 * Vouch sample portfolio: 15 fictional vendors. Any resemblance to a real company
 * is unintended. Dates are generated relative to the day the demo is loaded so the
 * alerts (expiring evidence, overdue reassessments, upcoming renewals) stay current.
 * Answers come from a seeded generator plus explicit overrides, so the same demo
 * loads the same way every time.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VouchSample = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // q: chance a control is fully in place. ago: months since last assessment (null = never).
  // renew: days until contract renewal. na: domains that do not apply.
  // ov: answer overrides; expIn sets an evidence expiry relative to today.
  // meta: finding tracker overrides keyed by question id.
  const PROFILES = [
    { id: "keystile", name: "Keystile Identity", service: "Single sign-on and identity", owner: "IT operations", dataTypes: ["internal", "personal"], access: "privileged", criticality: 5, subprocessor: true, q: 0.9, ago: 9, renew: 150,
      ov: { "CMP-01": { a: "yes", ev: "provided", expIn: 70 } } },
    { id: "corvane", name: "Corvane Cloud", service: "Infrastructure hosting", owner: "Platform engineering", dataTypes: ["internal", "personal", "financial"], access: "privileged", criticality: 5, subprocessor: true, q: 0.9, ago: 7, renew: 300,
      ov: { "CMP-01": { a: "yes", ev: "provided", expIn: 45 }, "DEV-03": { a: "yes", ev: "provided", expIn: 120 } } },
    { id: "ironvane", name: "Ironvane Backup", service: "Backup and recovery", owner: "IT operations", dataTypes: ["internal", "personal", "financial"], access: "privileged", criticality: 4, subprocessor: false, q: 0.6, ago: 14, renew: 60 },
    { id: "varrow", name: "Varrow Payments", service: "Payment processing", owner: "Finance", dataTypes: ["personal", "financial"], access: "read", criticality: 5, subprocessor: true, q: 0.84, ago: 4, renew: 210,
      ov: { "ACC-01": { a: "no", ev: "not_provided", note: "MFA enforced for admins only. Merchant portal users sign in with password." } },
      meta: { "ACC-01": { status: "open", dueIn: -20, note: "Vendor committed to MFA for all portal users. No date confirmed yet." } } },
    { id: "larkspan", name: "Larkspan Payroll", service: "Payroll processing", owner: "Human resources", dataTypes: ["personal", "financial"], access: "read", criticality: 3, subprocessor: false, q: 0.86, ago: 11, renew: 45 },
    { id: "brindlewood", name: "Brindlewood Benefits", service: "Benefits administration", owner: "Human resources", dataTypes: ["personal", "health"], access: "read", criticality: 3, subprocessor: true, q: 0.8, ago: 8, renew: 240 },
    { id: "medrow", name: "Medrow Health Billing", service: "Medical claims billing", owner: "Finance", dataTypes: ["personal", "health", "financial"], access: "read", criticality: 3, subprocessor: true, q: 0.5, ago: 5, renew: 330 },
    { id: "saltreed", name: "Saltreed Analytics", service: "Marketing analytics", owner: "Marketing", dataTypes: ["personal"], access: "read", criticality: 2, subprocessor: true, q: 0.76, ago: 10, renew: 80,
      ov: { "CMP-01": { a: "yes", ev: "provided", expIn: -40, note: "Bridge letter requested. New SOC 2 report expected next quarter." } } },
    { id: "pellbrook", name: "Pellbrook Shredding", service: "Document destruction", owner: "Facilities", dataTypes: ["personal"], access: "none", criticality: 2, subprocessor: false, q: 0.72, ago: 26, renew: 120, na: ["dev"] },
    { id: "halvard", name: "Halvard Support", service: "Outsourced help desk", owner: "IT operations", dataTypes: ["internal", "personal"], access: "read", criticality: 3, subprocessor: false, q: 0.68, ago: 20, renew: 20 },
    { id: "quillmere", name: "Quillmere eSign", service: "Electronic signatures", owner: "Legal", dataTypes: ["internal", "personal"], access: "none", criticality: 3, subprocessor: true, q: 0.84, ago: 6, renew: 190,
      ov: { "ACC-01": { a: "partial", ev: "provided", note: "MFA available but optional for signers." } },
      meta: { "ACC-01": { status: "accepted", accept: { justification: "Signers authenticate through emailed one-time links tied to the envelope. Internal senders use SSO with MFA. Residual exposure reviewed and accepted.", approver: "CISO", expiryIn: 150 } } } },
    { id: "fernvale", name: "Fernvale Staffing", service: "Contract staffing", owner: "Human resources", dataTypes: ["personal"], access: "read", criticality: 2, subprocessor: false, q: 0.66, ago: 15, renew: 260, na: ["dev"] },
    { id: "tessra", name: "Tessra Studio", service: "Brand and design agency", owner: "Marketing", dataTypes: ["internal"], access: "none", criticality: 1, subprocessor: false, q: 0.56, ago: 30, renew: 75, na: ["dev", "sub"] },
    { id: "cobblestone", name: "Cobblestone Courier", service: "Local courier", owner: "Facilities", dataTypes: ["internal"], access: "none", criticality: 2, subprocessor: false, q: 0.6, ago: 3, renew: 400, na: ["dev", "sub"] },
    { id: "lumenhall", name: "Lumenhall Facilities", service: "Janitorial services", owner: "Facilities", dataTypes: ["none"], access: "none", criticality: 1, subprocessor: false, q: null, ago: null, renew: 30 }
  ];

  function rng(seedText) {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(cfg, E, today) {
    return PROFILES.map(p => {
      const r = rng(p.id);
      const lastAssessed = p.ago == null ? "" : E.addMonths(today, -p.ago);
      const v = {
        id: p.id, name: p.name, service: p.service, owner: p.owner, dataTypes: p.dataTypes.slice(), access: p.access,
        criticality: p.criticality, subprocessor: p.subprocessor, renewal: E.addDays(today, p.renew), lastAssessed,
        answers: {}, findings: {}, sample: true
      };
      if (p.q != null) {
        cfg.questions.forEach(q => {
          if ((p.na || []).includes(q.d)) { v.answers[q.id] = { a: "na" }; return; }
          const roll = r();
          const a = roll < p.q ? "yes" : roll < p.q + (1 - p.q) * 0.55 ? "partial" : "no";
          const ev = a === "no" ? "not_provided" : a === "partial" ? (r() < 0.6 ? "requested" : "provided") : (r() < 0.85 ? "provided" : "requested");
          const ans = { a, ev };
          if (q.expires && a !== "no") ans.exp = E.addDays(lastAssessed, 365 + Math.floor(r() * 300));
          v.answers[q.id] = ans;
        });
        Object.entries(p.ov || {}).forEach(([qid, o]) => {
          const ans = { a: o.a, ev: o.ev || "provided" };
          if (o.expIn != null) ans.exp = E.addDays(today, o.expIn);
          if (o.note) ans.note = o.note;
          v.answers[qid] = ans;
        });
        // Seed the remediation tracker so the demo shows work in flight.
        const recent = p.ago <= 5;
        E.generateFindings(v, cfg, today).forEach(f => {
          const m = { owner: p.owner };
          const roll = r();
          if (f.severity === "High") m.status = roll < 0.5 ? "in_progress" : "open";
          else if (recent) m.status = roll < 0.35 ? "in_progress" : "open";
          else m.status = roll < 0.55 ? "remediated" : roll < 0.8 ? "in_progress" : "open";
          // Spread open dates and due dates so the aging view and overdue list look like
          // a real program: some items overdue, most still on track.
          const since = Math.max(1, E.daysBetween(lastAssessed, today));
          m.openedAt = E.addDays(today, -Math.floor(r() * Math.min(since, 150)));
          if (m.status !== "remediated") {
            const span = f.severity === "High" ? [-15, 45] : [-45, 120];
            const due = E.addDays(today, span[0] + Math.floor(r() * (span[1] - span[0])));
            m.due = E.daysBetween(m.openedAt, due) < 7 ? E.addDays(m.openedAt, 7) : due;
          }
          v.findings[f.id] = m;
        });
        Object.entries(p.meta || {}).forEach(([qid, m]) => {
          const id = p.id + ":" + qid;
          const merged = Object.assign({ owner: p.owner }, v.findings[id] || {}, m);
          if (m.dueIn != null) merged.due = E.addDays(today, m.dueIn);
          if (m.accept) merged.accept = { justification: m.accept.justification, approver: m.accept.approver, expiry: E.addDays(today, m.accept.expiryIn) };
          v.findings[id] = merged;
        });
      }
      return v;
    });
  }

  return { build, profiles: PROFILES };
});
