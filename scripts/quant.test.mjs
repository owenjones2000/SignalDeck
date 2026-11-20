import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { commands, pythonPath, root } from "./quant.mjs";

test("setup uses the locked dependencies before installing the local package without resolution", () => {
  const steps = commands(
    "setup",
    { PYTHON: "/usr/local/bin/python3.13" },
    "darwin",
  );
  assert.equal(steps[0][0], "/usr/local/bin/python3.13");
  assert.deepEqual(steps[0][1], ["-m", "venv", resolve(root, "quant/.venv")]);
  assert.deepEqual(steps[1], [
    pythonPath("darwin"),
    ["-m", "pip", "install", "-r", resolve(root, "quant/requirements.lock")],
  ]);
  assert.deepEqual(steps[2][1], [
    "-m",
    "pip",
    "install",
    "--no-deps",
    "-e",
    resolve(root, "quant"),
  ]);
});

test("dev and test use the virtual environment without requiring shell activation", () => {
  assert.deepEqual(commands("dev", {}, "darwin"), [
    [pythonPath("darwin"), ["-m", "signaldeck_quant"]],
  ]);
  assert.deepEqual(commands("test", {}, "win32"), [
    [pythonPath("win32"), ["-m", "pytest", resolve(root, "quant")]],
  ]);
  assert.throws(() => commands("unknown"), /未知 quant 命令/);
});

test("setup-longbridge installs SDK 5.4.0 after the standard locked setup on both platforms", () => {
  for (const platform of ["darwin", "win32"]) {
    const steps = commands("setup-longbridge", {}, platform);
    assert.deepEqual(steps.slice(0, 3), commands("setup", {}, platform));
    assert.deepEqual(steps[3], [
      pythonPath(platform),
      ["-m", "pip", "install", "--no-deps", "longbridge==5.4.0"],
    ]);
    assert.equal(steps.length, 4);
  }
});

test("setup:longbridge works without an existing venv and propagates installation failures", (t) => {
  const directory = realpathSync(
    mkdtempSync(resolve(tmpdir(), "signaldeck-setup-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(resolve(directory, "scripts"));
  copyFileSync(
    resolve(root, "scripts/quant.mjs"),
    resolve(directory, "scripts/quant.mjs"),
  );
  const scripts = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ).scripts;
  assert.equal(
    scripts["setup:longbridge"],
    "node scripts/quant.mjs setup-longbridge",
  );
  const fakePython = resolve(directory, "python");
  const log = resolve(directory, "commands.jsonl");
  writeFileSync(
    fakePython,
    `#!${process.execPath}
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(args) + "\\n");
if (args[1] === "venv") {
  const python = resolve(args[2], "bin/python");
  mkdirSync(dirname(python), { recursive: true });
  copyFileSync(process.argv[1], python);
}
if (args.includes(process.env.FAIL_PACKAGE)) process.exit(23);
`,
    { mode: 0o755 },
  );
  const env = { PATH: "/usr/bin:/bin", PYTHON: fakePython, COMMAND_LOG: log };
  const success = spawnSync(
    process.execPath,
    [resolve(directory, "scripts/quant.mjs"), "setup-longbridge"],
    {
      env,
      encoding: "utf8",
    },
  );
  assert.equal(success.status, 0, success.stderr);
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], [
    "-m",
    "pip",
    "install",
    "--no-deps",
    "longbridge==5.4.0",
  ]);
  const failure = spawnSync(
    process.execPath,
    [resolve(directory, "scripts/quant.mjs"), "setup-longbridge"],
    {
      env: { ...env, FAIL_PACKAGE: "longbridge==5.4.0" },
      encoding: "utf8",
    },
  );
  assert.equal(failure.status, 23);
  assert.match(failure.stderr, /退出码：23/);
  const earlyFailure = spawnSync(
    process.execPath,
    [resolve(directory, "scripts/quant.mjs"), "setup-longbridge"],
    {
      env: { ...env, FAIL_PACKAGE: "venv" },
      encoding: "utf8",
    },
  );
  assert.equal(earlyFailure.status, 23);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 9);
});
