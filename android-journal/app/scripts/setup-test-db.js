/**
 * Integration Test Database Setup
 *
 * Creates the test database, pushes the Prisma schema,
 * and applies the manual tsvector migration.
 *
 * Usage: node scripts/setup-test-db.js
 * Requires: Docker postgres running (docker compose up -d db)
 */

const { execSync } = require("child_process");
const { readFileSync } = require("fs");
const { resolve } = require("path");
const pg = require("pg");

const BASE_URL = "postgresql://journal:journal_dev@localhost:5432";
const TEST_DB = "claude_journal_test";
const TEST_URL = `${BASE_URL}/${TEST_DB}`;

async function main() {
  // 1. Create test database if it doesn't exist
  const admin = new pg.Client(`${BASE_URL}/postgres`);
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`Created database "${TEST_DB}"`);
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log(`Database "${TEST_DB}" already exists`);
    } else {
      throw e;
    }
  }
  await admin.end();

  // 2. Push Prisma schema (syncs tables without migration history)
  console.log("Pushing Prisma schema...");
  execSync("npx prisma db push --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "inherit",
  });

  // 3. Apply manual tsvector migration
  console.log("Applying tsvector migration...");
  const client = new pg.Client(TEST_URL);
  await client.connect();
  const sql = readFileSync(
    resolve(__dirname, "../prisma/migrations/manual/001_search_vector.sql"),
    "utf-8",
  );
  await client.query(sql);
  await client.end();

  console.log("Test database ready.");
}

main().catch((e) => {
  console.error("Setup failed:", e.message);
  process.exit(1);
});
