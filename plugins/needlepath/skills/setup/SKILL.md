---
name: needlepath-setup
description: Use when installing or configuring the Needlepath Claude Code plugin for the first time.
---

# Needlepath Setup

1. Call `needlepath_status`.
2. When `configured` is false, direct the user to https://console.nextmoca.com to create an account and configure the credential through the plugin's sensitive settings. Do not paste an API key into Claude or ask the user to provide one in conversation.
3. Explain that eligible tool-result content and bounded provenance from the current tool input are sent to Needlepath SaaS for selection. Prompts are not sent.
4. Call `needlepath_doctor` and report only its metadata result.
5. Leave the mode in `shadow`. Automatic mode is a later, explicit choice after a successful doctor result.
