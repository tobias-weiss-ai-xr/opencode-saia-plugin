# SAIA Profile Switcher

Switches between predefined model profiles: production, development, and budget.

## Usage

Trigger this skill when:
- You want to test cheaper/budget models during development
- You need to force a production-grade model for critical work
- You're switching between prototyping and final edits

## Profiles

### Production
- Highest quality models (glm-5.3-flash, glm-4-plus)
- Best for critical code reviews, architecture decisions
- Higher cost, best quality
- Default profile

### Development
- Balanced models (glm-4, glm-flash)
- Good for日常 coding, quick iterations
- Faster responses, moderate quality
- Recommended for active development

### Budget
- Cheapest/fastest models (glm-flash-only)
- Ideal for quick edits, syntax checks, refactors
- Lowest cost, acceptable quality
- Good for large-scale codebase operations

## Profile persistence

Your profile choice is saved in `~/.config/opencode/saia-preferences.json` and persists across sessions.

## Project-specific profiles

You can override the global profile at the project level by editing `.opencode/saia/context.json` with a `"profile"` field.

## Example

```bash
# Switch to budget mode
/opencode/skills/saia-switch-profile
Choose: budget

# Result: All completions now use glm-flash (cheapest, fastest)
# Saved: { "profile": "budget" } in preferences
```
