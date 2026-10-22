import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tcs/shared-types'],
  // Standalone tracing needs symlinks — enabled in the Docker build only
  // (Windows dev hosts may not have the symlink privilege).
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  webpack: (config) => {
    // Workspace packages use ESM ".js" import specifiers for ".ts" sources.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
