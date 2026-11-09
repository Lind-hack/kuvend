import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Start Kuvend when you log in, quietly in the background (no window to keep open). Phone access and
// server copies come back on by themselves. Windows: a tiny launcher in the Startup folder. macOS: a
// LaunchAgent. Linux desktops: an autostart entry.

type Opts = { bin?: string; platform?: NodeJS.Platform };

// This install's own bin/kuvend.mjs (dist/server/autostart.js -> ../../bin).
const ownBin = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/kuvend.mjs");

function target(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const dir = process.env.KUVEND_STARTUP_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    return path.join(dir, "Kuvend.vbs");
  }
  if (platform === "darwin") return path.join(process.env.KUVEND_STARTUP_DIR ?? path.join(os.homedir(), "Library", "LaunchAgents"), "dev.kuvend.plist");
  return path.join(process.env.KUVEND_STARTUP_DIR ?? path.join(os.homedir(), ".config", "autostart"), "kuvend.desktop");
}

export const autostartOn = (o: Opts = {}) => fs.existsSync(target(o.platform ?? process.platform));

export function setAutostart(on: boolean, o: Opts = {}): string {
  const platform = o.platform ?? process.platform;
  const file = target(platform);
  if (!on) {
    fs.rmSync(file, { force: true });
    return file;
  }
  const bin = o.bin ?? ownBin();
  // npx keeps packages in a cache it may clear: starting from there would break one day.
  if (/[\\/]_npx[\\/]/.test(bin)) throw new Error("Install Kuvend first, so it can start on its own: npm i -g kuvend. Then turn this on again.");
  const node = process.execPath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (platform === "win32") {
    const q = (s: string) => `""${s}""`;
    fs.writeFileSync(file, `' Starts Kuvend in the background when you log in. Delete this file (or turn it off in Kuvend) to stop.\r\nCreateObject("WScript.Shell").Run "${q(node)} ${q(bin)} --no-open", 0, False\r\n`);
  } else if (platform === "darwin") {
    fs.writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>dev.kuvend</string>\n<key>ProgramArguments</key><array><string>${node}</string><string>${bin}</string><string>--no-open</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`,
    );
  } else {
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Kuvend\nExec="${node}" "${bin}" --no-open\nX-GNOME-Autostart-enabled=true\n`);
  }
  return file;
}
