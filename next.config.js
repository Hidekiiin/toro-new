/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    ABLY_API_KEY: process.env.ABLY_API_KEY,
  },
}

module.exports = nextConfig
