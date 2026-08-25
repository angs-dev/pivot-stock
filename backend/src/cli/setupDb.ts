import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const migrationsDir = path.join(root, "prisma", "migrations");

if (!fs.existsSync(migrationsDir)) {
  throw new Error(`Migrations directory not found at ${migrationsDir}`);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

function sqlite(...commands: string[]): string {
  return execFileSync("sqlite3", ["-bail", dbPath, ...commands]).toString();
}

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => fs.existsSync(path.join(migrationsDir, name, "migration.sql")))
  .sort();

if (migrations.length === 0) {
  throw new Error(`No migration.sql files found under ${migrationsDir}`);
}

sqlite(
  'CREATE TABLE IF NOT EXISTS "_ScannerMigration" ("name" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL);'
);

const applied = new Set(
  sqlite('SELECT name FROM "_ScannerMigration";')
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
);

// Databases created before migration tracking existed already carry the initial
// schema, so adopt them instead of replaying the first migration over live tables.
const hasStockTable = sqlite("SELECT name FROM sqlite_master WHERE type='table' AND name='Stock';").trim() === "Stock";
if (hasStockTable && applied.size === 0) {
  sqlite(`INSERT INTO "_ScannerMigration" ("name", "appliedAt") VALUES ('${migrations[0]}', datetime('now'));`);
  applied.add(migrations[0]);
  console.log(`Adopted existing database; marked ${migrations[0]} as applied.`);
}

let appliedCount = 0;
for (const name of migrations) {
  if (applied.has(name)) continue;
  const file = path.join(migrationsDir, name, "migration.sql");
  execFileSync("sqlite3", ["-bail", dbPath, `.read '${file}'`], { stdio: "inherit" });
  sqlite(`INSERT INTO "_ScannerMigration" ("name", "appliedAt") VALUES ('${name}', datetime('now'));`);
  console.log(`Applied migration ${name}.`);
  appliedCount += 1;
}

console.log(
  appliedCount === 0
    ? "SQLite database is already up to date."
    : `SQLite database schema updated (${appliedCount} migration${appliedCount === 1 ? "" : "s"} applied).`
);
