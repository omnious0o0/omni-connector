import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

interface VerificationLaunchHarness {
  statusNode: { textContent: string | null };
  openCalls: Array<{ url: string; target: string; features: string }>;
  replaceCalls: string[];
  popupRef: { closed: boolean } | null;
  run: () => void;
  flushNextTimer: () => void;
}

function createVerificationLaunchHarness(options: {
  verificationUrl?: string;
  returnPath?: string;
  popupBehavior: "open" | "blocked";
}): VerificationLaunchHarness {
  const statusNode = { textContent: null as string | null };
  const openCalls: Array<{ url: string; target: string; features: string }> = [];
  const replaceCalls: string[] = [];
  const timerQueue: Array<() => void> = [];
  const popupRef = options.popupBehavior === "open" ? { closed: false } : null;

  const documentStub = {
    body: {
      dataset: {
        verificationUrl: options.verificationUrl ?? "",
        returnPath: options.returnPath ?? "/",
      },
    },
    getElementById: (id: string) => (id === "verification-status" ? statusNode : null),
  };

  const windowStub = {
    location: {
      origin: "https://connector.local",
      replace: (value: string) => {
        replaceCalls.push(value);
      },
    },
    open: (url: string, target: string, features: string) => {
      openCalls.push({ url, target, features });
      return popupRef;
    },
    setTimeout: (callback: () => void) => {
      timerQueue.push(callback);
      return timerQueue.length;
    },
  };

  const context = vm.createContext({
    document: documentStub,
    window: windowStub,
    URL,
  });

  const scriptPath = path.join(process.cwd(), "public", "verification-launch.js");
  const scriptSource = fs.readFileSync(scriptPath, "utf8");

  return {
    statusNode,
    openCalls,
    replaceCalls,
    popupRef,
    run: () => {
      vm.runInContext(scriptSource, context, { filename: scriptPath });
    },
    flushNextTimer: () => {
      const callback = timerQueue.shift();
      assert.ok(callback);
      callback();
    },
  };
}

test("verification launch script shows unavailable message when URL is missing", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "",
    returnPath: "/verification/complete?state=missing",
    popupBehavior: "blocked",
  });

  harness.run();

  assert.equal(
    harness.statusNode.textContent,
    "Verification URL is unavailable. Return to omni-connector and retry.",
  );
  assert.equal(harness.openCalls.length, 0);
  assert.deepEqual(harness.replaceCalls, []);
});

test("verification launch script shows popup-blocked guidance", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "https://accounts.example.com/verify?ticket=abc",
    returnPath: "/verification/complete?state=popup-blocked",
    popupBehavior: "blocked",
  });

  harness.run();

  assert.equal(harness.openCalls.length, 1);
  assert.deepEqual(harness.openCalls[0], {
    url: "https://accounts.example.com/verify?ticket=abc",
    target: "omni-connector-verification",
    features: "noopener,noreferrer",
  });
  assert.equal(
    harness.statusNode.textContent,
    "Popup was blocked. Open the verification page, finish it, then return here.",
  );
  assert.deepEqual(harness.replaceCalls, []);
});

test("verification launch script redirects after popup closes", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "https://accounts.example.com/verify?ticket=abc",
    returnPath: "/verification/complete?state=abc#done",
    popupBehavior: "open",
  });

  harness.run();

  assert.equal(harness.openCalls.length, 1);
  assert.deepEqual(harness.replaceCalls, []);
  assert.ok(harness.popupRef);
  harness.popupRef.closed = true;
  harness.flushNextTimer();
  assert.deepEqual(harness.replaceCalls, ["/verification/complete?state=abc#done"]);
});

test("verification launch script sanitizes cross-origin return path", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "https://accounts.example.com/verify?ticket=abc",
    returnPath: "https://evil.example/steal",
    popupBehavior: "open",
  });

  harness.run();

  assert.ok(harness.popupRef);
  harness.popupRef.closed = true;
  harness.flushNextTimer();
  assert.deepEqual(harness.replaceCalls, ["/"]);
});

test("verification launch script sanitizes javascript return path", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "https://accounts.example.com/verify?ticket=abc",
    returnPath: "javascript:alert(1)",
    popupBehavior: "open",
  });

  harness.run();

  assert.ok(harness.popupRef);
  harness.popupRef.closed = true;
  harness.flushNextTimer();
  assert.deepEqual(harness.replaceCalls, ["/"]);
});

test("verification launch script normalizes same-origin absolute return URL", () => {
  const harness = createVerificationLaunchHarness({
    verificationUrl: "https://accounts.example.com/verify?ticket=abc",
    returnPath: "https://connector.local/verification/complete?state=xyz#hash",
    popupBehavior: "open",
  });

  harness.run();

  assert.ok(harness.popupRef);
  harness.popupRef.closed = true;
  harness.flushNextTimer();
  assert.deepEqual(harness.replaceCalls, ["/verification/complete?state=xyz#hash"]);
});
