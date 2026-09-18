# Common Patterns

## Skeleton Projects

When implementing new functionality:
1. Search for battle-tested skeleton projects
2. Evaluate options directly, or use bounded parallel agents when available and authorized:
   - Security assessment
   - Extensibility analysis
   - Relevance scoring
   - Implementation planning
3. Review useful patterns, licences and dependencies; propose the exact adoption scope for current-user approval
4. Apply only approved changes within the existing project, preserving concurrent work

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:
- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:
- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)
