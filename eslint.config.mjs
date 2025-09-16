// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  // Next.js + TS presets (via compat)
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Ignores
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },

  // 1) Forbid raw Prisma client imports everywhere by default
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@/lib/db/prisma",
            message:
              "Don't import the raw Prisma client. Use '@/lib/db/system' (systemDb) for pre-tenant work, or prismaForTenant() elsewhere.",
          },
        ],
        // Also catch relative imports to the same file
        patterns: [
          {
            group: ["**/lib/db/prisma"],
            message:
              "Don't import the raw Prisma client. Use '@/lib/db/system' (systemDb) for pre-tenant work, or prismaForTenant() elsewhere.",
          },
        ],
      }],
    },
  },

  // 2) Allow raw Prisma ONLY in these places
  {
    files: [
      "src/lib/db/system.ts",
      "prisma/seed.ts",
      "scripts/**/*.{ts,tsx,js}",
      "src/app/api/auth/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
