import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const exeSuffix = process.platform === "win32" ? ".exe" : "";

function fail(message) {
  console.error(`build-sidecar: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const label = [command, ...args].join(" ");
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    fail(`failed to run \`${label}\`: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`\`${label}\` exited with code ${result.status ?? "signal"}`);
  }
}

function hostTriple() {
  const result = spawnSync("rustc", ["-vV"], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail("failed to run `rustc -vV` to detect the host target triple");
  }
  const line = result.stdout
    .split("\n")
    .find((l) => l.startsWith("host:"));
  if (!line) {
    fail("could not parse the host target triple from `rustc -vV` output");
  }
  return line.slice("host:".length).trim();
}

const profile = dev ? "debug" : "release";
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const cross = triple !== hostTriple();
const buildArgs = [
  "build",
  ...(dev ? [] : ["--release"]),
  "-p",
  "beholder-mcp",
  ...(cross ? ["--target", triple] : []),
];
run("cargo", buildArgs);

const source = join(
  root,
  "target",
  ...(cross ? [triple] : []),
  profile,
  `beholder-mcp${exeSuffix}`,
);
if (!existsSync(source)) {
  fail(`built binary not found at ${source}`);
}

const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, `beholder-mcp-${triple}${exeSuffix}`);
copyFileSync(source, dest);
console.log(`build-sidecar: wrote ${dest}`);
