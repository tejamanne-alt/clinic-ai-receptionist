# Prompts

R3: every prompt lives here as a versioned file — never as an inline string
in code. I3: the three prompt classes stay in separate files, never blended:

| Directory     | Class      | Model tier                  | Lands in |
|---------------|------------|-----------------------------|----------|
| `voice/`      | VOICE      | low-latency                 | Phase 1 (`callflow.te-en.md`, human-gated by Teja) |
| `analysis/`   | ANALYSIS   | quality (post-call)         | Phase 2 |
| `extraction/` | EXTRACTION | structured output           | Phase 2 |
| `bakeoff/`    | test fixtures (not runtime prompts) | — | Phase 0 |

Versioning: prompt files carry a `version:` header line; breaking changes bump
it and the call-flow references the version it was tested against.
