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
