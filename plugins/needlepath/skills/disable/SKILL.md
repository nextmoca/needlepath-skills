---
name: needlepath-disable
description: Use when turning off Needlepath selection without removing the plugin or changing credentials.
---

# Disable Needlepath

1. Call `needlepath_set_mode` with `{ "mode": "off" }`.
2. Report the metadata-only result and use `needlepath_status` if confirmation is needed.
3. Do not use emergency pass-through for ordinary disablement. Credential removal belongs in the plugin's sensitive settings, never in conversation or local state.
