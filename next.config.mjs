import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(36);
}

function readFileSafe(relPath) {
  try {
    return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  } catch {
    return '';
  }
}

const helpSources = [
  'src/components/HelpModal.tsx',
  'src/components/HelpModal.module.css',
  'src/components/helpContent.ts',
];

const HELP_MENU_HASH = hashString(helpSources.map(readFileSafe).join('\n'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser requires client-side only rendering
  transpilePackages: ['phaser'],
  // Disable source maps in production for better performance
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_HELP_MENU_HASH: HELP_MENU_HASH,
  },
  
  // Configure webpack for WASM
  webpack: (config, { isServer }) => {
    // Don't process WASM files through webpack - they need to be loaded
    // manually to preserve shared memory features
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    
    // Don't bundle WASM on server side
    if (isServer) {
      config.externals = [...(config.externals || []), /\.wasm$/];
    }
    
    return config;
  },
  
  // Headers for WASM (cross-origin isolation required for shared memory features)
  // Using 'require-corp' for maximum browser compatibility
  // Note: External resources need CORS headers or crossorigin attribute
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
