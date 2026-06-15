# Cloude Code ToolBox — MCP & Skills awareness

_Generated: 2026-06-09T07:59:53.456Z_

## How to use this report

- **Saved copy:** This file is **`.claude/cloude-code-toolbox-mcp-skills-awareness.md`** — refreshed whenever the toolbox runs an MCP & Skills scan (including on workspace open when auto-scan is enabled). It is meant for **Claude Code workspace context** together with `CLAUDE.md` (which gets a shorter replaceable summary when auto-merge is on).
- **MCP:** Lists **configured** servers from Claude Code config (`~/.claude.json` for user scope, `.mcp.json` for project scope). Use `/mcp` in the Claude Code panel to connect servers for your session.
- **Skills:** **On-disk** folders with `SKILL.md`. Claude Code does not auto-load them; attach `SKILL.md` or paths in chat when useful.
- **Task routing:** When the user’s request matches a server’s purpose (e.g. Confluence → Confluence/Atlassian MCP), prefer that **server id** from the tables below.

---

## MCP — workspace

Workspace `mcp.json` _(folder: syntrix_backend)_

- **d:\Follow The Beat\Req\Syntrix\syntrix_backend\.mcp.json** — _File missing_

_No active workspace servers in mcp.json._

## MCP — user profile

- **C:\Users\opanm\.claude.json** — _File exists — servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| supabase | http | https://mcp.supabase.com/mcp?project_ref=efxyhgmnrplittfahgzu |
| figma | http | http://127.0.0.1:3845/mcp |
| agentmemory | stdio | npx -y @agentmemory/mcp |

## Skills (local `SKILL.md` folders)

### Project-scoped

_None found (or no workspace open)._

### User-scoped

- **find-skills** — `C:\Users\opanm\.agents\skills\find-skills`
  - Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used w

- **karpathy-guidelines** — `C:\Users\opanm\.agents\skills\karpathy-guidelines`
  - Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.

---

## Suggested next steps

- **MCP:** Use this extension’s hub **MCP** tab, or `claude mcp list` in the terminal. In Claude Code, use `/mcp` to connect servers for the session.
- **Edit config:** Open `~/.claude.json` (user MCP) or `<workspace>/.mcp.json` (project MCP) via the extension commands.
- **Refresh this report:** run **Intelligence — scan MCP & Skills awareness** again after changing MCP config or adding skills.

_Report from Cloude Code ToolBox extension._
