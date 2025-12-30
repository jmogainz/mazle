import NextAuth, { type NextAuthOptions } from 'next-auth';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import { upsertUserForOidcAccount } from '@/lib/server/users';
import { env } from '@/lib/server/env';

const envSecret = env('AUTH_SECRET') || env('NEXTAUTH_SECRET');
if (envSecret && !process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = envSecret;
}

const envUrl = env('AUTH_URL') || env('NEXTAUTH_URL');
if (envUrl && !process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = envUrl;
}

function applePrivateKey(): string | undefined {
  const raw = env('APPLE_PRIVATE_KEY');
  if (!raw) return undefined;
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

const providers = [];

if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) {
  providers.push(
    Google({
      clientId: env('GOOGLE_CLIENT_ID')!,
      clientSecret: env('GOOGLE_CLIENT_SECRET')!,
    })
  );
}

if (env('APPLE_CLIENT_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')) {
  providers.push(
    Apple({
      clientId: env('APPLE_CLIENT_ID')!,
      clientSecret: {
        appleId: env('APPLE_CLIENT_ID')!,
        teamId: env('APPLE_TEAM_ID')!,
        privateKey: applePrivateKey()!,
        keyId: env('APPLE_KEY_ID')!,
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  secret: envSecret,
  session: {
    strategy: 'jwt',
    maxAge: 10 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  callbacks: {
    jwt: async ({ token, account, user }) => {
      if (account?.provider && account.providerAccountId) {
        const userId = await upsertUserForOidcAccount({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          email: token.email ?? user?.email ?? null,
          name: (token.name as string | undefined) ?? (user?.name ?? null),
          imageUrl: (token.picture as string | undefined) ?? (user?.image ?? null),
        });
        token.userId = userId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.userId) {
        session.user.id = token.userId;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
