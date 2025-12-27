import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to add COOP/COEP headers for WASM support.
 * Required for WASM modules compiled with shared memory features.
 */
export function middleware(request: NextRequest) {
  // Log to verify middleware is running (check terminal, not browser)
  console.log('[Middleware] Processing:', request.nextUrl.pathname);
  
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
