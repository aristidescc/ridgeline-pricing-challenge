import type { ApprovalRules } from '../config/approval-rules.js';
import type { DraftLine, ReviewFlag } from '../common/domain.types.js';
import type { Approver } from '../reporting/reporting.repository.js';
import { round2 } from '../pricing/pricing.rules.js';

export type Tier = 'specialist_only' | 'regional_manager' | 'vp';

export interface RoutingInput {
  /** Unrounded effective discount; compared at 2 decimals (the value humans see). */
  effectiveDiscountPct: number;
  netCents: number;
  region: string;
}

export interface RoutingDecision {
  tier: Tier;
  /** Who approves after the specialist, backup already applied. null = specialist only. */
  approverId: string | null;
  /** The approver the policy names before any backup was applied. */
  primaryApproverId: string | null;
  flags: ReviewFlag[];
}

/**
 * Policy "Who must approve (after specialist review)":
 *  - "Effective discount 15% or less and net total under $25,000 → Quote specialist only"
 *  - "Effective discount over 15% up to 25%, or net total $25,000 or more → Regional manager"
 *  - "Effective discount over 25% → VP of Sales"
 */
export function determineTier(input: RoutingInput, rules: ApprovalRules): Tier {
  const pct = round2(input.effectiveDiscountPct);
  const t = rules.tiers;
  if (pct > t.regionalManagerMaxDiscountPct) return 'vp';
  if (
    pct > t.specialistMaxDiscountPct ||
    input.netCents >= t.approverNetTotalThresholdCents
  ) {
    return 'regional_manager';
  }
  return 'specialist_only';
}

/** Out-of-office ranges are inclusive calendar dates in the business timezone. */
export function isOutOfOffice(a: Approver, today: string): boolean {
  if (!a.outOfOfficeFrom) return false;
  const to = a.outOfOfficeTo ?? a.outOfOfficeFrom;
  return a.outOfOfficeFrom <= today && today <= to;
}

/**
 * Policy §7: "If the required approver is out of office today, route to their
 * backup_approver_id." D4: if the backup is also out, follow their backup (bounded by
 * backupMaxDepth); if the chain is exhausted, escalate to the VP and flag it.
 */
export function routeQuote(
  input: RoutingInput,
  rules: ApprovalRules,
  directory: Approver[],
  today: string,
): RoutingDecision {
  const tier = determineTier(input, rules);
  if (tier === 'specialist_only') {
    return { tier, approverId: null, primaryApproverId: null, flags: [] };
  }
  const flags: ReviewFlag[] = [];
  const byId = new Map(directory.map((a) => [a.approverId, a]));
  const vp = directory.find((a) => a.role === rules.roles.vp);

  const primary =
    tier === 'vp'
      ? vp
      : directory.find(
          (a) =>
            a.role === rules.roles.regionalManager && a.region === input.region,
        );
  if (!primary) {
    flags.push({
      line: null,
      reason: `no ${tier === 'vp' ? 'VP' : `regional manager for region ${input.region}`} configured; escalated to VP`,
    });
    return {
      tier,
      approverId: vp?.approverId ?? null,
      primaryApproverId: null,
      flags,
    };
  }

  let current: Approver = primary;
  const seen = new Set<string>([current.approverId]);
  for (let depth = 0; isOutOfOffice(current, today); depth++) {
    const next = current.backupApproverId
      ? byId.get(current.backupApproverId)
      : undefined;
    if (!next || depth >= rules.backupMaxDepth || seen.has(next.approverId)) {
      const escalate = vp && !isOutOfOffice(vp, today) ? vp : undefined;
      flags.push({
        line: null,
        reason: `approver ${primary.approverId} and backups unavailable; ${escalate ? `escalated to VP ${escalate.approverId}` : 'no available approver'}`,
      });
      return {
        tier,
        approverId: escalate?.approverId ?? null,
        primaryApproverId: primary.approverId,
        flags,
      };
    }
    seen.add(next.approverId);
    current = next;
  }
  return {
    tier,
    approverId: current.approverId,
    primaryApproverId: primary.approverId,
    flags,
  };
}

/** Policy §8: "Any line with extraction_confidence below 0.85" needs a specialist before routing. */
export function lowConfidenceFlags(
  lines: DraftLine[],
  threshold: number,
): ReviewFlag[] {
  return lines
    .filter((l) => l.extraction_confidence < threshold)
    .map((l) => ({
      line: l.line,
      reason: `extraction confidence ${l.extraction_confidence.toFixed(2)}`,
    }));
}
