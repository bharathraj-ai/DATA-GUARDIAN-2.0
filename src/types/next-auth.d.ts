import { DefaultSession, DefaultUser } from 'next-auth';

export type SessionAppRole = 'OWNER' | 'VENDOR';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: SessionAppRole;
      roleSelected: boolean;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    role?: string;
  }
}

declare module 'next-auth/adapters' {
  interface AdapterUser {
    role?: string;
  }
}
