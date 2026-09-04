---
name: needlepath-doctor
description: Use when checking Needlepath connectivity, configuration, or readiness before automatic selection.
---

# Needlepath Doctor

1. Call `needlepath_doctor`.
2. Report `ok`, `code`, `outcome`, and `checkedAt` only. `ok` means Needlepath returned a valid answer to this plugin's request with the configured key and without an engine error. `outcome` is the plugin's classification of that answer for the diagnostic probe (for example `ok` or `engine_fallback`) and does not affect `ok`. Do not request, display, or infer credentials, prompts, tool output, request bodies, or response excerpts.
3. For `not_configured`, direct the user to https://console.nextmoca.com and the plugin's sensitive settings. Do not paste an API key into Claude or ask for one in conversation.
4. Keep the current mode when the diagnostic is not successful. A successful diagnostic is required before automatic selection.
