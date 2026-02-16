import { DefaultSession, DefaultUser } from 'next-auth';
import { AdapterUser } from 'next-auth/adapters';

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            role: 'OWNER' | 'VENDOR';
            roleSelected: boolean;
        } & DefaultSession['user'];
    }

    // Role is optional here since Prisma adapter creates users without it initially
    interface User extends DefaultUser {
        role?: 'OWNER' | 'VENDOR';
    }
}

declare module 'next-auth/adapters' {
    interface AdapterUser {
        role?: 'OWNER' | 'VENDOR';
    }
}
