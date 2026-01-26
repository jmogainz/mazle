import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to add COOP/COEP headers for WASM support.
 * Required for WASM modules compiled with shared memory features.
 */
export function middleware(request: NextRequest) {
  // Log to verify middleware is running (check terminal, not browser)
  console.log('[Middleware] Processing:', request.nextUrl.pathname);

  // Password gate for internal admin pages and APIs (HTTP Basic Auth).
  // Configure via Vercel env var: ADMIN_SECRET.
  // - If ADMIN_SECRET contains "user:pass", that pair is required.
  // - Otherwise username is "admin" and password is ADMIN_SECRET.
  const pathname = request.nextUrl.pathname;
  const needsAdminAuth = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (needsAdminAuth) {
    const secret = process.env.ADMIN_SECRET;
    const isProd = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENV === 'prod';
    // Dev convenience: allow unauthenticated access when ADMIN_SECRET is unset in non-prod.
    if ((!secret || secret.trim().length === 0) && !isProd) {
      // Continue.
    } else if (!secret || secret.trim().length === 0) {
      const res = new NextResponse('Admin auth is not configured (missing ADMIN_SECRET).', { status: 401 });
      res.headers.set('WWW-Authenticate', 'Basic realm="Mazle Admin"');
      res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      res.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      return res;
    }

    if (secret && secret.trim().length > 0) {
      const expected = secret.includes(':') ? secret : `admin:${secret}`;
      const authHeader = request.headers.get('authorization') ?? '';
      const encoded = authHeader.startsWith('Basic ') ? authHeader.slice('Basic '.length).trim() : '';
      let decoded = '';
      try {
        decoded = encoded ? atob(encoded) : '';
      } catch {
        decoded = '';
      }
      if (decoded !== expected) {
        const res = new NextResponse('Unauthorized', { status: 401 });
        res.headers.set('WWW-Authenticate', 'Basic realm="Mazle Admin"');
        res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        res.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        return res;
      }
    }
  }
  
  const response = NextResponse.next();
  const geoCountry =
    request.headers.get('x-vercel-ip-country') ||
    '';
  const existingCountry = request.cookies.get('geo_country')?.value;
  if (geoCountry && geoCountry !== existingCountry) {
    response.cookies.set('geo_country', geoCountry, {
      path: '/',
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  
  // Cross-Origin-Opener-Policy: same-origin
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  
  // Cross-Origin-Embedder-Policy: require-corp (stricter but better browser support)
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  
  return response;
}

// Match all paths
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
