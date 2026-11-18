/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

describe("local workstation launch contract", () => {
  test("runner is designed to require SQLite and a non-placeholder local auth secret", async () => {
    const source = await Bun.file("scripts/local/local-workstation.ts").text();
    expect(source).toContain('dbUrl.startsWith("file:")');
    expect(source).toContain("secret.length < 32");
    expect(source).toContain('NEXTAUTH_URL=http://127.0.0.1:3000');
  });

  test("runner binds the application to loopback and starts the polling supervisor", async () => {
    const source = await Bun.file("scripts/local/local-workstation.ts").text();
    expect(source).toContain('"--hostname"');
    expect(source).toContain('"127.0.0.1"');
    expect(source).toContain('"scripts/market-data/local-supervisor.ts"');
    expect(source).toContain('"EXPERIMENTAL_DUKASCOPY_POLLING"');
    expect(source).toContain("ordersEnabled: false");
  });

  test("runner uses the non-destructive Prisma schema push command", async () => {
    const source = await Bun.file("scripts/local/local-workstation.ts").text();
    expect(source).toContain('"db:push:safe"');
    expect(source).not.toContain('"db:push"');
  });
});
