/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser requires client-side only rendering
  transpilePackages: ['phaser'],
};

export default nextConfig;

