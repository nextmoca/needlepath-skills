---
name: needlepath-status
description: Use when checking the current Needlepath mode, configuration state, diagnostic result, or selection metadata.
---

# Needlepath Status

1. Call `needlepath_status`.
2. When `configured` is false, direct the user to https://console.nextmoca.com and the plugin's sensitive settings. Do not paste an API key into Claude or ask for one in conversation.
3. Report mode, configuration state, doctor metadata, and selection metadata only.
4. Do not request or display credentials, prompts, tool-result text, selected text, request bodies, response bodies, or raw errors.
5. Describe Needlepath token counts as deterministic service measurements, not Claude-billed usage. Usage across all of a user's keys is also visible at https://console.nextmoca.com.
