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

  // 1) Default: forbid direct @prisma/client imports & new PrismaClient()
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      "no-restricted-imports": ["error", {
        // ⬇️ forbid runtime imports from @prisma/client…
        paths: ["@prisma/client"],
        // ⬇️ …but allow `import type { Prisma } from "@prisma/client"`
        allowTypeImports: true
      }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message: "Do not call `new PrismaClient()`. Use the shared singleton.",
        },
      ],
    },
  },

  // 2) Allow direct PrismaClient ONLY in the singleton module (and optionally scripts)
  {
    files: [
      "src/lib/db/prisma.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },

  // 3) (Optional) If you want to keep raw clients in standalone scripts, allow there:
  {
    files: [
      "scripts/**/*.{ts,tsx,js,mjs,cjs}",
      "prisma/seed.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
];
