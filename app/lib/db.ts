import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

// Prisma 7 requires an explicit driver adapter (no more implicit query
// engine binary for Postgres) — connection string lives in prisma.config.ts
// for Migrate, and here for the runtime client, both reading DATABASE_URL.
const adapter = new PrismaPg(process.env["DATABASE_URL"] as string);

declare global {
  var __prisma: PrismaClient | undefined;
}

// Singleton across Next.js hot-reloads in dev (a fresh client per reload
// would exhaust Postgres connections); a plain module-level singleton in
// production/relay, where there's no HMR to worry about.
export const db: PrismaClient =
  globalThis.__prisma ?? new PrismaClient({ adapter });

if (process.env["NODE_ENV"] !== "production") {
  globalThis.__prisma = db;
}
