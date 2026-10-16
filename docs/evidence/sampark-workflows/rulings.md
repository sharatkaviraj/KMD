# Implementation rulings

These are the four controller rulings recorded during the Sampark workflow work. External campaign setup remains intentionally pending; the exact development-database packet was approved separately on 16 October 2026 at 11:27:28 UTC. Approval does not replace the remaining review, CI and release checks.

| Decision | Reason | Cost if wrong |
| --- | --- | --- |
| Use sequential GPT-6 Astra workers with extra-high reasoning for implementation and independent review. | The user requested that model; worker selection is explicit, while the parent-turn model is not exposed. | Additional review time; no product-policy change. |
| Use equivalent PowerShell bookkeeping when bundled Bash is unavailable. | Bash is not on the Windows shell's PATH. | Ledger formatting differences only. |
| Preserve the existing legitimate office direct-photo policy; require administrator approval for every teacher photo proposal. | The requested approval gate applies to teacher changes. Existing fee-client authority already blocks native teachers and preserves office access; removing unrelated office privileges would expand scope. | The school may later request a broader administrator-only policy for direct office photo changes. |
| Use six explicit task campaign contracts: initial/reminder multiplied by English/Hindi/both, frozen to the reviewed recipient language. | This preserves existing language preferences and an accurate message preview. | Six external campaign configurations/approvals instead of two; a later fixed-bilingual simplification may be preferable. |

No actual external campaign creation, provider configuration or message send is implied by the local campaign contracts. The requested Integrations pending state keeps automated task delivery unavailable until that separate setup is complete.
