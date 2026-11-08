import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stopRemote } from "./remote.js";
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

// A port you asked for is used or reported; the default moves up a few ports when it's taken.
const chosen = value("--port") ?? process.env.KUVEND_PORT;
const port = Number(chosen ?? 4777);
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

function listen(at: number, triesLeft: number) {
  const server = createServer(at);
  server.once("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE" && !chosen && triesLeft > 0) return listen(at + 1, triesLeft - 1);
    console.error(e.code === "EADDRINUSE" ? `Port ${at} is busy. Close the program using it, or start Kuvend with --port ${at + 1}.` : e.message);
    process.exit(1);
  });
  server.listen(at, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${at}/${project ? `?project=${encodeURIComponent(project)}` : ""}#token=${accessToken()}`;
    const moved = at !== port ? `  (Port ${port} was busy, so Kuvend is on ${at}.)\n\n` : "";
    console.log(`\n  Kuvend is running.\n\n${moved}  ${url}\n\n  Keep this window open. Ctrl+C stops it.\n`);
    if (!flag("--no-open")) open(url);
  });
}
listen(port, 10);

const quit = () => {
  stopAll();
  stopRemote(); // closes the phone route and lets the computer sleep again
  process.exit(0);
};
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
