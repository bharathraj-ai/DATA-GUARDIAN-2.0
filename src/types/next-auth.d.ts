import { DefaultSession, DefaultUser } from 'next-auth';
import type { OnboardingStep } from '@/lib/onboarding';
import type { AppRole } from '@/lib/security/role-helpers';

export type SessionAppRole = AppRole;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: SessionAppRole;
      roleSelected: boolean;
      /** Server-derived onboarding state (from roleSelected). */
      onboardingStep: OnboardingStep;
      organizationId?: string | null;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    role?: string;
    roleSelected?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: SessionAppRole | string;
    roleSelected?: boolean;
    onboardingStep?: OnboardingStep;
    organizationId?: string | null;
  }
}

declare module 'next-auth/adapters' {
  interface AdapterUser {
    role?: string;
    roleSelected?: boolean;
  }
}
