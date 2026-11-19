#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const TEMPLATE = join(ROOT, ".env.example");
const TARGET = join(ROOT, ".env");

async function main(): Promise<void> {
  try {
    const existing = await readFile(TARGET, "utf8");
    if (existing.length > 0) {
      process.stdout.write("[AMI] .env already exists. It was not changed or overwritten.\n");
      process.stdout.write("[AMI] Check DATABASE_URL, NEXTAUTH_SECRET (32+ characters), and NEXTAUTH_URL=http://127.0.0.1:3000.\n");
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const template = await readFile(TEMPLATE, "utf8");
  const secret = randomBytes(32).toString("hex");
  const configured = template
    .replace(/^NEXTAUTH_SECRET=.*$/m, "NEXTAUTH_SECRET=" + secret)
    .replace(/^NEXTAUTH_URL=.*$/m, "NEXTAUTH_URL=http://127.0.0.1:3000");

  try {
    await writeFile(TARGET, configured, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      process.stdout.write("[AMI] .env was created by another setup process; existing file was left untouched.\n");
      return;
    }
    throw error;
  }

  process.stdout.write("[AMI] Created .env from .env.example and generated a private 256-bit NextAuth secret.\n");
  process.stdout.write("[AMI] The secret was not printed. Local SQLite uses the template's ../db/ami.db path.\n");
  process.stdout.write("[AMI] Next step: bun run local:station -- start\n");
}

await main();
