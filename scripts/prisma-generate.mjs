import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import "dotenv/config";

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required to introspect the database.");
  process.exit(1);
}

mkdirSync("prisma", { recursive: true });
writeFileSync(
  "prisma/schema.prisma",
  `generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
`,
);

function run(args) {
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["db", "pull"]);
run(["generate"]);
