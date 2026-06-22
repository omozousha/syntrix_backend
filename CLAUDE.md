# Claude Code — project context














## Syntrix product boundary

Syntrix is a Network Asset Management / Inventory Tool for passive and physical-layer network assets. Treat approved inventory, validation evidence, topology relations, fiber cores, routes, splice data, and audit trail as the source of truth.

Do not design current-scope features as a Network Management System (NMS). Live traffic monitoring, SNMP/telemetry polling, OLT live commands, auto discovery, alarm correlation, bandwidth/throughput dashboards, CPU/memory/interface traffic metrics, and other real-time active-device monitoring are out of scope unless the user explicitly asks for a future integration plan.

Prefer inventory-driven language: approved inventory status, field validation, manual measurement, OTDR/evidence attachment, topology relation, and impact analysis based on approved physical relations.

<!-- cloude-code-toolbox:mcp-skills-awareness-begin -->

### MCP & Skills awareness (Cloude Code ToolBox)

_Last synced: 2026-06-09T07:59:53.488Z._

- **Full report:** `.claude/cloude-code-toolbox-mcp-skills-awareness.md` in this workspace (auto-overwritten on each scan). Use it as ground truth for configured servers and skill folders.
- **MCP:** For **live tools** in Claude Code, enable the matching server via `/mcp`. Servers are configured in `~/.claude.json` (user) and `.mcp.json` (project).
- **When the user’s task matches a server** (e.g. Confluence work and a **Confluence** / **Atlassian** MCP is listed), **prefer that server id** and plan on tool use—not only file search.
- **Skills:** Folders below contain `SKILL.md`; attach or cite paths in chat when relevant.

#### Workspace MCP

- `d:\Follow The Beat\Req\Syntrix\syntrix_backend\.mcp.json` _(workspace: syntrix_backend)_ — _file missing_

_No active workspace servers in mcp.json._

#### User MCP

- `C:\Users\opanm\.claude.json` — _servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| supabase | http | https://mcp.supabase.com/mcp?project_ref=efxyhgmnrplittfahgzu |
| figma | http | http://127.0.0.1:3845/mcp |
| agentmemory | stdio | npx -y @agentmemory/mcp |

#### Project skills

_None found (or no workspace open)._

#### User skills

- **find-skills** — `C:\Users\opanm\.agents\skills\find-skills` — Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used w

- **karpathy-guidelines** — `C:\Users\opanm\.agents\skills\karpathy-guidelines` — Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.

<!-- cloude-code-toolbox:mcp-skills-awareness-end -->
<!-- claude-code-memory-bank:begin -->
# Memory bank (persistent context)

This repository uses a **memory bank** under `./memory-bank/` — structured markdown that survives sessions, similar to Cursor-style workflows.

Context layers (read deeper files after foundations): **projectbrief** → **productContext** / **systemPatterns** / **techContext** → **activeContext** → **progress**.

## What Claude should do

1. **Before substantive work**, read **all** of the following under `./memory-bank/` when the task depends on project state (not optional for non-trivial work). In **Plan mode**, reading for the plan is allowed; **do not edit** these files until **Act mode** unless the user only asked for a documentation/memory update with no code change.
   - `projectbrief.md` — scope and goals
   - `productContext.md` — product intent and UX
   - `systemPatterns.md` — architecture and conventions
   - `techContext.md` — stack and constraints
   - `progress.md` — done / pending / known issues
   - `activeContext.md` — current task and decisions

2. **During Act-mode work**, keep `activeContext.md` aligned with the current task (update when focus shifts).

3. **After meaningful milestones** (in Act mode), update `progress.md` and any affected docs in `./memory-bank/`.

4. When the user asks to **update memory bank** (or similar), **open and review every** file in `./memory-bank/`, then update what changed — especially `activeContext.md` and `progress.md`, even if other files are unchanged. Prefer doing heavy memory-bank writes in **Act mode** unless the user asked for documentation-only updates.

5. Prefer **short, factual updates** over long prose. Reference files, symbols, and tickets instead of duplicating code.

Do not delete these files; evolve them as the project changes.
<!-- claude-code-memory-bank:end -->






<!-- cloude-code-toolbox:token-optimization-begin -->

### Token Optimization (Claude Code ToolBox)

_Active level: concise_

- Respond concisely: 1-3 sentences max unless the user asks for detail.
- Never restate the user's question or echo file contents back verbatim.
- When showing code changes, show only modified lines with 2 lines of context.
- Skip meta-commentary ("I'll now...", "Let me...", "Here's what I did...").
- Before reading a file, check `.claude/project-map.md` for structural context.
- If you already read a file this session and it hasn't changed, reference your memory instead of re-reading.
- Do not read files matching `.claudeignore` patterns unless explicitly asked.

<!-- cloude-code-toolbox:token-optimization-end -->
<!-- cloude-code-toolbox:cursorrules-begin -->

## Migrated from `.cursorrules` (via Cloude Code ToolBox)

# Cursor / Copilot shared hints (root rules)

- Keep answers concise.
- Match existing code style.

<!-- cloude-code-toolbox:cursorrules-end -->

<!-- cursor-rules-to-claude:always-begin -->
<!-- Generated by cursor-rules-to-claude — re-run after changing Cursor rules. -->

# Project instructions (from Cursor rules)

## .cursor/rules/core.mdc

<!-- Source: .cursor/rules/core.mdc -->
## Core rules — Plan / Act (match GitHub Copilot instructions)

You have two modes of operation:

1. **Plan mode** — Work with the user to define a plan; **do not change the codebase** until the user approves.
2. **Act mode** — Make changes based on the approved plan.

### Plan mode (default)

- **First line MUST be:** `# Mode: PLAN`
- **Do not** create, edit, or delete any files (including under the memory bank path), apply patches, or run terminal commands that modify the workspace—**only** read/search, discuss, and output the plan in markdown.
- Stay in Plan mode until the user explicitly approves (e.g. **`ACT`**).
- If the user asks for edits while in Plan mode, respond with `# Mode: PLAN`, remind them you need approval first, and ask them to type **`ACT`** when ready.
- In Plan mode, include the **full updated plan** in every response.
- End by telling the user to type **`ACT`** to implement (or refine the plan).

### Act mode

- **First line MUST be:** `# Mode: ACT`
- Enter only after clear approval (**`ACT`**, **"go ahead"**, **"implement the plan"**, or user explicitly skipped planning).
- Then you may edit files, run commands, and update documentation.
- After completing Act-mode work for that turn, the next user message starts in **Plan mode** again unless they send **`ACT`** for more edits.

### Exceptions

- If the user clearly says to **skip the plan** and implement immediately, you may use `# Mode: ACT` and proceed.

## .cursor/rules/memory-bank.mdc

<!-- Source: .cursor/rules/memory-bank.mdc -->
> Persistent project memory via markdown files (memory bank)

# Cursor memory bank

You are an AI assistant whose **session memory resets**. Treat the **memory bank** as the durable source of truth for project context. At the **start of every substantive task**, read **all** memory bank files under `./memory-bank/` — this is not optional when the task depends on project state.

## Memory bank structure

Core files (Markdown), in hierarchy order (all under `./memory-bank/`):

```mermaid
flowchart TD
    PB[projectbrief.md] --> PC[productContext.md]
    PB --> SP[systemPatterns.md]
    PB --> TC[techContext.md]

    PC --> AC[activeContext.md]
    SP --> AC
    TC --> AC

    AC --> P[progress.md]
```

### Core files (required)

1. `./memory-bank/projectbrief.md` — Scope, goals, source of truth for what “done” means.
2. `./memory-bank/productContext.md` — Why the product exists, problems solved, UX goals.
3. `./memory-bank/activeContext.md` — Current focus, recent changes, next steps, active decisions.
4. `./memory-bank/systemPatterns.md` — Architecture, technical decisions, patterns, component relationships.
5. `./memory-bank/techContext.md` — Stack, setup, constraints, dependencies.
6. `./memory-bank/progress.md` — What works, what is left, status, known issues.

### Additional context

Add files or subfolders under `./memory-bank/` when useful (integrations, APIs, testing, deployment, etc.).

## Workflows

### Plan mode

```mermaid
flowchart TD
    Start[Start] --> ReadFiles[Read memory bank]
    ReadFiles --> CheckFiles{Files complete?}

    CheckFiles -->|No| Plan[Create plan]
    Plan --> Document[Document in chat]

    CheckFiles -->|Yes| Verify[Verify context]
    Verify --> Strategy[Develop strategy]
    Strategy --> Present[Present approach]
```

### Act mode

```mermaid
flowchart TD
    Start[Start] --> Context[Check memory bank]
    Context --> Update[Update documentation]
    Update --> Rules[Update .cursor/rules if needed]
    Rules --> Execute[Execute task]
    Execute --> Document[Document changes]
```

## Documentation updates

Update the memory bank when:

1. You discover new project patterns.
2. You finish significant implementation work.
3. The user asks to **update memory bank** — then **review every** memory bank file (even if most need no edit). Pay extra attention to `activeContext.md` and `progress.md`.
4. Context is unclear and needs clarification.

```mermaid
flowchart TD
    Start[Update process]

    subgraph Process
        P1[Review ALL files]
        P2[Document current state]
        P3[Clarify next steps]
        P4[Update .cursor/rules if needed]
    end

    Start --> Process
```

## Project intelligence (`.cursor/rules`)

Use `.cursor/rules` as a **learning journal**: preferences, non-obvious patterns, tooling, and decisions that are not already captured in code or the memory bank.

```mermaid
flowchart TD
    Start{Discover new pattern}

    subgraph Learn [Learning process]
        D1[Identify pattern]
        D2[Validate with user]
        D3[Document in .cursor/rules]
    end

    subgraph Apply [Usage]
        A1[Read .cursor/rules]
        A2[Apply learned patterns]
        A3[Improve future work]
    end

    Start --> Learn
    Learn --> Apply
```

### What to capture

- Critical implementation paths and conventions
- User preferences and workflow
- Project-specific patterns and pitfalls
- How decisions evolved

**Remember:** after a reset, the memory bank (and `.cursor/rules`) is your continuity. Keep them accurate and concise.
<!-- cursor-rules-to-claude:always-end -->
