# test-plan: with-plan

## Capability: cap

### Requirement: tool resolution → Scenario: unknown tool id throws

- **Case** T1: resolve nonexistent id throws [negative]
  - Input: resolveTool('nope')
  - Expected: throw /UnknownTool/
  - it(): throws on unknown tool id
