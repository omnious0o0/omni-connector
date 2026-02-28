import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DataStore } from "../src/store";

test(
  "rejects permissive data encryption key file permissions",
  { skip: process.platform === "win32" },
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-store-key-mode-"));

    try {
      const dataFilePath = path.join(directory, "store.json");
      const keyPath = `${dataFilePath}.key`;
      fs.writeFileSync(keyPath, crypto.randomBytes(32).toString("base64url"), {
        encoding: "utf8",
        mode: 0o644,
      });
      fs.chmodSync(keyPath, 0o644);

      assert.throws(
        () => new DataStore(dataFilePath),
        /Data encryption key file .* must be owner-readable and not accessible by group or others/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("accepts owner-only data encryption key file permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-store-key-private-"));

  try {
    const dataFilePath = path.join(directory, "store.json");
    const keyPath = `${dataFilePath}.key`;
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString("base64url"), {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") {
      fs.chmodSync(keyPath, 0o600);
    }

    const store = new DataStore(dataFilePath);
    const state = store.read();
    assert.match(state.connector.apiKey, /^omni-/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
