# Security Policy

## Supported Versions

Security fixes are primarily applied to the latest stable line.

| Version | Supported |
| --- | --- |
| 2.0.x | Yes |
| 1.2.x | Maintenance only |
| < 1.2.0 | No |

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use GitHub Private Vulnerability Reporting:

- https://github.com/GreenSheep01201/claw-empire/security/advisories/new

If private reporting is unavailable in your environment, open a minimal issue without exploit details and ask a maintainer for a private channel.

## Response Expectations

- Initial triage target: within 72 hours
- Follow-up status updates: provided during investigation
- Fix publication: coordinated with impact and patch readiness

## Scope

Typical in-scope areas include:

- Auth/session boundaries
- OAuth token handling and encryption flows
- `/api/inbox` secret validation and webhook handling
- Command execution paths, worktree operations, and update flows
- Secrets handling in logs/configuration
- File attachment upload/download path traversal
- Vector search injection via embedded content

## Security Controls

- **Security headers**: CSP, X-Frame-Options DENY, HSTS, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin — all responses
- **Rate limiting**: In-memory rate limiter on `/api/` routes (200 req/min general, 20 req/min for auth/inbox/OAuth)
- **CSRF**: HMAC-based token derivation via `x-csrf-token` header on mutation requests
- **Login gate**: Optional browser-side login required before accessing the dashboard
- **CORS**: Origin allowlist + suffix validation (auto-normalized `.` prefix to prevent subdomain spoofing)
- **Path validation**: Project paths resolved to absolute and validated against `PROJECT_PATH_ALLOWED_ROOTS`
- **File upload**: 50MB per-file limit, 5 files per request, stored with UUID filenames to prevent path traversal
