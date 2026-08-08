/** @jsxImportSource @opentui/solid */
import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { For, Show, createEffect, createResource, createSignal } from "solid-js"
import { useBindings } from "@opentui/keymap/solid"
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const home = process.env.HOME
if (!home) throw new Error("HOME is not set")

const authPath = join(home, ".local", "share", "opencode", "auth.json")
const dataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share")
const accountsDir = join(dataHome, "jr-codex-switch", "accounts")
const usageCache = new Map<string, { expiresAt: number; text: string }>()

function accountPath(name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error("Use letters, numbers, underscores, or hyphens for account names")
  }

  return join(accountsDir, `${name}.json`)
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function writeJson(path: string, value: unknown) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, path)
  await chmod(path, 0o600)
}

async function accountNames() {
  await mkdir(accountsDir, { recursive: true, mode: 0o700 })
  await chmod(accountsDir, 0o700)
  const entries = await readdir(accountsDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => basename(entry.name, ".json"))
    .sort()
}

async function saveCurrentAccount(name: string) {
  const auth = await readJson(authPath)
  if (auth.openai?.type !== "oauth") {
    throw new Error("Connect OpenAI with ChatGPT Plus/Pro first")
  }

  await mkdir(accountsDir, { recursive: true, mode: 0o700 })
  await chmod(accountsDir, 0o700)
  await writeJson(accountPath(name), { openai: auth.openai })
}

async function switchAccount(api: TuiPluginApi, name: string) {
  const saved = await readJson(accountPath(name))
  if (saved.openai?.type !== "oauth") throw new Error(`Saved account "${name}" is invalid`)

  await api.client.auth.set({ path: { id: "openai" }, body: saved.openai })
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function percentage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function duration(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${Math.ceil(seconds / 60)}m`
}

function usageWindow(label: string, value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const window = value as Record<string, unknown>
  const used = percentage(window.used_percent)
  if (used === undefined) return undefined

  const resetAfter = positiveNumber(window.reset_after_seconds)
  const resetAt = positiveNumber(window.reset_at ?? window.resets_at)
  const reset = resetAfter
    ? `resets in ${duration(resetAfter)}`
    : resetAt
      ? `resets ${new Date(resetAt < 10_000_000_000 ? resetAt * 1000 : resetAt).toLocaleString()}`
      : "reset unknown"
  const limit = positiveNumber(window.limit_window_seconds)
  return `${label}${limit ? ` (${duration(limit)})` : ""}: ${Math.max(0, 100 - Math.min(100, used))}% left, ${reset}`
}

async function usage(name: string) {
  const cached = usageCache.get(name)
  if (cached && cached.expiresAt > Date.now()) return cached.text

  const saved = await readJson(accountPath(name))
  const openai = saved.openai as Record<string, unknown> | undefined
  if (openai?.type !== "oauth" || typeof openai.access !== "string") return `${name}: unavailable`

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${openai.access}`,
      Accept: "application/json",
      "User-Agent": "codex_cli_rs",
      ...(typeof openai.accountId === "string" ? { "ChatGPT-Account-Id": openai.accountId } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) return `${name}: unavailable (${response.status})`

  const body = await response.json() as Record<string, unknown>
  const rateLimit = body.rate_limit as Record<string, unknown> | undefined
  const windows = [
    usageWindow("Primary", rateLimit?.primary_window),
    usageWindow("Secondary", rateLimit?.secondary_window),
  ].filter((value): value is string => value !== undefined)
  const plan = typeof body.plan_type === "string" ? ` (${body.plan_type})` : ""
  const text = windows.length ? `${plan.trim()}: ${windows.join(" | ")}` : `${plan.trim() || "Usage"}: unavailable`
  usageCache.set(name, { expiresAt: Date.now() + 60_000, text })
  return text
}

type Account = {
  name: string
  active: boolean
}

async function accounts(): Promise<Account[]> {
  let activeAccountId: string | undefined
  try {
    const auth = await readJson(authPath)
    activeAccountId = typeof auth.openai?.accountId === "string" ? auth.openai.accountId : undefined
  } catch {
    // The empty list remains usable even before the first OpenAI login.
  }

  return Promise.all((await accountNames()).map(async (name) => {
    const saved = await readJson(accountPath(name))
    return {
      name,
      active: activeAccountId !== undefined && saved.openai?.accountId === activeAccountId,
    }
  }))
}

function AccountList(props: { api: TuiPluginApi; open: () => void }) {
  const [items, { refetch }] = createResource(accounts)
  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const rows = () => items() ?? []
  const current = () => rows()[selected()]

  createEffect(() => {
    if (selected() >= rows().length) setSelected(Math.max(0, rows().length - 1))
  })

  const showError = (error: unknown) => {
    props.api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
  }

  const add = () => {
    const DialogPrompt = props.api.ui.DialogPrompt
    props.api.ui.dialog.replace(() => (
      <DialogPrompt
        title="Save current OpenAI account"
        placeholder="personal"
        onConfirm={(name) => {
          props.api.ui.dialog.clear()
          void saveCurrentAccount(name)
            .then(() => props.api.ui.toast({ variant: "success", message: `Saved ${name}` }))
            .then(props.open)
            .catch(showError)
        }}
        onCancel={props.open}
      />
    ))
  }

  const choose = async () => {
    const account = current()
    if (!account || busy()) return
    setBusy(true)
    try {
      await switchAccount(props.api, account.name)
      props.api.ui.dialog.clear()
      props.api.ui.toast({ variant: "success", message: `Switched to ${account.name}` })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const account = current()
    if (!account || busy()) return
    setBusy(true)
    try {
      await unlink(accountPath(account.name))
      usageCache.delete(account.name)
      await refetch()
      props.api.ui.toast({ variant: "success", message: `Removed ${account.name}` })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  useBindings(() => ({
    enabled: () => props.api.ui.dialog.open,
    bindings: [
      { key: "up", cmd: () => setSelected((index) => Math.max(0, index - 1)) },
      { key: "down", cmd: () => setSelected((index) => Math.min(rows().length - 1, index + 1)) },
      { key: "return", cmd: () => void choose() },
      { key: "delete", cmd: () => void remove() },
      { key: "a", cmd: add },
      { key: "escape", cmd: () => props.api.ui.dialog.clear() },
    ],
  }))

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text><b>Codex accounts</b></text>
        <text fg={props.api.theme.current.textMuted}>enter switch  a add  del remove  esc close</text>
      </box>
      <Show when={!items.loading} fallback={<text fg={props.api.theme.current.textMuted}>Loading accounts...</text>}>
        <Show when={rows().length > 0} fallback={<text fg={props.api.theme.current.textMuted}>No saved accounts. Press A after connecting OpenAI.</text>}>
          <For each={rows()}>
            {(account, index) => <AccountRow api={props.api} account={account} selected={index() === selected()} />}
          </For>
        </Show>
      </Show>
    </box>
  )
}

function AccountRow(props: { api: TuiPluginApi; account: Account; selected: boolean }) {
  const [summary] = createResource(() => usage(props.account.name).catch(() => "Usage: unavailable"))
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} backgroundColor={props.selected ? "#2d4f7a" : undefined}>
      <text><b>{props.account.active ? "* " : "  "}{props.account.name}</b></text>
      <text fg={props.api.theme.current.textMuted}>{summary() ?? "Loading usage..."}</text>
    </box>
  )
}

export default {
  id: "jr-codex-accounts",
  tui: async (api) => {
    const open = () => {
      api.ui.dialog.setSize("large")
      api.ui.dialog.replace(() => <AccountList api={api} open={open} />)
    }

    api.keymap.registerLayer({
      commands: [
        { name: "jr.codex", title: "Codex accounts", category: "Plugin", namespace: "palette", slashName: "codex", run: open },
      ],
      bindings: [],
    })
  },
} satisfies TuiPluginModule & { id: string }
