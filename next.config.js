/** @type {import('next').NextConfig} */
function isCloudOrNetworkSyncedWorkspace(cwd) {
  const n = String(cwd).replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("/library/cloudstorage/") ||
    n.includes("google drive") ||
    n.includes("/dropbox/") ||
    n.includes("/onedrive/") ||
    n.includes("/library/mobile documents/")
  );
}

const pollDev =
  process.env.BEEPER_CRM_DEV_POLLING === "1" ||
  isCloudOrNetworkSyncedWorkspace(process.cwd());

const nextConfig = {
  serverExternalPackages: ["pino", "pino-pretty", "better-sqlite3"],
  // Satisfy Next.js 16 when a dev-only webpack hook is present (cloud-sync polling).
  turbopack: {},
  // Allow opening the dev app from local network URLs.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.178.191",
  ],
  ...(pollDev
    ? {
        webpack: (config, ctx) => {
          if (ctx.dev) {
            config.watchOptions = {
              ...(config.watchOptions ?? {}),
              poll: 1000,
              aggregateTimeout: 500,
            };
          }
          return config;
        },
      }
    : {}),
};

module.exports = nextConfig;
