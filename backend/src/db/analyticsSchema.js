/**
 * Analytics & visitor schema helpers (Postgres).
 */

import { getPool, isPostgresEnabled } from './postgres.js'

export async function ensureAnalyticsSchema() {
  if (!isPostgresEnabled()) return false
  const db = getPool()

  await db.query(`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_user_agent TEXT,
      ADD COLUMN IF NOT EXISTS last_device TEXT,
      ADD COLUMN IF NOT EXISTS last_browser TEXT,
      ADD COLUMN IF NOT EXISTS activity_status TEXT NOT NULL DEFAULT 'inactive';

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_agent TEXT,
      device TEXT,
      browser TEXT,
      ip_hash TEXT,
      path TEXT,
      UNIQUE (tenant_id, session_id)
    );

    CREATE INDEX IF NOT EXISTS user_sessions_tenant_idx
      ON user_sessions (tenant_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS user_sessions_started_idx
      ON user_sessions (started_at DESC);

    CREATE TABLE IF NOT EXISTS visitors (
      visitor_id TEXT PRIMARY KEY,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      linked_tenant_id TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
      visit_count INTEGER NOT NULL DEFAULT 1,
      page_view_count INTEGER NOT NULL DEFAULT 0,
      is_bot BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS visitors_last_seen_idx
      ON visitors (last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS visitors_linked_tenant_idx
      ON visitors (linked_tenant_id);

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_agent TEXT,
      device TEXT,
      browser TEXT,
      ip_hash TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      engaged BOOLEAN NOT NULL DEFAULT FALSE,
      landing_path TEXT,
      referrer TEXT
    );

    CREATE INDEX IF NOT EXISTS visitor_sessions_visitor_idx
      ON visitor_sessions (visitor_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS visitor_sessions_started_idx
      ON visitor_sessions (started_at DESC);

    CREATE TABLE IF NOT EXISTS page_views (
      id TEXT PRIMARY KEY,
      visitor_id TEXT REFERENCES visitors(visitor_id) ON DELETE SET NULL,
      session_id TEXT,
      tenant_id TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
      path TEXT NOT NULL,
      title TEXT,
      referrer TEXT,
      engaged BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS page_views_created_idx
      ON page_views (created_at DESC);
    CREATE INDEX IF NOT EXISTS page_views_visitor_idx
      ON page_views (visitor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS page_views_session_idx
      ON page_views (session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS analytics_daily (
      day DATE PRIMARY KEY,
      unique_visitors INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      new_visitors INTEGER NOT NULL DEFAULT 0,
      returning_visitors INTEGER NOT NULL DEFAULT 0,
      new_users INTEGER NOT NULL DEFAULT 0,
      active_users INTEGER NOT NULL DEFAULT 0,
      logins INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics_weekly (
      week_start DATE PRIMARY KEY,
      unique_visitors INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      new_visitors INTEGER NOT NULL DEFAULT 0,
      returning_visitors INTEGER NOT NULL DEFAULT 0,
      new_users INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics_monthly (
      month_start DATE PRIMARY KEY,
      unique_visitors INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      new_visitors INTEGER NOT NULL DEFAULT 0,
      returning_visitors INTEGER NOT NULL DEFAULT 0,
      new_users INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  return true
}
