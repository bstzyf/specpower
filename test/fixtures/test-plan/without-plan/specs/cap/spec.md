## ADDED Requirements

### Requirement: tool resolution
The system SHALL resolve tool ids.

#### Scenario: unknown tool id throws
- **WHEN** caller resolves a nonexistent tool id
- **THEN** system throws an UnknownTool error
