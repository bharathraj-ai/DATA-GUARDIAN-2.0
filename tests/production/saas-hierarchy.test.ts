/**
 * SaaS hierarchy + plan limit contracts.
 */

import {
  normalizeRole,
  canCreateSecureLinks,
  dashboardPathForRole,
  SELF_SERVICE_ROLES,
  roleDisplayName,
} from '@/lib/security/role-helpers';
import { limitsForPlan, normalizePlan, PLAN_LIMITS } from '@/lib/plans';
import { isMarketingPath } from '@/lib/marketing-paths';

describe('role ladder', () => {
  it('self-serve roles are team leader and vendor only', () => {
    expect(SELF_SERVICE_ROLES).toEqual(['OWNER', 'VENDOR']);
  });

  it('routes each role to the correct dashboard', () => {
    expect(dashboardPathForRole('OWNER')).toBe('/dashboard/owner');
    expect(dashboardPathForRole('VENDOR')).toBe('/dashboard/vendor');
  });

  it('display names are human-readable', () => {
    expect(roleDisplayName('OWNER')).toBe('Owner');
  });

  it('only team leaders create links', () => {
    expect(canCreateSecureLinks(normalizeRole('OWNER'))).toBe(true);
  });
});

describe('plan limits', () => {
  it('defaults unknown plans to FREE', () => {
    expect(normalizePlan('nope')).toBe('FREE');
    expect(limitsForPlan(undefined).id).toBe('FREE');
  });

  it('FREE is stricter than TEAM and ENTERPRISE', () => {
    expect(PLAN_LIMITS.FREE.maxActiveLinks).toBeLessThan(PLAN_LIMITS.TEAM.maxActiveLinks);
    expect(PLAN_LIMITS.TEAM.maxTotalBytesPerLink).toBeLessThanOrEqual(
      PLAN_LIMITS.ENTERPRISE.maxTotalBytesPerLink,
    );
  });
});

describe('marketing paths include SaaS pages', () => {
  it('treats help docs status as marketing', () => {
    expect(isMarketingPath('/help')).toBe(true);
    expect(isMarketingPath('/docs')).toBe(true);
    expect(isMarketingPath('/status')).toBe(true);
  });
});

describe('saas source contracts', () => {
  it('create-link gates on plan limits helper', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/actions/create-link-with-files.ts'),
      'utf8',
    );
    expect(src).toMatch(/resolvePlanLimitsForUser/);
    expect(src).toMatch(/maxActiveLinks/);
    expect(src).toMatch(/Only team leaders can create/);
  });

  it('schema has Organization.plan and OrganizationInvite', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const schema = await fs.readFile(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/plan\s+String\s+@default\("FREE"\)/);
    expect(schema).toMatch(/model OrganizationInvite/);
    expect(schema).toMatch(/managerUserId/);
  });
});
