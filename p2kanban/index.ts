/**
 * p2kanban — Quartz v5 page-type plugin
 *
 * Renders Obsidian Kanban boards (`kanban-plugin: board` / `kanban-plugin: basic`)
 * as a static HTML board. Obsidian stores the board as a markdown file:
 *
 *   ---
 *   kanban-plugin: board
 *   ---
 *
 *   ## Column A #todo
 *   - [ ] a task
 *   - [x] a done task
 *
 *   ## Column B
 *   - [ ] another task
 *
 *   %% kanban:settings
 *   ```json
 *   {"kanban-plugin":"board"}
 *   ```
 *   %%
 *
 * The board is fully self-contained in the markdown, so we parse the source
 * file directly (via ctx.argv.directory + fileData.relativePath) at render time
 * and do not need a separate transformer.
 */

import type { QuartzPageTypePlugin } from "../quartz/plugins/types"
import type { QuartzComponentProps, QuartzComponent } from "../quartz/components/types"
import { h } from "preact"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

interface Options {
  /** Render the trailing `%% kanban:settings` block? Usually noise — keep off. */
  showSettings: boolean
}

interface KanbanTask {
  text: string
  done: boolean
}

interface KanbanColumn {
  title: string
  /** inline tags attached to the column heading, e.g. `#todo` */
  tags: string[]
  tasks: KanbanTask[]
}

function defaultOptions(): Options {
  return { showSettings: false }
}

/**
 * Parse raw Kanban markdown into columns. We split on `## ` headings and then
 * walk the bullet lines within each column. The Obsidian checkboxes are the
 * standard `- [ ]` / `- [x]`. Tags may appear on the column heading line
 * (`## In Progress #wip`).
 */
function parseKanban(raw: string): { columns: KanbanColumn[]; plugin: string } {
  // Strip the trailing `%% kanban:settings ... %%` block if present.
  const settingsMatch = raw.match(/%%\s*kanban:settings[\s\S]*?%%/)
  const settingsBlock = settingsMatch ? settingsMatch[0] : ""
  const body = settingsMatch ? raw.replace(settingsBlock, "") : raw

  // Detect plugin variant from frontmatter or settings block.
  let plugin = "board"
  const fmPlugin = raw.match(/kanban-plugin:\s*(\w+)/)
  if (fmPlugin) plugin = fmPlugin[1]
  const settingsPlugin = settingsBlock.match(/"kanban-plugin"\s*:\s*"(\w+)"/)
  if (settingsPlugin) plugin = settingsPlugin[1]

  const lines = body.split(/\r?\n/)
  const columns: KanbanColumn[] = []
  let current: KanbanColumn | null = null

  const headingRe = /^##\s+(.*)$/
  const taskRe = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/
  const tagRe = /#([\p{L}\p{N}_/-]+)/gu

  for (const line of lines) {
    const heading = line.match(headingRe)
    if (heading) {
      // Column title may carry inline tags, e.g. "In Progress #wip".
      const rawTitle = heading[1].trim()
      const tags = [...rawTitle.matchAll(tagRe)].map((m) => m[1])
      const title = rawTitle.replace(tagRe, "").trim() || "Untitled"
      current = { title, tags, tasks: [] }
      columns.push(current)
      continue
    }

    const task = line.match(taskRe)
    if (task && current) {
      const done = task[1].toLowerCase() === "x"
      const text = task[2].trim()
      current.tasks.push({ text, done })
      continue
    }
  }

  return { columns, plugin }
}

/**
 * Lightweight inline cleanup for a task: turn `[[Wiki Links]]` into plain
 * readable text and strip inline-code ticks. We intentionally keep this minimal
 * — the board already shows task text; full markdown in a `<li>` is overkill.
 */
function renderTaskText(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[target|alias]]
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[target]]
    .replace(/`([^`]+)`/g, "$1") // strip inline code ticks
}

function KanbanBoard(props: QuartzComponentProps) {
  const fileData = props.fileData
  const ctx = props.ctx

  const relativePath = fileData.relativePath as string | undefined
  let columns: KanbanColumn[] = []
  let plugin = "board"

  if (relativePath && ctx?.argv?.directory) {
    const fullPath = join(ctx.argv.directory, relativePath)
    if (existsSync(fullPath)) {
      try {
        const raw = readFileSync(fullPath, "utf-8")
        const parsed = parseKanban(raw)
        columns = parsed.columns
        plugin = parsed.plugin
      } catch {
        // Fall through to empty board.
      }
    }
  }

  const totalTasks = columns.reduce((n, c) => n + c.tasks.length, 0)
  const doneTasks = columns.reduce(
    (n, c) => n + c.tasks.filter((t) => t.done).length,
    0,
  )

  const columnEls = columns.map((col) => {
    const tagEls = col.tags.map((t) => h("span", { class: "kanban-column-tag" }, `#${t}`))
    const taskEls = col.tasks.map((task) => {
      const cls = task.done ? "kanban-task kanban-task-done" : "kanban-task"
      return h(
        "li",
        { class: cls },
        h("span", { class: "kanban-check" }, task.done ? "✓" : ""),
        h("span", { class: "kanban-task-text" }, renderTaskText(task.text)),
      )
    })
    return h(
      "div",
      { class: "kanban-column" },
      h(
        "div",
        { class: "kanban-column-header" },
        h("span", { class: "kanban-column-title" }, col.title),
        tagEls.length ? h("span", { class: "kanban-column-tags" }, ...tagEls) : null,
        h("span", { class: "kanban-column-count" }, String(col.tasks.length)),
      ),
      h("ul", { class: "kanban-task-list" }, ...taskEls),
    )
  })

  return h(
    "div",
    { class: "kanban-board" },
    h(
      "div",
      { class: "kanban-board-meta" },
      h("span", { class: "kanban-plugin-badge" }, `Obsidian Kanban · ${plugin}`),
      h("span", { class: "kanban-progress" }, `${doneTasks}/${totalTasks} done`),
    ),
    h("div", { class: "kanban-columns" }, ...columnEls),
  )
}

const css = `
.kanban-board {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1.5rem 0;
}
.kanban-board-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.85rem;
  color: var(--darkgray);
}
.kanban-plugin-badge {
  font-family: var(--codeFont);
  background: var(--lightgray);
  border-radius: 4px;
  padding: 0.1rem 0.5rem;
}
.kanban-progress {
  font-variant-numeric: tabular-nums;
}
.kanban-columns {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
}
.kanban-column {
  flex: 1 1 260px;
  min-width: 240px;
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.kanban-column-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.4rem;
}
.kanban-column-title {
  font-weight: 600;
}
.kanban-column-tags {
  display: flex;
  gap: 0.25rem;
}
.kanban-column-tag {
  font-size: 0.75rem;
  color: var(--secondary);
}
.kanban-column-count {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--gray);
  background: var(--lightgray);
  border-radius: 999px;
  padding: 0 0.5rem;
  min-width: 1.5rem;
  text-align: center;
}
.kanban-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.kanban-task {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: var(--lightgray);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  line-height: 1.35;
}
.kanban-task-done {
  opacity: 0.6;
}
.kanban-task-done .kanban-task-text {
  text-decoration: line-through;
}
.kanban-check {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  border: 1px solid var(--gray);
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: var(--secondary);
  margin-top: 0.1rem;
}
.kanban-task-done .kanban-check {
  background: var(--secondary);
  color: var(--light);
  border-color: var(--secondary);
}
.kanban-task-text {
  flex: 1 1 auto;
}
`

const KanbanBody: QuartzComponent = (() => {
  const C = (props: QuartzComponentProps) => KanbanBoard(props)
  C.css = css
  C.displayName = "KanbanBoard"
  return C
})()

const KanbanPage: QuartzPageTypePlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions(), ...(userOpts ?? {}) }
  void opts // reserved for future options (e.g. showSettings)
  return {
    name: "KanbanPage",
    priority: 30,
    match: ({ fileData }) => {
      const fm = fileData.frontmatter as Record<string, unknown> | undefined
      if (!fm) return false
      const plugin = fm["kanban-plugin"]
      return typeof plugin === "string" && plugin.length > 0
    },
    layout: "content",
    body: () => KanbanBody,
  }
}

export default KanbanPage
