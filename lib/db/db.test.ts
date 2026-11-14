import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { closeDb, db, tx } from "./index";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-db-")), "hermit.db");
const TABLES = ["shells", "roomgraphs", "runs", "conversations", "messages", "saved", "designs", "regulation_findings"];

describe("db", () => {
  it("migrates an empty database once", () => {
    process.env.HERMIT_DB = tmp();
    closeDb();
    db();
    const d = db();
    expect((d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    const names = (d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(TABLES));
  });

  it("survives concurrent writers", () => {
    const file = tmp();
    process.env.HERMIT_DB = file;
    closeDb();
    const d = db();
    d.prepare("INSERT INTO conversations (id, viewer_id, created_at, updated_at, state_json) VALUES ('c1','v','t','t','{}')").run();
    const other = new DatabaseSync(file);
    other.exec("PRAGMA busy_timeout=3000");
    const insert = (h: DatabaseSync, base: number) => {
      const stmt = h.prepare("INSERT INTO messages (id, conversation_id, seq, role, kind, payload_json, created_at) VALUES (?, 'c1', ?, 'user', 'text', '{}', 't')");
      for (let i = 0; i < 200; i++) stmt.run(`m${base + i}`, base + i);
    };
    tx(() => insert(d, 0));
    other.exec("BEGIN IMMEDIATE");
    insert(other, 1000);
    other.exec("COMMIT");
    expect((d.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }).n).toBe(400);
    other.close();
  });

  it("rolls back a failed transaction", () => {
    process.env.HERMIT_DB = tmp();
    closeDb();
    expect(() => tx(() => {
      db().prepare("INSERT INTO runs (id, created_at, spec_json, events_json) VALUES ('r1','t','{}','[]')").run();
      throw new Error("nope");
    })).toThrow("nope");
    expect(db().prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 0 });
  });
});
