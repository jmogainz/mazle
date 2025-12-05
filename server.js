/**
 * Custom Next.js dev server with COOP/COEP headers for SharedArrayBuffer.
 * 
 * USAGE:
 *   node server.js                    # HTTP on localhost:8080
 *   node server.js --https            # HTTPS on localhost:8080 (requires certs)
 *   node server.js -H 0.0.0.0 --https # HTTPS on all interfaces (for LAN)
 * 
 * HTTPS SETUP (for LAN access with WASM):
 *   1. Install mkcert: sudo pacman -S mkcert nss
 *   2. Create CA: mkcert -install
 *   3. Generate certs: mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 YOUR_LAN_IP
 *   4. Run: node server.js --https
 * 
 * WHY HTTPS FOR LAN?
 *   SharedArrayBuffer (required for WASM threads) only works on:
 *   - http://localhost (hostname must be exactly "localhost")
 *   - HTTPS origins (any hostname)
 *   
 *   So for LAN access (e.g., http://192.168.1.x:8080), you MUST use HTTPS.
 */
const { createServer: createHttpServer } = require('http');
const { createServer: createHttpsServer } = require('https');
const { parse } = require('url');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const next = require('next');

// Parse command line arguments
const args = process.argv.slice(2);
let hostname = process.env.HOSTNAME || '127.0.0.1';
let port = parseInt(process.env.PORT, 10) || 8080;
let useHttps = false;
let certFile = process.env.SSL_CERT || 'cert.pem';
let keyFile = process.env.SSL_KEY || 'key.pem';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--hostname' || args[i] === '-H') {
    hostname = args[i + 1];
    i++;
  } else if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--https' || args[i] === '-s') {
    useHttps = true;
  } else if (args[i] === '--cert') {
    certFile = args[i + 1];
    i++;
  } else if (args[i] === '--key') {
    keyFile = args[i + 1];
    i++;
  }
}

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Request handler with COOP/COEP headers
function requestHandler(req, res) {
  // Add COOP/COEP headers for SharedArrayBuffer support (WASM threads)
  // Using 'require-corp' instead of 'credentialless' for broader browser support
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  
  const parsedUrl = parse(req.url, true);
  handle(req, res, parsedUrl);
}

app.prepare().then(() => {
  let server;
  let protocol = 'http';
  
  if (useHttps) {
    const certPath = resolve(process.cwd(), certFile);
    const keyPath = resolve(process.cwd(), keyFile);
    
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      console.error('');
      console.error('  ❌ HTTPS certificates not found!');
      console.error('');
      console.error('  To generate certificates with mkcert:');
      console.error('    1. Install: sudo pacman -S mkcert nss');
      console.error('    2. Setup CA: mkcert -install');
      console.error('    3. Generate: mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 YOUR_LAN_IP');
      console.error('');
      console.error(`  Expected files: ${certPath}`);
      console.error(`                  ${keyPath}`);
      console.error('');
      process.exit(1);
    }
    
    const httpsOptions = {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    };
    
    server = createHttpsServer(httpsOptions, requestHandler);
    protocol = 'https';
  } else {
    server = createHttpServer(requestHandler);
  }
  
  // Listen on specified interface
  const listenArgs = hostname ? [port, hostname] : [port];
  server.listen(...listenArgs, (err) => {
    if (err) throw err;
    const displayHost = hostname || 'localhost';
    const url = `${protocol}://${displayHost}:${port}`;
    
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────────┐');
    console.log('  │                                                        │');
    console.log(`  │   Ready on ${url}`.padEnd(59) + '│');
    console.log('  │                                                        │');
    console.log('  │   ✓  COOP/COEP headers enabled for WASM threads       │');
    
    if (useHttps) {
      console.log('  │   ✓  HTTPS enabled - WASM works on any hostname       │');
      console.log('  │   ✓  LAN access supported                             │');
    } else {
      console.log('  │   ✓  Access via http://localhost:8080                 │');
      console.log('  │   ⚠️   IP addresses over HTTP won\'t work for WASM      │');
      console.log('  │                                                        │');
      console.log('  │   For LAN access, use: node server.js --https         │');
    }
    
    console.log('  │                                                        │');
    console.log('  └────────────────────────────────────────────────────────┘');
    console.log('');
  });
});
