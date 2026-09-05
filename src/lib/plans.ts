/**
 * Plan limits for Free / Team / Enterprise.
 * Solo team leaders without an org use FREE defaults.
 */

export const PLAN_IDS = ['FREE', 'TEAM', 'ENTERPRISE'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanLimits = {
  id: PlanId;
  label: string;
  maxFilesPerLink: number;
  maxTotalBytesPerLink: number;
  maxActiveLinks: number;
  maxRetentionDays: number;
  priceLabel: string;
  blurb: string;
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  FREE: {
    id: 'FREE',
    label: 'Free',
    maxFilesPerLink: 10,
    maxTotalBytesPerLink: 50 * 1024 * 1024,
    maxActiveLinks: 3,
    maxRetentionDays: 7,
    priceLabel: '$0',
    blurb: 'Solo team leaders and small handoffs.',
  },
  TEAM: {
    id: 'TEAM',
    label: 'Team',
    maxFilesPerLink: 50,
    maxTotalBytesPerLink: 100 * 1024 * 1024,
    maxActiveLinks: 25,
    maxRetentionDays: 30,
    priceLabel: 'Contact sales',
    blurb: 'Company workspaces with managers and team leaders.',
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    label: 'Enterprise',
    maxFilesPerLink: 100,
    maxTotalBytesPerLink: 500 * 1024 * 1024,
    maxActiveLinks: 200,
    maxRetentionDays: 90,
    priceLabel: 'Contact sales',
    blurb: 'Domain SSO, higher caps, and priority support.',
  },
};

export function normalizePlan(plan: string | null | undefined): PlanId {
  const p = (plan || 'FREE').toUpperCase();
  if ((PLAN_IDS as readonly string[]).includes(p)) return p as PlanId;
  return 'FREE';
}

export function limitsForPlan(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[normalizePlan(plan)];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
