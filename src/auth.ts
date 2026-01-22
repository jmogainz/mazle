import crypto from 'node:crypto';
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

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const APPLE_CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 180;

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function loadApplePrivateKey(): string | null {
  const raw = env('APPLE_PRIVATE_KEY');
  if (!raw) return null;
  return raw.replace(/\\n/g, '\n').trim();
}

function buildAppleClientSecret(): string | null {
  const directSecret = env('APPLE_CLIENT_SECRET');
  if (directSecret) return directSecret;

  const clientId = env('APPLE_CLIENT_ID');
  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const privateKey = loadApplePrivateKey();

  if (!clientId || !teamId || !keyId || !privateKey) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: teamId,
    iat: now,
    exp: now + APPLE_CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  };
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const payload = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto.sign('SHA256', Buffer.from(payload), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${payload}.${base64UrlEncode(signature)}`;
}

const providers = [];

if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) {
  providers.push(
    Google({
      clientId: env('GOOGLE_CLIENT_ID')!,
      clientSecret: env('GOOGLE_CLIENT_SECRET')!,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

// Apple requires a JWT client secret. We can build it from key material or accept a prebuilt one.
const appleClientId = env('APPLE_CLIENT_ID');
const appleClientSecret = buildAppleClientSecret();
if (appleClientId && appleClientSecret) {
  providers.push(
    Apple({
      clientId: appleClientId,
      clientSecret: appleClientSecret,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'name email',
          response_mode: 'form_post',
        },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  debug: true,
  providers,
  secret: envSecret,
  session: {
    strategy: 'jwt',
    maxAge: 10 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  // Cookie config for Apple's form_post: SameSite=None allows cross-site POST to send cookies
  cookies: {
    pkceCodeVerifier: {
      name: '__Secure-next-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'none',
        path: '/',
        secure: true,
      },
    },
    state: {
      name: '__Secure-next-auth.state',
      options: {
        httpOnly: true,
        sameSite: 'none',
        path: '/',
        secure: true,
      },
    },
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
