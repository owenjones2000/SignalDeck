import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { root } from "./quant.mjs";

const compose = parse(
  readFileSync(resolve(root, "docker-compose.yml"), "utf8"),
);
const dockerfile = readFileSync(resolve(root, "quant/Dockerfile"), "utf8");

test("the distributed quant image includes the SDK license notice", () => {
  assert.match(
    dockerfile,
    /^COPY docs\/licenses\/longbridge-MIT\.txt \/usr\/share\/licenses\/longbridge\/LICENSE-MIT$/m,
  );
  const ignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
  assert.match(ignore, /^!docs\/licenses\/longbridge-MIT\.txt$/m);
  const license = readFileSync(
    resolve(root, "docs/licenses/longbridge-MIT.txt"),
    "utf8",
  );
  assert.ok(license.includes("Permission is hereby granted, free of charge"));
  assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
});

test("Compose forwards the three LONGPORT credentials only to quant with empty defaults", () => {
  for (const key of [
    "LONGPORT_APP_KEY",
    "LONGPORT_APP_SECRET",
    "LONGPORT_ACCESS_TOKEN",
  ]) {
    assert.ok(
      compose.services.quant.environment.includes(`${key}=\${${key}:-}`),
    );
    for (const name of ["api", "web"]) {
      assert.ok(
        compose.services[name].environment.every(
          (entry) => !entry.startsWith(`${key}=`),
        ),
      );
    }
    assert.ok(!JSON.stringify(compose.services.quant.build).includes(key));
  }
});

test("the environment example keeps SDK opt-in and credentials blank", () => {
  const example = readFileSync(resolve(root, ".env.example"), "utf8");
  assert.match(example, /^INSTALL_LONGBRIDGE=false$/m);
  for (const key of [
    "LONGPORT_APP_KEY",
    "LONGPORT_APP_SECRET",
    "LONGPORT_ACCESS_TOKEN",
  ]) {
    assert.match(example, new RegExp(`^${key}=$`, "m"));
  }
});

test("Compose leaves SDK installation disabled unless explicitly enabled", () => {
  assert.deepEqual(compose.services.quant.build.args, {
    INSTALL_LONGBRIDGE: "${INSTALL_LONGBRIDGE:-false}",
  });
  assert.match(dockerfile, /^ARG INSTALL_LONGBRIDGE=false$/m);
  assert.doesNotMatch(
    readFileSync(resolve(root, "quant/requirements.lock"), "utf8"),
    /^longbridge[=<>]/m,
  );
});

test("the image build switch installs only SDK 5.4.0 and rejects invalid values", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "signaldeck-build-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = resolve(directory, "pip.log");
  writeFileSync(
    resolve(directory, "pip"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\nexit "${PIP_EXIT:-0}"\n',
    { mode: 0o755 },
  );
  const instruction = dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .find(
      (line) => line.startsWith("RUN ") && line.includes("INSTALL_LONGBRIDGE"),
    );
  assert.ok(
    instruction,
    "Dockerfile must provide an optional SDK install instruction",
  );
  for (const value of ["false", "0", "true", "1", "invalid"]) {
    writeFileSync(log, "");
    const result = spawnSync("/bin/sh", ["-c", instruction.slice(4)], {
      env: {
        PATH: `${directory}:/usr/bin:/bin`,
        COMMAND_LOG: log,
        INSTALL_LONGBRIDGE: value,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, value === "invalid" ? 1 : 0, result.stderr);
    assert.equal(
      readFileSync(log, "utf8"),
      ["true", "1"].includes(value)
        ? "install --no-cache-dir --no-deps longbridge==5.4.0\n"
        : "",
    );
  }
  const failure = spawnSync("/bin/sh", ["-c", instruction.slice(4)], {
    env: {
      PATH: `${directory}:/usr/bin:/bin`,
      COMMAND_LOG: log,
      INSTALL_LONGBRIDGE: "true",
      PIP_EXIT: "23",
    },
  });
  assert.equal(failure.status, 23);
});
