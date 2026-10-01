# Student Learning Buddy — portable package, version 3.0
Updated 25 September 2026

## Fastest way to use it
1. Open **UNIVERSAL_SYSTEM_PROMPT.txt**.
2. Copy its entire contents into your AI platform's system instructions, assistant instructions or persistent project instructions.
3. Start a new student conversation, for example: “Explain fractions in simple Tamil with one example.”

Keep the instructions active on every turn. The file is UTF-8 plain text with readable Markdown; it has no API, model vendor, internet, file-loader or visual-renderer dependency. Do not replace the prompt with the research report or evaluation checklist.

## Choose the integration that fits
| Your setup | What to use |
|---|---|
| A platform with persistent system/application instructions | Paste UNIVERSAL_SYSTEM_PROMPT.txt into those instructions |
| A platform that imports SKILL.md folders | Import the **student-learning-buddy** folder; preserve its relative paths |
| A plain chat without persistent instructions | Paste the universal prompt as your first message and ask the model to follow it for the session; this is less reliable and may need reapplying in a new chat |
| Your own app calling a model | Include the universal prompt in the model's highest available application instruction channel on every request; keep student messages separate |

The bundle ZIP contains several deployment options. If a skill importer requires a ZIP with one skill folder only, extract **student-learning-buddy** and zip that folder alone. The **agents/openai.yaml** and icon are optional interface metadata; other hosts can ignore them. SKILL.md includes the same core teaching behavior as the universal prompt, plus navigation to optional reference files. The universal prompt removes those navigation instructions so file access is not needed.

Do not install both instruction forms if this would duplicate the whole core in one context. Use one persistent core and add only relevant optional examples. Do not overwrite a host's required safety instructions.

## Optional learner context
No student profile is required to begin. If the learner has volunteered preferences, the app may supply a short session note:

- Explanation language: Tamil
- Script: Tamil
- Exam-answer language: English
- Current topic: equivalent fractions
- Current preference: short steps, no quiz

Do not invent missing values. The student's latest explicit preference takes precedence. Keep context local to the student; avoid sharing one student's history with another. Do not collect IQ, caste, income, exact location, passwords or personal identifiers for tutoring.

## What's included
- **UNIVERSAL_SYSTEM_PROMPT.txt** — complete standalone instructions to copy into an LLM.
- **student-learning-buddy/SKILL.md** — installable skill entry point.
- **student-learning-buddy/references/answer-contract.md** — response formats, multilingual examples and conversational transitions.
- **student-learning-buddy/references/teaching-patterns.md** — subject-specific approaches and misconception repair.
- **student-learning-buddy/references/platform-contract.md** — integration responsibilities, privacy, evaluation and deployment rules.
- **student-learning-buddy/references/research-basis.md** — research sources, evidence limits and teacher-analysis rubric.
- **EVALUATION_CASES.jsonl** — 48 evaluation scenarios with expected behavior; for evaluators, not normal student context.
- **AUDIT_AND_VALIDATION.md** — the dimensions reviewed, latest changes and checks actually performed.
- **MANIFEST.json** — version information and file checksums.

## Check it on your model
Try a novice question, an advanced question, a misconception, an explicit language switch, an unrelated request and a missing-information question. Then run the evaluation scenarios using fresh conversations and held-out variations. For multi-turn cases, construct the stated setup in the conversation before the student input. Do not pass the expected-behavior field to the responding model. These scenarios are test specifications, not an automated runner.

For a real student launch, use native-speaking subject reviewers for every supported language. Compare independent problem-solving and later recall, not just how pleasant an answer sounds. Repeat evaluation after changing models or instructions.

## Important limits
“Portable” means usable with instruction-following LLMs; it does not mean every model has the same quality, language coverage or instruction reliability. Limited context windows can truncate long prompts: reserve space for these instructions, the current question and the answer; do not silently drop core rules. The prompt does not retrain model weights or add unavailable knowledge.

Browsing, speech, images, memory, scheduling, databases and an application interface require real host features. This package is a tutoring behavior skill, not a complete software platform. It does not need those optional features for ordinary text-based teaching.
