// The check before you save (commit): things people regret pushing. It reads the staged diff only.

export type Warning = { level: "stop" | "check"; title: string; detail: string; file?: string };

const SECRETS: { name: string; re: RegExp }[] = [
  { name: "an OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: "an Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "a GitHub token", re: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/ },
  { name: "an AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "a Stripe secret key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "a private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "a Supabase service key", re: /service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,}/ },
  { name: "a password in a URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{6,}@/i },
];

const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/;
const SAFE_ENV = /\.env\.(example|sample|template)$/;

export function checkDiff(diff: string): Warning[] {
  const out: Warning[] = [];
  let file = "";
  let removed = 0;
  const removedBy = new Map<string, number>();
  const seen = new Set<string>();
  for (const line of diff.split("\n")) {
    const head = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (head) {
      file = head[2];
      if (ENV_FILE.test(file) && !SAFE_ENV.test(file)) out.push({ level: "stop", title: "An environment file is about to be saved", detail: `${file} usually holds passwords and keys. Add it to .gitignore instead.`, file });
      continue;
    }
    if (line.startsWith("deleted file mode")) out.push({ level: "check", title: "A file will be deleted", detail: file, file });
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      removedBy.set(file, (removedBy.get(file) ?? 0) + 1);
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const s of SECRETS) {
      if (s.re.test(line) && !seen.has(`${file}:${s.name}`)) {
        seen.add(`${file}:${s.name}`);
        out.push({ level: "stop", title: `This looks like ${s.name}`, detail: `In ${file}. Anyone who can see the repository could use it. Move it to an environment variable.`, file });
      }
    }
  }
  if (removed > 300) out.push({ level: "check", title: `${removed} lines removed`, detail: `Mostly in ${[...removedBy].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "several files"}. Make sure that was meant to happen.` });
  return out;
}
