import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const logFile = join(dataDir, "watchdog.log");
const FATAL_BIND = 2;
const DELAY_MS = 1200;

mkdirSync(dataDir, { recursive: true });

let child = null;
let stopping = false;

function stamp() {
  return new Date().toISOString();
}

function log(line) {
  try {
    appendFileSync(logFile, stamp() + " " + line + "\n");
  } catch {
    /* keep quiet */
  }
}

function start() {
  if (stopping) return;
  child = spawn(process.execPath, [join(root, "server", "index.js")], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"]
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    if (code === 0) process.exit(0);
    if (code === FATAL_BIND) process.exit(FATAL_BIND);
    log("reinicio code=" + String(code) + " signal=" + String(signal || ""));
    setTimeout(start, DELAY_MS);
  });
}

function stop() {
  stopping = true;
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

log("inicio");
start();
