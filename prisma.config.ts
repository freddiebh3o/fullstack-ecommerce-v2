// prisma.config.ts
import "dotenv/config"; 
import { defineConfig } from "prisma/config";

export default defineConfig({
  // keep default schema path (./prisma/schema.prisma)
  migrations: {
    // tells `prisma db seed` how to run your seed script
    seed: "tsx prisma/seed.ts"
  }
});
