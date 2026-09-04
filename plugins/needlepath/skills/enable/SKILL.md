---
name: needlepath-enable
description: Use when enabling automatic Needlepath selection after a readiness check.
---

# Enable Needlepath

1. Call `needlepath_doctor` first.
2. When it reports `not_configured`, direct the user to https://console.nextmoca.com and the plugin's sensitive settings. Do not paste an API key into Claude or ask for one in conversation.
3. Continue only when it reports a successful doctor result.
4. Call `needlepath_set_mode` with `{ "mode": "auto" }`.
5. If the diagnostic or mode control does not succeed, keep the existing safe mode and report its metadata-only code. Do not bypass the doctor gate.
