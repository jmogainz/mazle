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

const providers = [];

if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) {
  providers.push(
    Google({
      clientId: env('GOOGLE_CLIENT_ID')!,
      clientSecret: env('GOOGLE_CLIENT_SECRET')!,
    })
  );
}

// NOTE: Apple provider expects a JWT client secret as a string (not a structured object).
// We keep this optional and off by default until Apple auth is enabled.
if (env('APPLE_CLIENT_ID') && env('APPLE_CLIENT_SECRET')) {
  providers.push(
    Apple({
      clientId: env('APPLE_CLIENT_ID')!,
      clientSecret: env('APPLE_CLIENT_SECRET')!,
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
