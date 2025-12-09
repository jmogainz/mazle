/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser requires client-side only rendering
  transpilePackages: ['phaser'],
  // Disable source maps in production for better performance
  productionBrowserSourceMaps: false,
  
  // Configure webpack for WASM with threads (SharedArrayBuffer)
  webpack: (config, { isServer }) => {
    // Don't process WASM files through webpack - they need to be loaded
    // manually to preserve SharedArrayBuffer support for threading
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
  
  // Headers for WASM threads (SharedArrayBuffer requires cross-origin isolation)
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
