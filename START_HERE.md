# Start here

## 1. Set up the folder (5 minutes)
1. Create a new folder `constructiq` and unzip this kit into it. Run `git init`.
2. Copy your old frontend into `constructiq/legacy-web/`. Leave out `node_modules/`, `.next/` and any `.env` file.
3. Make sure these are installed: Node 20+, Python 3.12, Docker Desktop, Git.
4. Install the language servers the plugins need:
   ```
   npm i -g typescript typescript-language-server
   npm i -g pyright
   ```
5. Create `.gitignore` with at least: `node_modules/ .next/ .env .env.* __pycache__/ .venv/`

## 2. Open Claude Code
```
cd constructiq
claude
```
- Trust the folder when asked. The project settings enable the plugins; if any show as
  not installed, run for each:
  `/plugin install frontend-design@claude-plugins-official` (same for security-guidance,
  typescript-lsp, pyright-lsp, commit-commands)
- Add the browser tool for screenshots (in your normal terminal, once):
  `claude mcp add playwright -- npx @playwright/mcp@latest`
- Restart Claude Code, then run `/plugin` and check the Errors tab is empty.

## 3. Switch to plan mode (Shift+Tab) and paste the kickoff prompt

```
You are starting the CONSTRUCTIQ MVP. Read CLAUDE.md, docs/mvp-plan.md,
docs/design-direction.md and db/schema.sql fully. Skim docs/CONSTRUCTIQ-spec.pdf for context
only — most of it is out of MVP scope.

Then read legacy-web/ (the old frontend). Do not edit it.

Give me, without writing any code yet:
1. A 5-line summary of the MVP in your own words, so I know you understood it.
2. An audit of legacy-web: stack and versions, screens that exist, what is worth
   salvaging (components, data shapes, copy) and what to drop, judged against
   docs/design-direction.md.
3. Any conflicts or gaps you see between the plan, the design rules and the schema.
4. Your step-by-step plan for Day 1 (monorepo: apps/web, apps/api, infra/docker-compose
   with postgres 16 + n8n, Makefile, CI), listing every file you will create.
Wait for my approval before writing code.
```

## 4. After Claude Code answers
Send the answer to your senior reviewer chat before approving. Then continue with:

```
Approved. Execute the Day 1 plan. Prove it works: `make dev` starts postgres, n8n, api and
web; GET /health returns ok; `make test` and `make lint` pass. Show me the output, then commit.
```

## Rules of thumb
- One slice per session. Use `/clear` between unrelated tasks.
- If Claude Code fails the same fix twice, stop and report back instead of letting it loop.
- Run `/security-review` at the end of each phase (days 3, 6, 9, 12).
