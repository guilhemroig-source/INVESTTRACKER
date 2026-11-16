import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@tracker/core"],
  serverExternalPackages: ["better-sqlite3"],
};
export default config;
