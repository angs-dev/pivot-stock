import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const migrationPath = path.join(root, "prisma", "migrations", "20260824143000_init", "migration.sql");

if (!fs.existsSync(migrationPath)) {
  throw new Error(`Migration SQL not found at ${migrationPath}`);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const existing = execFileSync("sqlite3", [
  dbPath,
  "SELECT name FROM sqlite_master WHERE type='table' AND name='Stock';"
]).toString();

if (existing.trim() === "Stock") {
  console.log("SQLite database already has the scanner schema.");
} else {
  execFileSync("sqlite3", [dbPath, `.read ${migrationPath}`], { stdio: "inherit" });
  console.log("SQLite database schema applied.");
}
