/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser requires client-side only rendering
  transpilePackages: ['phaser'],
  // Disable source maps in production for better performance
  productionBrowserSourceMaps: false,
  // Enable WebAssembly support
  webpack: (config, { isServer }) => {
    // Enable WASM
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    
    // Don't bundle WASM on server side
    if (isServer) {
      config.externals = [...(config.externals || []), /\.wasm$/];
    }
    
    return config;
  },
};

export default nextConfig;

