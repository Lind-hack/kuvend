import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Start Kuvend when you log in, quietly in the background (no window to keep open). Phone access and
// server copies come back on by themselves. Windows: a tiny launcher in the Startup folder. macOS: a
// LaunchAgent. Linux desktops: an autostart entry.

// `serve`: start `kuvend serve` instead (a machine that stays on). On Linux that's a systemd user service,
// which runs at boot without anyone logging in (with lingering on) and comes back if it stops.
type Opts = { bin?: string; platform?: NodeJS.Platform; serve?: boolean };

// This install's own bin/kuvend.mjs (dist/server/autostart.js -> ../../bin).
const ownBin = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/kuvend.mjs");

const serviceFile = () => path.join(process.env.KUVEND_SYSTEMD_DIR ?? path.join(os.homedir(), ".config", "systemd", "user"), "kuvend.service");

function target(platform: NodeJS.Platform, serve = false): string {
  if (serve && platform === "linux") return serviceFile();
  if (platform === "win32") {
    const dir = process.env.KUVEND_STARTUP_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    return path.join(dir, "Kuvend.vbs");
  }
  if (platform === "darwin") return path.join(process.env.KUVEND_STARTUP_DIR ?? path.join(os.homedir(), "Library", "LaunchAgents"), "dev.kuvend.plist");
  return path.join(process.env.KUVEND_STARTUP_DIR ?? path.join(os.homedir(), ".config", "autostart"), "kuvend.desktop");
}

export const autostartOn = (o: Opts = {}) => {
  const platform = o.platform ?? process.platform;
  return fs.existsSync(target(platform)) || (platform === "linux" && fs.existsSync(serviceFile()));
};

export function setAutostart(on: boolean, o: Opts = {}): string {
  const platform = o.platform ?? process.platform;
  const file = target(platform, o.serve);
  if (!on) {
    fs.rmSync(target(platform), { force: true });
    if (platform === "linux") fs.rmSync(serviceFile(), { force: true });
    return file;
  }
  const bin = o.bin ?? ownBin();
  // npx keeps packages in a cache it may clear: starting from there would break one day.
  if (/[\\/]_npx[\\/]/.test(bin)) throw new Error("Install Kuvend first, so it can start on its own: npm i -g kuvend. Then turn this on again.");
  const node = process.execPath;
  const arg = o.serve ? "serve" : "--no-open";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (o.serve && platform === "linux") {
    // A service starts with a bare PATH: keep this shell's, so node, git, claude and codex (often under
    // ~/.nvm or ~/.npm-global) are found. % is systemd's escape character.
    const PATH = (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin").replace(/%/g, "%%");
    fs.writeFileSync(
      file,
      `# Kuvend on a machine that stays on. Written by: kuvend autostart on --serve\n[Unit]\nDescription=Kuvend, a workspace for Claude Code and Codex\nWants=network-online.target\nAfter=network-online.target tailscaled.service\n\n[Service]\nExecStart="${node}" "${bin}" serve\nEnvironment="PATH=${PATH}"\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`,
    );
  } else if (platform === "win32") {
    const q = (s: string) => `""${s}""`;
    fs.writeFileSync(file, `' Starts Kuvend in the background when you log in. Delete this file (or turn it off in Kuvend) to stop.\r\nCreateObject("WScript.Shell").Run "${q(node)} ${q(bin)} ${arg}", 0, False\r\n`);
  } else if (platform === "darwin") {
    fs.writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>dev.kuvend</string>\n<key>ProgramArguments</key><array><string>${node}</string><string>${bin}</string><string>${arg}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`,
    );
  } else {
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Kuvend\nExec="${node}" "${bin}" ${arg}\nX-GNOME-Autostart-enabled=true\n`);
  }
  return file;
}
