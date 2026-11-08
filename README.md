# Kuvend

A workspace for the coding agents you already have. Chat with **Claude Code** and **Codex** in your real project folder, see exactly which files each message changed, take any change back, run your app and hand its errors to the agent, have the other agent check the work, and save without leaking a key.

It runs on your computer and opens in your browser. No account, no cloud: Kuvend drives the `claude` and `codex` you've installed and signed in to, so it never sees your logins.

> *Kuvend* is Albanian for "assembly": your agents, in one room, checking each other's work.

## Start

You need Node.js 20 or newer, and at least one agent installed and signed in once:

```bash
npm install -g @anthropic-ai/claude-code   # then run: claude
npm install -g @openai/codex               # then run: codex login
```

Then, from anywhere:

```bash
npx kuvend                 # opens Kuvend in your browser
npx kuvend ./my-project    # opens straight into a project
```

Keep the terminal window open while you work. `Ctrl+C` stops Kuvend and any app it started.

## What you get

**Every message is a take.** Each message you send is recorded as a take: what you asked, what the agent did step by step, and the files it changed on disk as a list with lines added and removed. Click a file to see the change.

**Drop a take.** Didn't like it? *Drop this take* puts every file back exactly as it was before that message, byte for byte, and removes files it created. *Bring it back* undoes the undo. Kuvend snapshots your files before and after each take using git, under its own `refs/kuvend/` refs, so your branches, staging and history are never touched. A folder without git can turn this on with one click.

**A second listen.** After Claude makes a change, ask Codex to review it (or the other way round). The reviewer reads the change and your project but cannot edit anything, and reports real problems in plain words.

**Run it.** Kuvend finds how your project starts (`npm run dev`, `python app.py`, …), installs packages if needed, shows the output and the address it serves on. When an error appears, *Send this error to the agent* passes the relevant lines along as the next message.

**Save safely.** *Check before saving* looks at what would be committed: API keys (OpenAI, Anthropic, GitHub, AWS, Google, Stripe, Slack), private keys, `.env` files, passwords in URLs, and large deletions. A key blocks the save until you've looked. The check reads a private snapshot, so it doesn't stage anything.

**Safe copies.** Start a session on a safe copy and the agent works in a separate git worktree on its own branch. Your folder stays untouched until you *bring the copy back*, and a conflict is aborted rather than left half-merged.

**Ask the council (optional).** Link Kuvend to an [Agentic OS](https://github.com/Lind-hack/agent-dashboard) dashboard and any take can go to its Roast room. Several AIs debate whether the change is right and what should happen next, and a judge rules. The verdict shows on the take, and one tap sends it to the agent as the next message. To link, make a code in the dashboard under Settings, Kuvend, then paste the address and code on Kuvend's start screen. Kuvend sends only that take's request, the agent's reply and its diff.

**Continue on your phone.** Start on your computer, keep going from your phone, mid-session. The agents keep running on your computer, so the phone gets the very same session: its history, and every skill, MCP server, hook, `CLAUDE.md`/`AGENTS.md` and sign-in the agents use there. Choose *Continue on phone* and scan the code with your phone's camera.
- With [Tailscale](https://tailscale.com) on both devices, the connection is private between your own devices, nothing public.
- Without it, Kuvend opens a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (install `cloudflared` once): an HTTPS link only your paired phone can use.
- The code works once, for ten minutes. Each paired phone gets its own key, which you can remove from the computer at any time. Over the phone route only a phone's key is accepted, and only the computer can turn phone access on or off or pair a new phone.
- While phone access is on, Kuvend keeps the computer from sleeping. Keep it plugged in; closing a laptop lid may still put it to sleep.
- On the phone, *Add to Home Screen* makes Kuvend open like an app.

**Modes, in plain words.**
- **Plan** looks and plans, and changes nothing.
- **Edit** changes files, and asks before running commands. When it was stopped from running something, you see what it wanted and can *Allow and continue*.
- **Full** changes files and runs anything.

**Project notes.** One place to tell both agents what they should always know. Notes are saved as `AGENTS.md`, and Claude Code reads them through a one-line `CLAUDE.md`.

**Quick asks** after a take: explain what you changed, find bugs in it, add tests, make it work on phones.

## Security

- Listens on `127.0.0.1` only, unless you turn on phone access (then also on your private Tailscale address, or through a Cloudflare tunnel, for paired phones only).
- Every request needs this install's random key. The key is in the link Kuvend prints, and the page keeps it in your browser.
- Requests from other websites, and from other host names pointing at your machine (DNS rebinding), are refused.
- Agent replies are rendered as sanitized markdown. A page an agent quotes can't run script in Kuvend's tab.
- Prompts go to the agents on stdin, never through a shell.

## Develop

```bash
npm install
npm run dev      # rebuilds the web app and restarts the server on change
npm test         # server tests: undo, the save check, the agent event parsers, the access rules
npm run build    # web app to dist/web, server to dist/server
```

Kuvend keeps its own data in `~/.kuvend` (sessions, settings, safe copies). Set `KUVEND_HOME` to use another folder.

## License

MIT
