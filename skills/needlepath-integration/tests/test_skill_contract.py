from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
EXPECTED_REFERENCES = {
    "integration-contract.md",
    "http-api.md",
    "python-sdk.md",
    "typescript-sdk.md",
    "framework-adapters.md",
}


class NeedlepathIntegrationSkillContractTest(unittest.TestCase):
    def test_skill_is_an_integration_workflow_pinned_to_r4(self):
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("name: needlepath-integration", skill)
        self.assertIn("np-2026-08-r4", skill)
        self.assertIn("shadow", skill.lower())
        self.assertIn("fail open", skill.lower())
        self.assertIn("inspect", skill.lower())

    def test_progressive_disclosure_references_are_complete(self):
        actual = {path.name for path in (ROOT / "references").glob("*.md")}
        self.assertEqual(actual, EXPECTED_REFERENCES)

    def test_all_guidance_uses_r4_and_never_r2_or_r3(self):
        documents = [ROOT / "SKILL.md", *(ROOT / "references").glob("*.md")]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in documents)

        self.assertIn("np-2026-08-r4", combined)
        self.assertNotIn("np-2026-07-r2", combined)
        self.assertNotIn("np-2026-08-r3", combined)
        self.assertNotRegex(combined, r"\br3\b")

    def test_python_reference_applies_only_safe_results(self):
        reference = (ROOT / "references" / "python-sdk.md").read_text(encoding="utf-8")

        self.assertIn("pip install needlepath", reference)
        self.assertIn("result.applied", reference)
        self.assertIn("original_context", reference)
        self.assertIn("shadow=True", reference)

    def test_typescript_reference_applies_only_safe_results(self):
        reference = (ROOT / "references" / "typescript-sdk.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("@nextmoca/needlepath-sdk", reference)
        self.assertIn("result.applied", reference)
        self.assertIn("originalContext", reference)
        self.assertIn("shadow: true", reference)

    def test_framework_reference_names_supported_adapters(self):
        reference = (ROOT / "references" / "framework-adapters.md").read_text(
            encoding="utf-8"
        )

        for package in (
            "needlepath-langchain",
            "needlepath-litellm",
            "llama-index-postprocessor-needlepath",
        ):
            self.assertIn(package, reference)

    def test_http_reference_supports_other_languages_safely(self):
        reference = (ROOT / "references" / "http-api.md").read_text(encoding="utf-8")

        self.assertIn("POST /v1/context/select", reference)
        self.assertIn("Authorization: Bearer", reference)
        self.assertIn("np-2026-08-r4", reference)
        self.assertIn("exact original context", reference.lower())

    def test_non_negotiables_are_stated_in_the_skill(self):
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "integration-contract.md").read_text(encoding="utf-8")

        # fail-open: every non-applied outcome sends the exact original context
        self.assertIn("Apply a selection only when `result.applied` is true", skill)
        self.assertIn("every non-applied outcome", skill)
        # mandatory context stays outside selection
        self.assertIn("Keep system prompts, governance policy, tool schemas, and other mandatory context outside selection", skill)
        self.assertIn("Tool schemas are mandatory context, never candidates", contract)
        # metadata only, never prompts or credentials
        self.assertIn("Emit metadata only. Never log prompts, record content, excerpts, credentials", skill)
        # production request paths never raise on a decline
        self.assertIn("Never use `select_or_raise()` or `selectOrThrow()` in a production request path", skill)
        # shadow first
        self.assertIn("Start in client-side shadow mode", skill)

    def test_public_text_carries_no_internal_identifiers_or_removed_options(self):
        repo = ROOT.parents[1]
        files = [
            *repo.glob("*.md"),
            *(repo / ".github").rglob("*.yml"),
            ROOT / "SKILL.md",
            *(ROOT / "references").glob("*.md"),
            *(ROOT / "agents").glob("*.yaml"),
        ]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in files)

        self.assertNotIn("NEXPE-", combined)
        self.assertNotIn("preserve_recent", combined)
        self.assertNotIn("required_record_ids", combined)
        self.assertNotIn("gate strings", combined)


if __name__ == "__main__":
    unittest.main()
