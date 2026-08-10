import { DefaultSession, DefaultUser } from 'next-auth';
import type { OnboardingStep } from '@/lib/onboarding';

export type SessionAppRole = 'OWNER' | 'VENDOR';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: SessionAppRole;
      roleSelected: boolean;
      /** Server-derived onboarding state (from roleSelected). */
      onboardingStep: OnboardingStep;
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
  }
}

declare module 'next-auth/adapters' {
  interface AdapterUser {
    role?: string;
    roleSelected?: boolean;
  }
}
