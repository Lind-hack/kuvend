// Development: rebuild the web app on change and restart the server on change.
import spawn from "cross-spawn";

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", env: { ...process.env, KUVEND_DEV: "1" } });
run("npx", ["vite", "build", "--watch", "--mode", "development"]);
run("npx", ["tsx", "watch", "server/cli.ts", "--no-open", ...process.argv.slice(2)]);
