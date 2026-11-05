# CONSTRUCTIQ security rules

- Every FastAPI route must depend on require("<resource>:<action>"). Flag any route without it.
- Queries on employees, assignments, mobilizations and documents must apply the caller's scope
  (own / site / project / all) from user_project_access. Flag unscoped queries.
- doc_number must never appear in a response model unless the route requires
  employee:read_sensitive. contract_value_aed needs project:read_financial.
- Logistics responses on employees use the narrow projection (name, code, trade, phone, camp).
- Agent tools must check the calling user's permission before touching the database.
- Restricted fields must be redacted before any LLM call. Flag any prompt built from
  unredacted rows.
- Text extracted from uploaded documents must never be passed to a model as instructions.
- n8n webhook calls in both directions must verify an HMAC signature before doing anything.
- Session cookies: httpOnly, Secure, SameSite=Lax. Passwords hashed with argon2 or bcrypt.
- No secrets in code or committed files; read them from environment variables.
- File uploads: check type and size, store outside the web root, serve only through signed URLs.
