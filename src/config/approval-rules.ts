import { readFileSync } from 'node:fs';

/** DI token for the validated ApprovalRules. */
export const APPROVAL_RULES = Symbol('APPROVAL_RULES');

/** Approval policy as data (config/approval-rules.json). Validated at load; invalid config fails fast. */
export interface ApprovalRules {
  businessTimezone: string;
  tiers: {
    /** Policy: "Effective discount 15% or less and net total under $25,000 → Quote specialist only" */
    specialistMaxDiscountPct: number;
    /** Policy: "or net total $25,000 or more → Regional manager" */
    approverNetTotalThresholdCents: number;
    /** Policy: "Effective discount over 25% → VP of Sales" */
    regionalManagerMaxDiscountPct: number;
  };
  roles: { specialist: string; regionalManager: string; vp: string };
  lowConfidenceThreshold: number;
  stockMaxAgeHours: number;
  reportingMaxAgeHours: number;
  duplicateWindowHours: number;
  backupMaxDepth: number;
}

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Invalid approval rules: ${msg}`);
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isStr = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

export function validateApprovalRules(raw: unknown): ApprovalRules {
  const r = raw as ApprovalRules;
  req(typeof r === 'object' && r !== null, 'must be an object');
  req(isStr(r.businessTimezone), 'businessTimezone required');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: r.businessTimezone });
  } catch {
    req(false, `unknown timezone ${r.businessTimezone}`);
  }
  req(typeof r.tiers === 'object' && r.tiers !== null, 'tiers required');
  req(
    isNum(r.tiers.specialistMaxDiscountPct),
    'tiers.specialistMaxDiscountPct',
  );
  req(
    isNum(r.tiers.regionalManagerMaxDiscountPct),
    'tiers.regionalManagerMaxDiscountPct',
  );
  req(
    r.tiers.regionalManagerMaxDiscountPct >= r.tiers.specialistMaxDiscountPct,
    'regionalManagerMaxDiscountPct must be >= specialistMaxDiscountPct',
  );
  req(
    Number.isInteger(r.tiers.approverNetTotalThresholdCents) &&
      r.tiers.approverNetTotalThresholdCents > 0,
    'tiers.approverNetTotalThresholdCents must be a positive integer (cents)',
  );
  req(typeof r.roles === 'object' && r.roles !== null, 'roles required');
  req(
    isStr(r.roles.specialist) &&
      isStr(r.roles.regionalManager) &&
      isStr(r.roles.vp),
    'roles.specialist/regionalManager/vp required',
  );
  req(
    isNum(r.lowConfidenceThreshold) && r.lowConfidenceThreshold <= 1,
    'lowConfidenceThreshold must be in [0,1]',
  );
  req(isNum(r.stockMaxAgeHours), 'stockMaxAgeHours');
  req(isNum(r.reportingMaxAgeHours), 'reportingMaxAgeHours');
  req(isNum(r.duplicateWindowHours), 'duplicateWindowHours');
  req(
    Number.isInteger(r.backupMaxDepth) && r.backupMaxDepth >= 1,
    'backupMaxDepth must be an integer >= 1',
  );
  return r;
}

export function loadApprovalRules(path: string): ApprovalRules {
  return validateApprovalRules(JSON.parse(readFileSync(path, 'utf8')));
}
