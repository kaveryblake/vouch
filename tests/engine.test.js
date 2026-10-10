// Run with: node --test
// No dependencies. Uses a fixed "today" so date math is deterministic.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../config.js");
const E = require("../engine.js");

const TODAY = "2026-10-10";
const clone = o => JSON.parse(JSON.stringify(o));
function vendor(over) {
  return Object.assign({ id: "v1", name: "Test Vendor", dataTypes: ["none"], access: "none", criticality: 1, subprocessor: false, lastAssessed: "2026-06-01", answers: {}, findings: {} }, over);
}
function answers(map) {
  const out = {};
  Object.entries(map).forEach(([k, v]) => { out[k] = typeof v === "string" ? { a: v } : v; });
  return out;
}

/* ---------- configuration ---------- */
test("config: passes validation", () => {
  assert.deepEqual(E.validateConfig(cfg), []);
});
test("config: 35 questions across 8 domains, every domain populated", () => {
  assert.equal(cfg.questions.length, 35);
  assert.equal(cfg.domains.length, 8);
  cfg.domains.forEach(d => assert.ok(cfg.questions.some(q => q.d === d.id), d.id + " has no questions"));
});
test("config: validation catches a broken residual matrix", () => {
  const c = clone(cfg); delete c.residualMatrix[3];
  assert.ok(E.validateConfig(c).some(e => e.includes("tier 3")));
});

/* ---------- tiering ---------- */
test("tier: privileged access to sensitive data is Tier 1", () => {
  const t = E.computeTier(vendor({ access: "privileged", dataTypes: ["personal"], criticality: 2 }), cfg);
  assert.equal(t.tier, 1);
  assert.ok(t.reasons[0].includes("Privileged access"));
});
test("tier: criticality 5 alone is Tier 1", () => {
  assert.equal(E.computeTier(vendor({ criticality: 5 }), cfg).tier, 1);
});
test("tier: financial data with criticality 4 is Tier 1", () => {
  assert.equal(E.computeTier(vendor({ dataTypes: ["financial"], access: "read", criticality: 4 }), cfg).tier, 1);
});
test("tier: health data with criticality 3 is Tier 2", () => {
  assert.equal(E.computeTier(vendor({ dataTypes: ["health"], access: "read", criticality: 3 }), cfg).tier, 2);
});
test("tier: privileged access to internal data only is Tier 2", () => {
  assert.equal(E.computeTier(vendor({ dataTypes: ["internal"], access: "privileged", criticality: 2 }), cfg).tier, 2);
});
test("tier: internal data only is Tier 3, subprocessor only is Tier 3", () => {
  assert.equal(E.computeTier(vendor({ dataTypes: ["internal"] }), cfg).tier, 3);
  assert.equal(E.computeTier(vendor({ subprocessor: true }), cfg).tier, 3);
});
test("tier: nothing sensitive falls to Tier 4 with the default reason", () => {
  const t = E.computeTier(vendor({}), cfg);
  assert.equal(t.tier, 4);
  assert.deepEqual(t.reasons, [cfg.defaultTier.reason]);
});
test("tier: reasons list every matching rule at the winning tier only", () => {
  const t = E.computeTier(vendor({ access: "privileged", dataTypes: ["health"], criticality: 5 }), cfg);
  assert.equal(t.tier, 1);
  assert.equal(t.reasons.length, 3);
  assert.ok(t.matched.length > t.reasons.length, "lower-tier matches are tracked but not shown as reasons");
});
test("tier: editing the rules table changes the outcome", () => {
  const c = clone(cfg);
  c.tierRules.push({ tier: 2, when: { subprocessor: true }, reason: "Custom rule" });
  const t = E.computeTier(vendor({ subprocessor: true }), c);
  assert.equal(t.tier, 2);
  assert.deepEqual(t.reasons, ["Custom rule"]);
});

/* ---------- scoring ---------- */
test("score: all Yes is 100 and Strong", () => {
  const all = {}; cfg.questions.forEach(q => { all[q.id] = { a: "yes" }; });
  const s = E.scoreAssessment(vendor({ answers: all }), cfg);
  assert.equal(s.overall, 100);
  assert.equal(E.controlBand(s.overall, cfg).id, "strong");
  assert.equal(s.completion, 100);
});
test("score: all No is 0 and Deficient", () => {
  const all = {}; cfg.questions.forEach(q => { all[q.id] = { a: "no" }; });
  const s = E.scoreAssessment(vendor({ answers: all }), cfg);
  assert.equal(s.overall, 0);
  assert.equal(E.controlBand(s.overall, cfg).id, "deficient");
});
test("score: weights apply (Yes on weight 3, No on weight 2 is 60)", () => {
  const s = E.scoreAssessment(vendor({ answers: answers({ "GOV-01": "yes", "GOV-02": "no" }) }), cfg);
  assert.equal(s.overall, 60);
  assert.equal(s.domains.gov.score, 60);
});
test("score: Partial counts as half credit", () => {
  const s = E.scoreAssessment(vendor({ answers: answers({ "GOV-01": "partial" }) }), cfg);
  assert.equal(s.overall, 50);
});
test("score: N/A is excluded from the denominator but counts toward completion", () => {
  const s = E.scoreAssessment(vendor({ answers: answers({ "GOV-01": "yes", "GOV-02": "na" }) }), cfg);
  assert.equal(s.overall, 100);
  assert.equal(s.answered, 2);
  assert.equal(s.domains.gov.na, 1);
});
test("score: a domain answered entirely N/A has no score", () => {
  const map = {}; cfg.questions.filter(q => q.d === "dev").forEach(q => { map[q.id] = "na"; });
  map["GOV-01"] = "yes";
  const s = E.scoreAssessment(vendor({ answers: answers(map) }), cfg);
  assert.equal(s.domains.dev.score, null);
  assert.equal(s.overall, 100);
});
test("score: no answers means no score, no band, and Not assessed", () => {
  const r = E.evaluateVendor(vendor({ dataTypes: ["personal"] }), cfg, TODAY);
  assert.equal(r.scores.overall, null);
  assert.equal(r.band, null);
  assert.equal(r.residual.level, "Not assessed");
});
test("score: band boundaries", () => {
  const b = n => E.controlBand(n, cfg).id;
  assert.equal(b(85), "strong"); assert.equal(b(84.9), "adequate");
  assert.equal(b(70), "adequate"); assert.equal(b(69.9), "weak");
  assert.equal(b(50), "weak"); assert.equal(b(49.9), "deficient");
});

/* ---------- findings ---------- */
test("findings: critical No is High, critical Partial is Medium", () => {
  assert.equal(cfg.questions.find(q => q.id === "ACC-01").critical, true);
  const f = E.generateFindings(vendor({ answers: answers({ "ACC-01": "no", "DAT-01": "partial" }) }), cfg, TODAY);
  assert.equal(f.find(x => x.questionId === "ACC-01").severity, "High");
  assert.equal(f.find(x => x.questionId === "DAT-01").severity, "Medium");
});
test("findings: standard No and Partial are Medium", () => {
  const f = E.generateFindings(vendor({ answers: answers({ "GOV-02": "no", "GOV-03": "partial" }) }), cfg, TODAY);
  assert.deepEqual(f.map(x => x.severity), ["Medium", "Medium"]);
});
test("findings: Yes, N/A, and unanswered create no findings", () => {
  const f = E.generateFindings(vendor({ answers: answers({ "GOV-01": "yes", "GOV-02": "na" }) }), cfg, TODAY);
  assert.equal(f.length, 0);
});
test("findings: sorted High first", () => {
  const f = E.generateFindings(vendor({ answers: answers({ "GOV-02": "no", "ACC-01": "no" }) }), cfg, TODAY);
  assert.equal(f[0].severity, "High");
});
test("findings: due date defaults to assessment date plus the severity SLA", () => {
  const f = E.generateFindings(vendor({ lastAssessed: "2026-09-01", answers: answers({ "ACC-01": "no" }) }), cfg, TODAY)[0];
  assert.equal(f.openedAt, "2026-09-01");
  assert.equal(f.due, E.addDays("2026-09-01", cfg.remediationSlaDays.High));
  assert.equal(f.overdue, true);
  assert.equal(f.daysOverdue, E.daysBetween(f.due, TODAY));
});
test("findings: stored owner, status, and due date are kept", () => {
  const v = vendor({ answers: answers({ "ACC-01": "no" }), findings: { "v1:ACC-01": { owner: "J. Rivera", status: "in_progress", due: "2026-12-01" } } });
  const f = E.generateFindings(v, cfg, TODAY)[0];
  assert.equal(f.owner, "J. Rivera");
  assert.equal(f.status, "in_progress");
  assert.equal(f.open, true);
  assert.equal(f.overdue, false);
});
test("findings: remediated and accepted findings are not open", () => {
  const v = vendor({ answers: answers({ "ACC-01": "no", "GOV-02": "no" }), findings: {
    "v1:ACC-01": { status: "remediated" },
    "v1:GOV-02": { status: "accepted", accept: { justification: "Compensating control", approver: "CISO", expiry: "2027-03-01" } }
  } });
  const f = E.generateFindings(v, cfg, TODAY);
  assert.ok(f.every(x => !x.open));
  assert.ok(f.every(x => !x.overdue));
});
test("findings: an expired risk acceptance reopens the finding", () => {
  const v = vendor({ answers: answers({ "GOV-02": "no" }), findings: { "v1:GOV-02": { status: "accepted", accept: { expiry: "2026-09-30" } } } });
  const f = E.generateFindings(v, cfg, TODAY)[0];
  assert.equal(f.acceptanceExpired, true);
  assert.equal(f.open, true);
});
test("findings: aging buckets", () => {
  assert.equal(E.agingBucket(0, cfg), "0 to 30 days");
  assert.equal(E.agingBucket(30, cfg), "0 to 30 days");
  assert.equal(E.agingBucket(31, cfg), "31 to 60 days");
  assert.equal(E.agingBucket(90, cfg), "61 to 90 days");
  assert.equal(E.agingBucket(91, cfg), "90+ days");
});

/* ---------- residual risk ---------- */
test("residual: matrix lookup by tier and control band", () => {
  assert.equal(E.residualRisk(2, E.controlBand(75, cfg), [], cfg).level, "Medium");
  assert.equal(E.residualRisk(1, E.controlBand(40, cfg), [], cfg).level, "Critical");
  assert.equal(E.residualRisk(4, E.controlBand(90, cfg), [], cfg).level, "Low");
});
test("residual: an open High finding floors Tier 1 and 2 at High", () => {
  const high = [{ severity: "High", open: true, status: "open" }];
  const r = E.residualRisk(2, E.controlBand(95, cfg), high, cfg);
  assert.equal(r.base, "Low");
  assert.equal(r.level, "High");
  assert.equal(r.floored, true);
});
test("residual: accepted High findings and Tier 3 vendors are not floored", () => {
  const accepted = [{ severity: "High", open: false, status: "accepted" }];
  assert.equal(E.residualRisk(2, E.controlBand(95, cfg), accepted, cfg).level, "Low");
  const high = [{ severity: "High", open: true, status: "open" }];
  assert.equal(E.residualRisk(3, E.controlBand(95, cfg), high, cfg).level, "Low");
});

/* ---------- evidence expiry ---------- */
test("expiry: expired, expiring, current, and none", () => {
  assert.equal(E.evidenceState("2026-10-09", TODAY, cfg).state, "expired");
  assert.equal(E.evidenceState(TODAY, TODAY, cfg).state, "expiring");
  assert.equal(E.evidenceState(E.addDays(TODAY, 90), TODAY, cfg).state, "expiring");
  assert.equal(E.evidenceState(E.addDays(TODAY, 91), TODAY, cfg).state, "current");
  assert.equal(E.evidenceState("", TODAY, cfg).state, "none");
});
test("expiry: expired evidence on a Yes answer creates a Low finding", () => {
  const v = vendor({ answers: { "CMP-01": { a: "yes", exp: "2026-08-01" } } });
  const f = E.generateFindings(v, cfg, TODAY);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "Low");
  assert.equal(f[0].kind, "expired_evidence");
});
test("expiry: evidence alerts are reported per vendor", () => {
  const v = vendor({ answers: { "CMP-01": { a: "yes", exp: E.addDays(TODAY, 45) }, "CMP-03": { a: "yes", exp: E.addDays(TODAY, 200) } } });
  const r = E.evaluateVendor(v, cfg, TODAY);
  assert.deepEqual(r.evidence.map(e => e.state).sort(), ["current", "expiring"]);
});
test("expiry: contract renewals inside the window are flagged", () => {
  assert.equal(E.evaluateVendor(vendor({ renewal: E.addDays(TODAY, 30) }), cfg, TODAY).renewal.upcoming, true);
  assert.equal(E.evaluateVendor(vendor({ renewal: E.addDays(TODAY, 120) }), cfg, TODAY).renewal.upcoming, false);
});

/* ---------- reassessment and priority ---------- */
test("reassessment: due date follows tier cadence", () => {
  const v = vendor({ access: "privileged", dataTypes: ["personal"], lastAssessed: "2025-09-10" });
  const r = E.evaluateVendor(v, cfg, TODAY);
  assert.equal(r.reassessment.due, "2026-09-10");
  assert.equal(r.reassessment.status, "overdue");
  assert.equal(r.reassessment.daysOverdue, 30);
});
test("reassessment: never-assessed vendors are due now", () => {
  const r = E.evaluateVendor(vendor({ lastAssessed: "" }), cfg, TODAY);
  assert.equal(r.reassessment.status, "never");
  assert.equal(r.reassessment.due, TODAY);
});
test("priority: residual risk and months overdue both raise the score", () => {
  const p = (lvl, days) => E.priorityScore(lvl, { daysOverdue: days }, cfg).score;
  assert.ok(p("Critical", 0) > p("High", 0));
  assert.ok(p("Medium", 300) > p("Medium", 0));
  assert.equal(p("High", 30 * 100), p("High", 30 * cfg.priority.monthsCap), "overdue months are capped");
  assert.equal(p("Low", -30 * 100), p("Low", 30 * cfg.priority.monthsFloor), "not-yet-due months are floored");
});
test("priority: portfolio ranking puts the riskiest, most overdue vendor first", () => {
  const all = {}; cfg.questions.forEach(q => { all[q.id] = { a: "yes" }; });
  const weak = {}; cfg.questions.forEach(q => { weak[q.id] = { a: "no" }; });
  const good = vendor({ id: "a", name: "A", dataTypes: ["personal"], answers: all, lastAssessed: "2026-08-01" });
  const bad = vendor({ id: "b", name: "B", dataTypes: ["personal"], answers: weak, lastAssessed: "2024-01-01" });
  const { ranked } = E.evaluatePortfolio([good, bad], cfg, TODAY);
  assert.equal(ranked[0].vendor.id, "b");
});

/* ---------- dates and CSV ---------- */
test("dates: month math clamps to month end", () => {
  assert.equal(E.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(E.addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(E.addMonths("2026-10-10", 12), "2027-10-10");
});
test("csv: quotes commas, quotes, and newlines", () => {
  assert.equal(E.toCSV([["a", "b,c", 'd"e', "f\ng"]]), 'a,"b,c","d""e","f\ng"');
});
