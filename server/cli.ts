import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stopAll } from "./runapp.js";
import { createServer } from "./server.js";
import { accessToken } from "./store.js";

// `kuvend [folder] [--port 4777] [--no-open]`: start the local server and open it in your browser.

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(`kuvend [folder] [--port 4777] [--no-open]

Opens a workspace for Claude Code and Codex in your browser.
  folder      start a session in this project
  --port      the local port (default 4777)
  --no-open   don't open the browser`);
  process.exit(0);
}

const port = Number(value("--port") ?? process.env.KUVEND_PORT ?? 4777);
const folderArg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--port");
const project = folderArg ? path.resolve(folderArg) : undefined;
if (project && !fs.existsSync(project)) {
  console.error(`No such folder: ${project}`);
  process.exit(1);
}

function open(url: string) {
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url.replace(/&/g, "^&")]);
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

const server = createServer(port);
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Is Kuvend already running? Or use --port 4778.` : e.message);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/${project ? `?project=${encodeURIComponent(project)}` : ""}#token=${accessToken()}`;
  console.log(`\n  Kuvend is running.\n\n  ${url}\n\n  Keep this window open. Ctrl+C stops it.\n`);
  if (!flag("--no-open")) open(url);
});

const quit = () => {
  stopAll();
  process.exit(0);
};
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
