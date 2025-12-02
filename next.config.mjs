/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser requires client-side only rendering
  transpilePackages: ['phaser'],
  // Disable source maps in production for better performance
  productionBrowserSourceMaps: false,
};

export default nextConfig;

