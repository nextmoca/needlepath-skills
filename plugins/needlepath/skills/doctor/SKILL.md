---
name: needlepath-doctor
description: Use when checking Needlepath connectivity, configuration, or readiness before automatic selection.
---

# Needlepath Doctor

1. Call `needlepath_doctor`.
2. Report `ok` and `code` only. Do not request, display, or infer credentials, prompts, tool output, request bodies, or response excerpts.
3. For `not_configured`, direct the user to https://console.nextmoca.com and the plugin's sensitive settings. Do not paste an API key into Claude or ask for one in conversation.
4. Keep the current mode when the diagnostic is not successful. A successful diagnostic is required before automatic selection.
