# SAIA Model Optimizer

Recommends optimal model choices based on your usage history, project context, and latency metrics.

## Usage

Trigger this skill when:
- You want to save money by using cheaper models for simple tasks
- You need faster response times for quick edits
- You're unsure which model best fits your current task type

## How it works

Analyzes your usage patterns from `~/.cache/saia/usage.jsonl` and metrics from `~/.cache/saia/metrics.json` to recommend:

1. **Task-aware recommendations**: Coding → specialized fast models; Research → larger reasoning models
2. **Latency-aware**: Avoids models with consistently high response times
3. **Success-aware**: Prefers models with high success rates for your workloads
4. **Context-aware**: Considers your project's primary file types (`.ts`, `.md`, etc.)

## Example recommendations

```
Optimal models for your project (src/):

Coding tasks:     glm-4.7 (fast, 99.2% success)
Documentation:    glm-4-plus (good reasoning, 98.5% success)
Vision tasks:     glm-4v (vision-capable, 97.1% success)
General:          glm-flash (fastest, 96.8% success)
```

## Notes

- Learns from your actual usage, not theoretical benchmarks
- Updates automatically as you use the plugin
- Recommendations can be overridden with your preferences
- Requires at least 10+ uses per model for reliable statistics
