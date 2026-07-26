# Documentation Index

Last reviewed: 2026-07-27

This index is the authoritative map for repository documentation. A document marked **Historical** is retained as release, discovery, or validation evidence and must not be used as the current implementation specification.

## Start Here

| Document | Status | Purpose |
| --- | --- | --- |
| [Repository README](../README.md) | Current | Primary platform entry point and quick start. |
| [Architecture Constitution](qa-platform-architecture-constitution.md) | Current | Governing architecture and change-control rules. |
| [Architecture Summary](architecture-summary.md) | Current | Concise implemented architecture. |
| [Subsystem Summary](subsystem-summary.md) | Current | Capability, ownership, and maturity matrix. |
| [Current State](inssa-platform-current-state.md) | Current | Repository-backed operational snapshot. |
| [Command Matrix](inssa-command-matrix.md) | Current | CLI and dashboard exposure inventory. |
| [Environment Setup](environment-setup.md) | Current | Environment files, variables, and secret boundaries. |
| [Platform Operations](inssa-platform-operations.md) | Current | Daily operation, startup, execution, and recovery. |
| [Deployment Checklist](deployment-checklist.md) | Current | Release deployment acceptance gate. |
| [CI/CD Pipeline](ci-cd.md) | Current | Required checks, job graph, environment policy, and local reproduction. |
| [Platform Core v1.0 Release Notes](platform-core-v1.0-release-notes.md) | Current | Release scope, limitations, and certification state. |
| [Repository Documentation Certification](repository-documentation-certification.md) | Current | Sprint D audit evidence and verdict. |

## Core Architecture

| Document | Status | Purpose |
| --- | --- | --- |
| [Execution Foundation](qa-execution-foundation.md) | Current | Durable jobs, worker, leases, output isolation, and APIs. |
| [Worker Operations](worker-operations.md) | Current | Worker ownership, lifecycle, and recovery. |
| [Campaign Management](campaign-management.md) | Current | Registry-backed Campaign Library and execution boundaries. |
| [Dashboard Architecture](inssa-dashboard-architecture.md) | Current | Workspaces, API boundaries, auth, and diagnostics. |
| [Dashboard Decisions](inssa-dashboard-decisions.md) | Current | Existing design decisions and rationale. |
| [Dashboard Roadmap](inssa-dashboard-roadmap.md) | Current | Completed platform phases and remaining approved work. |
| [V1 Definition](inssa-v1-definition.md) | Current | Platform Core v1.0 scope and exclusions. |
| [Dashboard Runtime](dashboard-runtime.md) | Current | Doctor, clean, build, start, and runtime recovery. |
| [Operations API Reference](api-reference.md) | Current | Auth, run, evidence, monitoring, notification, and scheduler routes. |

## Evidence And Persistence

| Document | Status | Purpose |
| --- | --- | --- |
| [Evidence Management Architecture](EVIDENCE_MANAGEMENT_ARCHITECTURE.md) | Current | Bundle/item model and complete implemented lifecycle. |
| [Evidence Workspace](evidence-workspace.md) | Current | Explorer, previews, chain of custody, and actions. |
| [Evidence Storage Guide](evidence-storage-guide.md) | Current | Local and Supabase Storage behavior. |
| [Evidence System Certification](EVIDENCE_SYSTEM_CERTIFICATION.md) | Current | Evidence certification record. |
| [Persistence Architecture](platform-persistence-architecture.md) | Current | Local/Supabase stores, relationships, and security. |
| [Persistence Certification](platform-persistence-certification.md) | Current | Migration, RLS, storage, and replay evidence. |
| [Supabase Deployment](supabase-deployment.md) | Current | Fresh project provisioning. |
| [Supabase Migration Guide](supabase-migration-guide.md) | Current | Ordered migration chain and drift rules. |

## Monitoring And Notifications

| Document | Status | Purpose |
| --- | --- | --- |
| [Notification Outbox](notification-outbox.md) | Current | Durable event model; no delivery provider. |
| [Monitoring Framework](monitoring-framework.md) | Current | Monitor definition and policy model. |
| [Scheduler Trigger](scheduler-trigger.md) | Current | Producer-only scheduler and occurrence ledger. |
| [Authentication Monitoring](authentication-monitoring.md) | Current | Current staging/production monitor behavior and safeguards. |

## Security, Deployment, And Release

| Document | Status | Purpose |
| --- | --- | --- |
| [Security Guide](platform-security-guide.md) | Current | Security controls and operating requirements. |
| [Threat Model](platform-threat-model.md) | Current | Assets, boundaries, threats, and mitigations. |
| [Deployment Guide](platform-deployment-guide.md) | Current | Secure deployment sequence. |
| [Release Guide](platform-release-guide.md) | Current | Mandatory release gates. |
| [Security Certification](platform-security-certification.md) | Current | Sprint C evidence and unresolved blocker. |
| [Known Limitations](known-limitations.md) | Current | Explicit platform and deployment limitations. |
| [Release Gate Gitignore Audit](release-gate-gitignore-audit.md) | Historical | 2026-06-01 repository audit evidence; superseded by current security certification. |

## INSSA QA And Product References

| Document | Status | Purpose |
| --- | --- | --- |
| [INSSA QA Operations Guide](inssa-qa-operations-guide.md) | Current product reference | Detailed INSSA lifecycle/security operations. |
| [Live Staging Lifecycle](inssa-live-staging-lifecycle.md) | Current product reference | Mutation gates and lifecycle behavior. |
| [Security Campaign](inssa-security-campaign.md) | Current product reference | OWASP campaign implementation and outputs. |
| [Security Findings](inssa-security-findings.md) | Current findings record | Confirmed INSSA product findings. |
| [Risk Matrix](inssa-risk-matrix.md) | Current findings record | Product risk register. |
| [Product Behavior Audit](inssa-product-behavior-audit.md) | Historical observation | Point-in-time black-box staging behavior. |
| [Contact Share State Machine](inssa-contact-share-state-machine.md) | Historical observation | Phase 6 contact workflow evidence. |
| [Engineering Review](inssa-engineering-review.md) | Historical handoff | Earlier engineering findings package. |
| [Platform Handoff 2026](inssa-platform-handoff-2026.md) | Current | Maintainer handoff and protected boundaries. |

## Wazuh And SIEM Operations

| Document | Status | Purpose |
| --- | --- | --- |
| [SIEM Architecture](inssa-siem-architecture.md) | Current | Event flow and trust boundaries. |
| [SIEM Operations](inssa-siem-operations.md) | Current | Daily Wazuh operation and verification. |
| [SIEM Runbook](inssa-siem-runbook.md) | Current | Finding response procedures. |
| [SIEM Disaster Recovery](inssa-siem-disaster-recovery.md) | Current | Recovery and rollback. |
| [SIEM Release Gate](inssa-siem-release-gate.md) | Current | SIEM deployment acceptance. |
| [Alert Routing](inssa-alert-routing.md) | Current design | Routing policy; external platform dispatch is separate from the Notification Outbox. |
| [Alert Runbook](inssa-alert-runbook.md) | Current design | Wazuh notification troubleshooting. |
| [Notification Testing](inssa-notification-testing.md) | Current design | Wazuh routing validation scenarios. |
| [Wazuh Integration](wazuh-inssa-integration.md) | Current | Decoder/rule/dashboard integration. |
| [Wazuh Ingestion](wazuh-inssa-ingestion.md) | Current | Authenticated ingestion deployment. |
| [Wazuh Decoder](wazuh-inssa-decoder.md) | Current deployment spec | Ready-to-paste decoder XML. |
| [Wazuh Rules](wazuh-inssa-rules.md) | Current deployment spec | Ready-to-paste rule XML. |
| [SIEM Navigation](../wazuh/SIEM_NAVIGATION.md) | Current operator reference | Wazuh links and investigation shortcuts. |

## Wazuh Dashboard Design And Inventory

These documents describe the external Wazuh/OpenSearch experience, not the local Next.js Operations Dashboard.

| Document | Status | Purpose |
| --- | --- | --- |
| [Dashboard Engineering](inssa-dashboard-engineering.md) | Current external design | Wazuh saved searches and dashboard fields. |
| [Dashboard Build Guide](inssa-dashboard-build-guide.md) | Current external design | Wazuh visualization construction. |
| [Dashboard Runbook](inssa-dashboard-runbook.md) | Current external operations | Wazuh dashboard maintenance. |
| [Observability Dashboard](inssa-observability-dashboard.md) | Current external design | Wazuh observability model. |
| [Security Center](inssa-security-center.md) | Historical deployment record | Saved-object implementation snapshot. |
| [Security Center Options](inssa-security-center-options.md) | Historical decision record | Option analysis that selected dashboard collection. |
| [Daily Operations](inssa-daily-operations.md) | Current external operations | Wazuh review cadence. |
| [Operator Experience](inssa-operator-experience.md) | Current external operations | Wazuh operator workflow. |
| [Quick Start](inssa-quick-start.md) | Current external operations | Five-minute Wazuh orientation. |
| [Entry Point Review](inssa-entry-point-review.md) | Historical decision record | Discoverability assessment. |
| [Default Route Decision](inssa-default-route-decision.md) | Historical decision record | No-go/default-route analysis. |
| [Wazuh Cleanup Assessment](wazuh-cleanup-assessment.md) | Historical inventory | Non-destructive saved-object assessment. |
| [Wazuh UI Inventory](wazuh-ui-inventory.md) | Historical inventory | 2026-06-08 UI inventory. |
| [Wazuh Navigation Map](wazuh-navigation-map.md) | Historical inventory | 2026-06-08 navigation snapshot. |

## Historical Release And Validation Records

| Document | Status | Purpose |
| --- | --- | --- |
| [Authentication Completion Report](DASHBOARD_AUTHENTICATION_COMPLETION_REPORT.md) | Historical validation | Role/login acceptance evidence. |
| [Authenticated Evidence Validation](EVIDENCE_BUNDLE_AUTHENTICATED_VALIDATION_REPORT.md) | Historical blocked result | Preceded successful authentication completion; do not use as current status. |
| [Evidence Bundle Integrity Report](EVIDENCE_BUNDLE_INTEGRITY_REPORT.md) | Historical validation | Phase 2.5 serving evidence. |
| [Platform Stabilization Validation](inssa-platform-stabilization-validation.md) | Historical validation | Read-only V1 regression evidence. |
| [Platform Validation](inssa-platform-validation.md) | Historical validation | Phase 14 point-in-time checks. |
| [Final Program Report](inssa-final-program-report.md) | Historical program summary | Earlier INSSA program completion state. |
| [Final Platform Status](inssa-final-platform-status.md) | Historical status | Superseded by v1.0 release notes and security certification. |
| [Release Summary](inssa-release-summary.md) | Historical release summary | Earlier INSSA infrastructure release. |
| [Documentation Audit](inssa-documentation-audit.md) | Current audit | Sprint D classification and cleanup report. |

## Archived Duplicate Removal

The following duplicate documents were removed during Sprint D:

- `inssa-current-state.md`, superseded by `inssa-platform-current-state.md`.
- `inssa-handoff-2026.md`, superseded by `inssa-platform-handoff-2026.md`.

No unique validation evidence was removed.
