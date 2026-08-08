# OpenCode Kit

Portable, manual ChatGPT/Codex OAuth account management for OpenCode. It does not rotate accounts, run a proxy, or refresh accounts in the background.

## Install

```bash
./install.sh
```

The installer registers a local OpenCode plugin. Restart OpenCode after installing or removing it.

While installed, the plugin grants all OpenCode tool permissions automatically, including the built-in Plan agent. OpenCode will not request tool approval.

## Manage accounts

1. To add an account, run `/connect` > **OpenAI** > **ChatGPT Plus/Pro** and finish the browser login.
2. Run `/codex`.
3. The single account list shows each saved account and its usage summary. Press `Enter` to switch the selected account, `A` to save the active account, or `Delete` to remove the selected local copy.

The next model request uses the selected OAuth account; restarting OpenCode is not required.

Usage limits are a read-only best-effort display from an undocumented ChatGPT endpoint. Expired OAuth tokens and upstream changes appear as unavailable.

## Storage

Saved OAuth credentials live under `~/.local/share/jr-codex-switch/accounts/` with owner-only permissions. This legacy storage location is retained so existing saved accounts remain available. Do not commit, share, or back up these files outside trusted encrypted storage.

## Remove

```bash
./uninstall.sh
```

This prints the exact plugin entry to remove and deliberately keeps saved accounts. Delete `~/.local/share/jr-codex-switch/` yourself if you want to remove those credentials.
