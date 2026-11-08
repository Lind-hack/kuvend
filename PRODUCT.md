# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: a Node.js server on the user's own machine (it runs the agent CLIs, git and the user's app)
serving a Vite + React + Tailwind v4 web app at 127.0.0.1. Chosen because the agents must run where
the user's code, logins and git are; a browser app ships faster than a native shell, and can be
wrapped later. Started with `npx kuvend` or `kuvend [folder]`.

## Users

Beginner first, developers welcome. The primary user builds software with AI agents without being
confident in git, terminals or diffs: they want to ask for a change, see what happened in plain words,
take it back if it went wrong, run the app, and save without leaking a key. Developers get the full
detail (raw diffs, commands, logs, flags) one click away, never in the beginner's way.

## Product Purpose

One local workspace for the coding agents a person already has (Claude Code, Codex): chat with them in
the real project folder, see each turn's changes, undo any turn, run the app and hand its errors back,
get a second opinion from the other agent, and save (commit) safely. Success: a person who would have
been lost in a terminal ships a working change and can explain what changed.

## Positioning

Agents check each other. Every change can get a second opinion from a different agent, and with an
optional Agentic OS sign-in a decision can go to a council debate (several AIs argue, a judge rules)
and come back as the next instruction. Undo is per turn and byte-exact, and saving is guarded.

## Operating Context

- Runs on the user's computer (Windows, macOS, Linux), opened in their browser from a link the CLI prints.
- Uses the user's own installed and signed-in CLIs: `claude` (Claude Code) and `codex`. Kuvend never sees logins.
- Works in the user's real folder, or in a "safe copy" (a git worktree on its own branch) merged back on request.
- Checkpoints live in the project's git under `refs/kuvend/`; a folder without git can turn it on in one click.

## Capabilities and Constraints

- Chat turns stream live; tool calls show as cards; Stop interrupts.
- Modes: Plan (looks, changes nothing), Edit (changes files), Full (also runs anything).
- Denied permissions show with "Allow and continue".
- Per-turn file list and diffs; Undo and Redo per turn.
- Run the app (detected dev command), live output, "Fix this error" sends the error to the agent.
- Second opinion: the other agent reviews a turn's diff read-only.
- Save: stage all, safety check (keys, .env files, big deletions), commit with a message.
- Project notes (AGENTS.md, shared with Claude via CLAUDE.md import).
- Security: listens on 127.0.0.1 only, per-install token, Host and Origin checks.
- Open: council link to Agentic OS (optional sign-in, not built yet); phone access (not built).

## Brand Commitments

- Name: Kuvend (Albanian for "assembly"). Open source, MIT, public GitHub repo.
- Voice: plain, calm, exact. Explains without talking down. No hype.
- It must not be a copy of egant: own name, own look, own features.

## Evidence on Hand

None yet: no users, testimonials, metrics or logos. Never invent them.

## Product Principles

1. Nothing is lost: every turn can be undone exactly, and saving checks before it commits.
2. Plain words first, full detail one click away.
3. The user's tools, the user's machine: no account needed, no logins handled.
4. Agents check each other's work.
5. Show what happened, not what the agent claims happened.
