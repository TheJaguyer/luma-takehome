import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // process.env rather than env(): `prisma generate` runs at image build time, with no database.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
