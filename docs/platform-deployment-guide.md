# QA Operations Platform Deployment Guide

## Secure Deployment Order

1. Provision the dashboard/worker host with a supported Node release and Playwright browser dependencies.
2. Apply all Supabase migrations and provision the private evidence bucket using [Supabase Deployment](./supabase-deployment.md).
3. Install server-only environment variables with owner-only permissions. Keep `SUPABASE_SERVICE_ROLE_KEY`, test credentials, and SIEM credentials out of browser variables and source control.
4. Run `npm ci` at the repository root and in `dashboard/`.
5. Run `npm run dashboard:doctor`, `npm run dashboard:build`, and the platform regression tests.
6. Start the dashboard supervisor, or deploy Next.js, worker, and scheduler as separately supervised processes using the same repository version and environment.
7. Install Wazuh ingestion with `/etc/inssa-ingestion.env`, TLS termination, and explicit Authorization forwarding.
8. Complete the security release gate before admitting operators.

## Authentication Monitor Configuration

Provision Authentication Monitoring credentials in the server-only `dashboard/.env.local` file using the canonical `AUTH_MONITOR_*` names documented in [Environment Setup](./environment-setup.md). Next.js, the execution worker, the scheduler, and the authentication wrapper all load this dashboard environment through Next's environment loader.

Do not store monitor credentials in root `.env` or `.env.inssa.live-staging`. Restart the dashboard supervisor after changing `dashboard/.env.local` so the long-running worker and scheduler receive the updated environment.

## Wazuh Credential Provisioning

```bash
sudo sh -c 'umask 077; printf "INSSA_INGEST_SHARED_TOKEN=%s\n" "$(openssl rand -hex 32)" > /etc/inssa-ingestion.env'
sudo chown root:root /etc/inssa-ingestion.env
sudo chmod 0600 /etc/inssa-ingestion.env
sudo systemctl daemon-reload
sudo systemctl restart inssa-ingestion
```

Configure the sender with the same value as `SIEM_WAZUH_TOKEN` through its secret manager. Do not put credentials in shell history, service command lines, Nginx configuration, URLs, or repository files.

## Required Protections

- HTTPS for dashboard and Wazuh ingress.
- Private Supabase evidence bucket and service-role-only persistence writes.
- `INSSA_URL=https://staging.inssa.us` for approved mutation-capable QA commands.
- `AUTH_MONITOR_ALLOW_PRODUCTION=1` and `AUTH_MONITOR_PRODUCTION_CONFIRMATION=inssa.us` only on an explicitly approved production monitoring deployment.
- Host filesystem permissions restricting `.env.local`, local metadata, run output, and service environment files.
- No public access to worker, scheduler, Supabase service credentials, or port `8088`.

## Verification And Rollback

Use [Deployment Checklist](./deployment-checklist.md) and [Platform Release Guide](./platform-release-guide.md) for validation. On failure, stop the affected service, retain logs without publishing credential material, restore the prior lockfile/build artifact, and rotate any credential that may have appeared in output. Never re-enable anonymous ingestion as a recovery measure.
