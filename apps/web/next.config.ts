import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@ripcord/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
