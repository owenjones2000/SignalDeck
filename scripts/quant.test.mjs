import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { commands, pythonPath, root } from "./quant.mjs";

test("setup uses the locked dependencies before installing the local package without resolution", () => {
  const steps = commands("setup", { PYTHON: "/usr/local/bin/python3.13" }, "darwin");
  assert.equal(steps[0][0], "/usr/local/bin/python3.13");
  assert.deepEqual(steps[0][1], ["-m", "venv", resolve(root, "quant/.venv")]);
  assert.deepEqual(steps[1], [pythonPath("darwin"), ["-m", "pip", "install", "-r", resolve(root, "quant/requirements.lock")]]);
  assert.deepEqual(steps[2][1], ["-m", "pip", "install", "--no-deps", "-e", resolve(root, "quant")]);
});

test("dev and test use the virtual environment without requiring shell activation", () => {
  assert.deepEqual(commands("dev", {}, "darwin"), [[pythonPath("darwin"), ["-m", "signaldeck_quant"]]]);
  assert.deepEqual(commands("test", {}, "win32"), [[pythonPath("win32"), ["-m", "pytest", resolve(root, "quant")]]]);
  assert.throws(() => commands("unknown"), /未知 quant 命令/);
});
