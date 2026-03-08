---
name: rara-pt-note
description: RARA PT class-note engine that infers movement intent, correction points, sensory cues, compensation risks, soreness areas, and next-session direction from date/member/exercises/special notes.
---

# RARA PT Note Skill

Load references in this order:
1. `references/knowledge.md`
2. `references/instructions.md`
3. `references/output_format.md`
4. `references/date_title_rules.md`
5. `references/generation_logic.md`
6. `references/movement_dictionary.md`
7. `references/correction_rules.md`
8. `references/theme_rules.md`
9. `references/summary_next_rules.md`
10. `references/file_naming_rules.md`
11. `references/quality_rules.md`
12. `references/system_prompt_compact.md`

Optional:
- `references/examples.md`

Use this tool command for generation/saving:

```powershell
powershell -ExecutionPolicy Bypass -File ./PT_system/tools/create-rara-pt-note.ps1 -Date "<date>" -Member "<member>" -ExerciseText "<exercise1>/<exercise2>/..." -Special "<optional>"
```
