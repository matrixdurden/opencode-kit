/** @jsxImportSource @opentui/solid */
import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { For, Show, createEffect, createResource, createSignal } from "solid-js"
import { useBindings } from "@opentui/keymap/solid"
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const home = process.env.HOME
if (!home) throw new Error("HOME is not set")

const dataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share")
const authPath = join(dataHome, "opencode", "auth.json")
const accountsDir = join(dataHome, "jr-codex-switch", "accounts")
const accountNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const usageCache = new Map<string, { expiresAt: number; summary: UsageSummary }>()
const accountRefreshes = new Map<string, Promise<OAuth>>()
const usageQueue: Array<() => void> = []
let activeUsageRequests = 0
const maxUsageRequests = 3
const oauthClientId = "app_EMoamEEZ73f0CkXaXp7hrann"
const oauthIssuer = "https://auth.openai.com"

type OAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

type UsageSummary = {
  identity: string
  details: string
}

function accountPath(name: string) {
  if (!accountNamePattern.test(name)) {
    throw new Error("Use letters, numbers, underscores, or hyphens for account names")
  }

  return join(accountsDir, `${name}.json`)
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"))
}

function openAIAuth(value: unknown): OAuth | undefined {
  if (!value || typeof value !== "object") return undefined
  const auth = (value as Record<string, unknown>).openai
  if (!auth || typeof auth !== "object") return undefined
  const openai = auth as Record<string, unknown>
  if (
    openai.type !== "oauth" ||
    typeof openai.refresh !== "string" ||
    typeof openai.access !== "string" ||
    typeof openai.expires !== "number"
  ) return undefined

  return {
    type: "oauth",
    refresh: openai.refresh,
    access: openai.access,
    expires: openai.expires,
    ...(typeof openai.accountId === "string" ? { accountId: openai.accountId } : {}),
    ...(typeof openai.enterpriseUrl === "string" ? { enterpriseUrl: openai.enterpriseUrl } : {}),
  }
}

async function readOpenAIAuth(path: string) {
  const auth = openAIAuth(await readJson(path))
  if (!auth) throw new Error("OpenAI OAuth credentials are invalid")
  return auth
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
    .filter((name) => accountNamePattern.test(name))
    .sort()
}

async function saveCurrentAccount(name: string) {
  const openai = await readOpenAIAuth(authPath).catch(() => undefined)
  if (!openai) throw new Error("Connect OpenAI with ChatGPT Plus/Pro first")

  await mkdir(accountsDir, { recursive: true, mode: 0o700 })
  await chmod(accountsDir, 0o700)
  await writeJson(accountPath(name), { openai })
  usageCache.delete(name)
}

async function switchAccount(api: TuiPluginApi, name: string) {
  const openai = await freshAccount(api, name)

  await api.client.auth.set({ providerID: "openai", auth: openai })

  const active = await readOpenAIAuth(authPath).catch(() => undefined)
  const switched = openai.accountId
    ? active?.accountId === openai.accountId
    : active?.access === openai.access
  if (!switched) throw new Error(`OpenCode did not switch to "${name}"`)
}

function jwtClaims(token: string) {
  const payload = token.split(".")[1]
  if (!payload) return undefined
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function refreshAccount(openai: OAuth) {
  const response = await fetch(`${oauthIssuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: openai.refresh,
      client_id: oauthClientId,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Could not refresh account (${response.status})`)

  const tokens = await response.json() as Record<string, unknown>
  if (typeof tokens.access_token !== "string") throw new Error("OpenAI returned an invalid access token")
  const claims = (typeof tokens.id_token === "string" ? jwtClaims(tokens.id_token) : undefined) ?? jwtClaims(tokens.access_token)
  const nested = claims?.["https://api.openai.com/auth"]
  const nestedAccountId = nested && typeof nested === "object"
    ? (nested as Record<string, unknown>).chatgpt_account_id
    : undefined
  const accountId = typeof claims?.chatgpt_account_id === "string"
    ? claims.chatgpt_account_id
    : typeof nestedAccountId === "string"
      ? nestedAccountId
      : openai.accountId

  return {
    ...openai,
    access: tokens.access_token,
    refresh: typeof tokens.refresh_token === "string" ? tokens.refresh_token : openai.refresh,
    expires: Date.now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
    ...(accountId ? { accountId } : {}),
  }
}

async function freshAccount(api: TuiPluginApi, name: string) {
  const openai = await readOpenAIAuth(accountPath(name)).catch(() => undefined)
  if (!openai) throw new Error(`Saved account "${name}" is invalid`)
  if (openai.expires > Date.now() + 30_000) return openai

  let pending = accountRefreshes.get(name)
  if (!pending) {
    pending = refreshAccount(openai)
      .then(async (refreshed) => {
        await writeJson(accountPath(name), { openai: refreshed })
        usageCache.delete(name)
        return refreshed
      })
      .finally(() => accountRefreshes.delete(name))
    accountRefreshes.set(name, pending)
  }
  const refreshed = await pending

  const active = await readOpenAIAuth(authPath).catch(() => undefined)
  const wasActive = Boolean(active && (openai.accountId
    ? active.accountId === openai.accountId
    : active.access === openai.access))
  if (wasActive) {
    await api.client.auth.set({ providerID: "openai", auth: refreshed })
  }
  return refreshed
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

function usage(api: TuiPluginApi, name: string) {
  return new Promise<UsageSummary>((resolve, reject) => {
    const run = () => {
      activeUsageRequests++
      void fetchUsage(api, name).then(resolve, reject).finally(() => {
        activeUsageRequests--
        usageQueue.shift()?.()
      })
    }
    if (activeUsageRequests < maxUsageRequests) run()
    else usageQueue.push(run)
  })
}

async function fetchUsage(api: TuiPluginApi, name: string) {
  const cached = usageCache.get(name)
  if (cached && cached.expiresAt > Date.now()) return cached.summary

  const openai = await freshAccount(api, name)
  const fallbackEmail = jwtClaims(openai.access)?.email

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${openai.access}`,
      Accept: "application/json",
      "User-Agent": "codex_cli_rs",
      ...(openai.accountId ? { "ChatGPT-Account-Id": openai.accountId } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    return {
      identity: typeof fallbackEmail === "string" ? fallbackEmail : "Account info unavailable",
      details: `Usage unavailable (${response.status})`,
    }
  }

  const body = await response.json() as Record<string, unknown>
  const rateLimit = body.rate_limit as Record<string, unknown> | undefined
  const windows = [
    usageWindow("Primary", rateLimit?.primary_window),
    usageWindow("Secondary", rateLimit?.secondary_window),
  ].filter((value): value is string => value !== undefined)
  const email = typeof body.email === "string" ? body.email : fallbackEmail
  const plan = typeof body.plan_type === "string" ? body.plan_type : undefined
  const summary = {
    identity: [email, plan].filter((value): value is string => typeof value === "string").join(" | ") || "Account info unavailable",
    details: windows.length ? windows.join(" | ") : "Usage unavailable",
  }
  usageCache.set(name, { expiresAt: Date.now() + 60_000, summary })
  return summary
}

type Account = {
  name: string
  active: boolean
}

async function accounts(): Promise<Account[]> {
  const active = await readOpenAIAuth(authPath).catch(() => undefined)

  return Promise.all((await accountNames()).map(async (name) => {
    const saved = await readOpenAIAuth(accountPath(name)).catch(() => undefined)
    const isActive = Boolean(saved && active && (saved.accountId
      ? saved.accountId === active.accountId
      : saved.access === active.access))
    if (isActive && active && (!saved || active.expires >= saved.expires)) {
      if (saved?.access !== active.access) usageCache.delete(name)
      await writeJson(accountPath(name), { openai: active })
    }
    return {
      name,
      active: isActive,
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
  const [summary] = createResource(() => usage(props.api, props.account.name).catch((error) => ({
    identity: error instanceof Error ? error.message : "Account info unavailable",
    details: "Usage unavailable",
  })))
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={props.selected ? "#2d4f7a" : undefined}>
      <box flexDirection="row" justifyContent="space-between">
        <text><b>{props.account.active ? "* " : "  "}{props.account.name}</b></text>
        <text fg={props.api.theme.current.textMuted}>{summary()?.identity ?? "Loading account..."}</text>
      </box>
      <text fg={props.api.theme.current.textMuted} wrapMode="word">{summary()?.details ?? "Loading usage..."}</text>
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
