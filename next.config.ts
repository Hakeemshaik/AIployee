import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs is a large CommonJS package that reads workbooks with Node APIs.
  // Leaving it external keeps it out of the bundler and out of any client
  // graph it might otherwise be pulled into.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
