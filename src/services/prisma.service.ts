import { PrismaClient } from "../generated/prisma/index.js";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config/index.js";

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

/**
 * Gets or creates the Prisma client instance
 * In production, this helps prevent too many connections
 */
export function getPrismaClient(): PrismaClient {
  if (!config.database.url) {
    throw new Error("DATABASE_URL is required");
  }
  if (!prisma) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 10,
      idleTimeoutMillis: 30_000, // close idle connections after 30s
      connectionTimeoutMillis: 10_000,
    });

    // Create the Prisma adapter
    const adapter = new PrismaPg(pool);

    // Create Prisma client with the adapter
    prisma = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });

    // Handle graceful shutdown
    process.on("beforeExit", async () => {
      await prisma?.$disconnect();
      await pool?.end();
    });
  }

  return prisma;
}

/**
 * Disconnect Prisma client (useful for testing or graceful shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}
