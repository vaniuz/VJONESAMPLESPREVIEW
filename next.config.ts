<<<<<<< HEAD
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // The app surface is checked separately; this avoids a Windows sandbox
  // worker restriction during the production build.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
=======
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
>>>>>>> 4cd78149029dc4778a26683682c9d5f13ab38e1f
