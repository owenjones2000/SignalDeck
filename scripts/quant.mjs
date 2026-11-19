import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function pythonPath(platform = process.platform) {
  return resolve(root, "quant", ".venv", platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

export function commands(action, env = process.env, platform = process.platform) {
  const python = pythonPath(platform);
  const quant = resolve(root, "quant");
  if (action === "setup") {
    return [
      [env.PYTHON ?? (platform === "win32" ? "python" : "python3"), ["-m", "venv", resolve(quant, ".venv")]],
      [python, ["-m", "pip", "install", "-r", resolve(quant, "requirements.lock")]],
      [python, ["-m", "pip", "install", "--no-deps", "-e", quant]],
    ];
  }
  if (action === "dev") return [[python, ["-m", "signaldeck_quant"]]];
  if (action === "test") return [[python, ["-m", "pytest", quant]]];
  throw new Error(`未知 quant 命令：${action}`);
}

async function run(action) {
  if (action !== "setup" && !existsSync(pythonPath())) {
    throw new Error("quant 虚拟环境不存在，请先执行 npm run setup:quant");
  }
  for (const [program, args] of commands(action)) {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(program, args, { cwd: root, stdio: "inherit" });
      const forward = (signal) => child.kill(signal);
      const interrupt = () => forward("SIGINT");
      const terminate = () => forward("SIGTERM");
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
      const cleanup = () => {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", terminate);
      };
      child.once("error", (error) => { cleanup(); reject(error); });
      child.once("exit", (code, signal) => {
        cleanup();
        if (signal) {
          process.exitCode = signal === "SIGINT" ? 130 : 143;
          reject(new Error(`quant 进程已停止：${signal}`));
        } else if (code !== 0) {
          process.exitCode = code ?? 1;
          reject(new Error(`quant 命令执行失败，退出码：${code}`));
        } else resolvePromise();
      });
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode ??= 1;
  });
}
