# Campaign Management

## Purpose

The Campaign Library is a presentation layer over the existing command registry. It makes campaign purpose, product, risk, environment, outputs, approval state, and execution readiness visible without introducing a second execution model.

## Definition Source

Executable definitions remain in `dashboard/lib/inssa-ops/command-registry.ts`. Disabled future definitions are presentation metadata in the dashboard client. The runner accepts only enabled registry keys.

Campaign metadata includes:

- name and operator description
- command type and npm script
- risk and target environment
- staging mutation flag
- expected findings and reports
- lifecycle artifact requirement
- timeout and enabled state

## Categories

- Safe Tests
- Security
- Lifecycle
- Artifact Validation
- Operations
- SIEM

The Campaign Library also exposes product filters for INSSA, Localman, KBean, and future products. Only INSSA has managed executable definitions in v1.0.

## Execution Rules

- Viewer: cannot execute.
- Operator: enabled safe/read-only commands except healthcheck.
- Admin: all enabled commands, including healthcheck.
- Lifecycle artifact validators require an explicit or latest validation-ready artifact.
- Live lifecycle, cross-user, reveal-later security, and SIEM send remain disabled.
- No user-provided npm script, path, environment, argument, or shell command is accepted.

## Relationship To Monitoring

Monitoring definitions reference registry campaign keys. The scheduler may enqueue only a key that exists and matches the definition environment. It never creates an alternative campaign definition or command.

## Product Expansion

Adding a product requires approved Playwright coverage and a fixed registry entry. Product awareness does not permit generic command execution. Localman and KBean dashboard execution remain future work.
