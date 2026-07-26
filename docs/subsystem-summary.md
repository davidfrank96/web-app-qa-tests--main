# Platform Core v1.0 Subsystem Summary

Last reviewed: 2026-07-21

| Subsystem | Status | Primary implementation | Current limitation |
| --- | --- | --- | --- |
| Authentication | Implemented | Supabase email/password and magic link | Provider/user provisioning is deployment-owned. |
| RBAC | Implemented | Server-side viewer/operator/admin guards | No custom role-management UI. |
| Command Registry | Implemented | Fixed safe/read-only command definitions | Live mutation commands remain disabled. |
| Durable Jobs | Implemented | Persistent claims, leases, heartbeats, idempotency | One active job globally. |
| Worker | Implemented | Dedicated process executes existing npm scripts | Single worker concurrency by design. |
| Run Output | Implemented | Immutable `run-output/<runId>/` manifest | No retention engine. |
| Run Metadata | Implemented | Local JSON or Supabase | No automatic backend migration. |
| Incremental Logs | Implemented | JSONL or Supabase rows | No full-text search. |
| Artifacts | Implemented compatibility | Existing APIs and classification | Historical shared outputs remain compatibility inputs. |
| Evidence Bundles | Implemented | Bundle/item metadata and chain of custody | Historical runs are not automatically backfilled. |
| Bundle Serving | Implemented | Authenticated relative-file route | Filesystem remains serving source. |
| Durable Evidence Storage | Implemented | Local or private Supabase Storage | Direct durable-object serving is not implemented. |
| Evidence Workspace | Implemented | Bundle explorer, previews, related evidence | No retention/archive controls. |
| Reports | Implemented | Security/lifecycle renderers and Playwright bundle | Reports remain derived evidence. |
| Notification Outbox | Implemented | Durable event journal and dispatcher contract | No external delivery provider. |
| Monitoring Framework | Implemented | Product-aware definitions and policies | Definition editing UI is read-only. |
| Scheduler | Implemented | Hourly/daily/weekly occurrence evaluation | No dashboard controls. |
| Authentication Monitoring | Implemented | Password, Google, and Apple checks | Production disabled by default; real provider credentials required. |
| SIEM Export | Implemented | Metadata normalization and campaign summaries | Dashboard send disabled. |
| Wazuh Ingestion | Implemented | Authenticated JSONL receiver | Live deployment validation is environment-owned. |
| Runtime Doctor | Implemented | Version, env, manifest, route, worker checks | Does not replace deployment monitoring. |
| Persistence Provisioning | Implemented | Migration verification and private bucket creation | Linked-project deployment still requires operator approval. |
| Campaign Library | Implemented presentation | Product-aware catalog over registry | Localman/KBean managed campaigns are not registered. |
| Theme System | Implemented | Dark/light semantic tokens | No per-product themes. |

Architecture impact for Platform Core v1.0: the execution, evidence, persistence, monitoring, and security foundations are implemented without replacing existing Playwright or campaign scripts.
