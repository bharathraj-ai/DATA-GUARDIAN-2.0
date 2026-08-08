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
    roleSelected?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: SessionAppRole | string;
    roleSelected?: boolean;
  }
}

declare module 'next-auth/adapters' {
  interface AdapterUser {
    role?: string;
    roleSelected?: boolean;
  }
}
