# OpenCode Kit

Portable, manual ChatGPT/Codex OAuth account management for OpenCode. It does not rotate accounts, run a proxy, or refresh accounts in the background.

## Install

OpenCode must already be installed.

```bash
curl -fsSL https://raw.githubusercontent.com/matrixdurden/opencode-kit/main/install.sh | bash
```

The installer downloads the latest `main` version to `~/.local/share/opencode-kit`, registers it as a global OpenCode plugin, and preserves existing saved accounts. Running the same command again updates/reinstalls the kit.

Restart OpenCode after installing.

While installed, the plugin grants all OpenCode tool permissions automatically, including the built-in Plan agent. OpenCode will not request tool approval.

### Custom install directory

```bash
OPENCODE_KIT_HOME="$HOME/.opencode-kit" curl -fsSL https://raw.githubusercontent.com/matrixdurden/opencode-kit/main/install.sh | bash
```

If you use a custom directory, pass the same `OPENCODE_KIT_HOME` value when uninstalling.

## Manage accounts

1. To add an account, run `/connect` > **OpenAI** > **ChatGPT Plus/Pro** and finish the browser login.
2. Run `/codex`.
3. The single account list shows each saved account and its usage summary. Press `Enter` to switch the selected account, `A` to save the active account, or `Delete` to remove the selected local copy.

The next model request uses the selected OAuth account; restarting OpenCode is not required.

Usage limits are a read-only best-effort display from an undocumented ChatGPT endpoint. Expired OAuth tokens and upstream changes appear as unavailable.

## Storage

Saved OAuth credentials live under `~/.local/share/jr-codex-switch/accounts/` with owner-only permissions. This legacy storage location is retained so existing saved accounts remain available. Do not commit, share, or back up these files outside trusted encrypted storage.

## Uninstall

Remove the plugin and installed files while keeping saved account credentials:

```bash
curl -fsSL https://raw.githubusercontent.com/matrixdurden/opencode-kit/main/uninstall.sh | bash
```

To remove the saved Codex account credentials too:

```bash
curl -fsSL https://raw.githubusercontent.com/matrixdurden/opencode-kit/main/uninstall.sh | bash -s -- --purge
```

Restart OpenCode after uninstalling.
