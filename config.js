/*
 * Vouch rules configuration.
 *
 * Every rule the tool applies lives in this file: inherent risk tiering, reassessment
 * cadence, the questionnaire and its weights, control rating bands, the residual risk
 * matrix, finding severity, remediation SLAs, and alert windows. Change a value here
 * and the whole app (and the tests) follow it. Nothing below is hard-coded elsewhere.
 *
 * Works as a plain browser script (sets window.VOUCH_CONFIG) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VOUCH_CONFIG = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- intake options ---------- */
  const dataTypes = [
    { id: "none", label: "None" },
    { id: "internal", label: "Internal business data" },
    { id: "personal", label: "Personal data (PII)" },
    { id: "financial", label: "Financial or payment data" },
    { id: "health", label: "Health data (PHI)" }
  ];
  const accessLevels = [
    { id: "none", label: "No system access" },
    { id: "read", label: "Read-only access" },
    { id: "privileged", label: "Privileged or admin access" }
  ];

  /* ---------- inherent risk tiering ----------
   * Each rule lists conditions that must ALL be true. A vendor gets the most severe
   * tier among every rule it matches, and the matching rules at that tier are shown
   * as the reason. Vendors that match nothing fall to the default tier.
   * Supported conditions:
   *   dataAny: [ids]       vendor shares at least one of these data types
   *   access: [ids]        vendor's access level is one of these
   *   criticalityMin: n    operational criticality is n or higher
   *   subprocessor: true   vendor is a subprocessor
   */
  const tiers = [
    { tier: 1, label: "Critical", reassessMonths: 12 },
    { tier: 2, label: "High", reassessMonths: 18 },
    { tier: 3, label: "Moderate", reassessMonths: 24 },
    { tier: 4, label: "Low", reassessMonths: 36 }
  ];
  const tierRules = [
    { tier: 1, when: { access: ["privileged"], dataAny: ["personal", "financial", "health"] }, reason: "Privileged access to systems holding sensitive data" },
    { tier: 1, when: { criticalityMin: 5 }, reason: "Operations stop if this vendor fails (criticality 5)" },
    { tier: 1, when: { dataAny: ["financial", "health"], criticalityMin: 4 }, reason: "Regulated data combined with high operational criticality" },
    { tier: 2, when: { dataAny: ["personal", "financial", "health"] }, reason: "Handles personal, financial, or health data" },
    { tier: 2, when: { access: ["privileged"] }, reason: "Privileged or admin access to company systems" },
    { tier: 2, when: { criticalityMin: 4 }, reason: "High operational criticality (4 or 5)" },
    { tier: 3, when: { dataAny: ["internal"] }, reason: "Handles internal business data" },
    { tier: 3, when: { access: ["read"] }, reason: "Read-only access to company systems" },
    { tier: 3, when: { criticalityMin: 3 }, reason: "Moderate operational criticality (3)" },
    { tier: 3, when: { subprocessor: true }, reason: "Acts as a subprocessor for customer data" }
  ];
  const defaultTier = { tier: 4, reason: "No sensitive data, no system access, and low criticality" };

  /* ---------- questionnaire ----------
   * weight: 1 (baseline), 2 (important), 3 (core control)
   * critical: a No answer creates a High finding
   * expires: evidence for this question carries an expiry date (reports, certificates)
   */
  const domains = [
    { id: "gov", name: "Governance", csf: "GV.PO, GV.RR, GV.SC-05", iso: "A.5.19" },
    { id: "acc", name: "Access control", csf: "PR.AA, GV.SC-05", iso: "A.5.20" },
    { id: "dat", name: "Data protection", csf: "PR.DS, GV.SC-05, GV.SC-10", iso: "A.5.20" },
    { id: "inc", name: "Incident response", csf: "RS.MA, GV.SC-08", iso: "A.5.20, A.5.22" },
    { id: "bcp", name: "Business continuity", csf: "RC.RP, GV.SC-08", iso: "A.5.20" },
    { id: "dev", name: "Secure development", csf: "PR.PS-06, GV.SC-05", iso: "A.5.20, A.5.21" },
    { id: "sub", name: "Subcontractor management", csf: "GV.SC-07", iso: "A.5.21" },
    { id: "cmp", name: "Compliance and certifications", csf: "GV.SC-07, ID.IM-01", iso: "A.5.22" }
  ];
  const questions = [
    { id: "GOV-01", d: "gov", w: 3, critical: true, q: "Does the vendor maintain a written information security program approved by leadership?", ev: "Security program charter or policy set with approval" },
    { id: "GOV-02", d: "gov", w: 2, critical: false, q: "Is a named individual accountable for information security?", ev: "Org chart or role description" },
    { id: "GOV-03", d: "gov", w: 2, critical: false, q: "Are security policies reviewed and reapproved at least annually?", ev: "Policy version history" },
    { id: "GOV-04", d: "gov", w: 2, critical: false, q: "Does the vendor perform a formal risk assessment at least annually?", ev: "Risk assessment summary or register extract" },
    { id: "GOV-05", d: "gov", w: 1, critical: false, q: "Do all personnel complete security awareness training at hire and annually?", ev: "Training completion report" },

    { id: "ACC-01", d: "acc", w: 3, critical: true, q: "Is multi-factor authentication required for all access to systems that hold your data?", ev: "MFA policy configuration screenshot" },
    { id: "ACC-02", d: "acc", w: 3, critical: false, q: "Is access granted on least privilege and approved before provisioning?", ev: "Access control policy and sample approvals" },
    { id: "ACC-03", d: "acc", w: 2, critical: false, q: "Are user access rights reviewed at least quarterly for privileged accounts and annually for others?", ev: "Completed access review" },
    { id: "ACC-04", d: "acc", w: 2, critical: false, q: "Is access removed within one business day of termination?", ev: "Offboarding procedure and sample" },
    { id: "ACC-05", d: "acc", w: 2, critical: false, q: "Are privileged sessions logged and monitored?", ev: "PAM or logging configuration" },

    { id: "DAT-01", d: "dat", w: 3, critical: true, q: "Is your data encrypted at rest using industry standard algorithms?", ev: "Encryption configuration or architecture document" },
    { id: "DAT-02", d: "dat", w: 3, critical: true, q: "Is your data encrypted in transit over public networks (TLS 1.2 or higher)?", ev: "TLS configuration or scan result" },
    { id: "DAT-03", d: "dat", w: 2, critical: false, q: "Is your data logically segregated from other customers' data?", ev: "Architecture description" },
    { id: "DAT-04", d: "dat", w: 2, critical: false, q: "Is your data returned or securely destroyed at contract end, with confirmation?", ev: "Data disposal procedure or certificate" },
    { id: "DAT-05", d: "dat", w: 1, critical: false, q: "Does the vendor document where your data is stored and processed geographically?", ev: "Data location statement" },

    { id: "INC-01", d: "inc", w: 3, critical: true, q: "Does the vendor maintain a documented and tested incident response plan?", ev: "Incident response plan and last test date" },
    { id: "INC-02", d: "inc", w: 3, critical: true, q: "Will the vendor notify you of incidents affecting your data within 72 hours?", ev: "Contract clause or notification policy" },
    { id: "INC-03", d: "inc", w: 2, critical: false, q: "Are security events monitored and alerted on continuously?", ev: "Monitoring tool overview" },
    { id: "INC-04", d: "inc", w: 1, critical: false, q: "Are post-incident reviews performed and lessons learned tracked?", ev: "Sample post-incident review" },

    { id: "BCP-01", d: "bcp", w: 3, critical: false, q: "Does the vendor maintain a business continuity and disaster recovery plan covering your services?", ev: "BC/DR plan summary" },
    { id: "BCP-02", d: "bcp", w: 2, critical: false, q: "Has the recovery plan been tested in the last 12 months?", ev: "DR test report", expires: true },
    { id: "BCP-03", d: "bcp", w: 2, critical: false, q: "Are backups encrypted, stored separately, and restore-tested?", ev: "Backup configuration and restore test" },
    { id: "BCP-04", d: "bcp", w: 1, critical: false, q: "Are recovery time and recovery point objectives defined and shared with you?", ev: "RTO and RPO statement" },

    { id: "DEV-01", d: "dev", w: 2, critical: false, q: "Does the vendor follow a documented secure development life cycle?", ev: "SDLC policy" },
    { id: "DEV-02", d: "dev", w: 2, critical: false, q: "Is code peer reviewed and scanned for vulnerabilities before release?", ev: "Pipeline configuration or sample pull request" },
    { id: "DEV-03", d: "dev", w: 3, critical: true, q: "Has an independent penetration test been performed in the last 12 months, with findings remediated?", ev: "Pen test executive summary", expires: true },
    { id: "DEV-04", d: "dev", w: 2, critical: false, q: "Are critical vulnerabilities patched within 30 days?", ev: "Vulnerability management SLA and metrics" },

    { id: "SUB-01", d: "sub", w: 2, critical: false, q: "Does the vendor maintain an inventory of subcontractors that access your data?", ev: "Subprocessor list" },
    { id: "SUB-02", d: "sub", w: 2, critical: false, q: "Are subcontractors assessed for security before onboarding and periodically after?", ev: "Vendor management procedure" },
    { id: "SUB-03", d: "sub", w: 2, critical: false, q: "Do subcontractor contracts carry security obligations equivalent to the vendor's own?", ev: "Template flow-down clause" },
    { id: "SUB-04", d: "sub", w: 1, critical: false, q: "Will the vendor notify you before adding a subcontractor that accesses your data?", ev: "Contract clause or notification policy" },

    { id: "CMP-01", d: "cmp", w: 3, critical: false, q: "Does the vendor hold a current independent attestation (SOC 2 Type II or ISO 27001 certificate)?", ev: "SOC 2 Type II report or ISO 27001 certificate", expires: true },
    { id: "CMP-02", d: "cmp", w: 2, critical: false, q: "Were exceptions or nonconformities in the last attestation remediated?", ev: "Management response or corrective action plan" },
    { id: "CMP-03", d: "cmp", w: 1, critical: false, q: "Does the vendor carry cyber liability insurance?", ev: "Certificate of insurance", expires: true },
    { id: "CMP-04", d: "cmp", w: 2, critical: false, q: "Does the vendor comply with laws and regulations that apply to the data you share?", ev: "Compliance statement or relevant attestations" }
  ];

  /* ---------- scoring ---------- */
  const answerValues = { yes: 1, partial: 0.5, no: 0 }; // "na" and unanswered are excluded
  const controlBands = [ // first band whose min the score meets, checked top down
    { id: "strong", label: "Strong", min: 85 },
    { id: "adequate", label: "Adequate", min: 70 },
    { id: "weak", label: "Weak", min: 50 },
    { id: "deficient", label: "Deficient", min: 0 }
  ];
  const residualLevels = ["Low", "Medium", "High", "Critical"]; // ordered least to most severe
  const residualMatrix = { // inherent tier x control band
    1: { strong: "Medium", adequate: "High", weak: "Critical", deficient: "Critical" },
    2: { strong: "Low", adequate: "Medium", weak: "High", deficient: "Critical" },
    3: { strong: "Low", adequate: "Low", weak: "Medium", deficient: "High" },
    4: { strong: "Low", adequate: "Low", weak: "Low", deficient: "Medium" }
  };
  // An open (not remediated, not accepted) High finding on a Tier 1 or 2 vendor keeps
  // residual risk at or above this level, no matter how good the overall score is.
  const highFindingFloor = { tiers: [1, 2], level: "High" };

  /* ---------- findings ---------- */
  const findingSeverity = {
    critical: { no: "High", partial: "Medium" },
    standard: { no: "Medium", partial: "Medium" },
    expiredEvidence: "Low"
  };
  const severityOrder = ["Low", "Medium", "High"];
  const remediationSlaDays = { High: 30, Medium: 90, Low: 180 };
  const findingStatuses = [
    { id: "open", label: "Open" },
    { id: "in_progress", label: "In progress" },
    { id: "remediated", label: "Remediated" },
    { id: "accepted", label: "Risk accepted" }
  ];
  const agingBuckets = [
    { label: "0 to 30 days", max: 30 },
    { label: "31 to 60 days", max: 60 },
    { label: "61 to 90 days", max: 90 },
    { label: "90+ days", max: Infinity }
  ];

  /* ---------- evidence and alerts ---------- */
  const evidenceStatuses = [
    { id: "provided", label: "Provided" },
    { id: "requested", label: "Requested" },
    { id: "not_provided", label: "Not provided" }
  ];
  const alertWindows = { evidenceExpiringDays: 90, renewalDays: 90 };

  /* ---------- reassessment priority ----------
   * priority = residual points + (months overdue x points per month)
   * Months overdue can be negative (not yet due) down to the floor.
   */
  const priority = {
    residualPoints: { Critical: 40, High: 30, Medium: 20, Low: 10, "Not assessed": 25 },
    pointsPerMonthOverdue: 2,
    monthsFloor: -12,
    monthsCap: 24
  };

  return {
    version: "1.0",
    dataTypes, accessLevels, tiers, tierRules, defaultTier,
    domains, questions, answerValues, controlBands, residualLevels, residualMatrix, highFindingFloor,
    findingSeverity, severityOrder, remediationSlaDays, findingStatuses, agingBuckets,
    evidenceStatuses, alertWindows, priority
  };
});
