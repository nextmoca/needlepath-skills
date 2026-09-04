---
name: needlepath-disable
description: Use when turning off automatic Needlepath selection without removing the plugin or changing credentials.
---

# Disable Needlepath

1. Call `needlepath_set_mode` with `{ "mode": "shadow" }`.
2. Report the metadata-only result and use `needlepath_status` if confirmation is needed.
3. Tell the user shadow keeps measuring and never changes a tool result, and that eligible tool-result text is still sent to Needlepath. To stop it being sent at all, set the mode option to `off` in the plugin's settings, which overrides this, or remove the plugin.
4. Do not use emergency pass-through for ordinary disablement. Credential removal belongs in the plugin's sensitive settings, never in conversation or local state.
