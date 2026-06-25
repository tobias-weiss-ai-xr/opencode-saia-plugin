# SAIA Memory Clear

Clears all SAIA memory: cache, usage logs, metrics, preferences, and project context.

## Usage

Trigger this skill when:
- You want to reset all SAIA learning and preferences
- You're experiencing issues with corrupted cache or metrics
- You want to start fresh with a new project setup
- Diagnosing plugin problems

<question>
<questions>
[{"question": "What should be cleared?", "header": "Scope", "multiple": true, "options": [{"label": "Cache only", "description": "Clear model cache (~/.cache/saia/models.json)"}, {"label": "Usage logs", "description": "Clear usage history (usage.jsonl)"}, {"label": "Metrics", "description": "Clear model performance metrics (metrics.json)"}, {"label": "Preferences", "description": "Clear user preferences (saia-preferences.json)"}, {"label": "Project context", "description": "Clear project-specific context (.opencode/saia/context.json)"}, {"label": "Clear everything", "description": "Reset all SAIA memory to factory state"}]}]
</questions>
</question>

## What each option does

- **Cache only**: Forces next model fetch to hit the API (fresh model list)
- **Usage logs**: Clears per-project usage history (forget what you've used)
- **Metrics**: Clears latency/success metrics (reset model performance stats)
- **Preferences**: Clears favorite model and profile settings
- **Project context**: Clears this project's learned patterns

## Factory reset

"Clear everything" deletes all SAIA memory files. On next plugin load:
- Cache rebuilds from API
- Stats start fresh
- No preferences exist (defaults apply)

## Notes

- This is safe - the plugin will rebuild cache on next load
- Does NOT affect your OpenCode config or any other data
- Cannot be undone (except by rebuilding from usage over time)
