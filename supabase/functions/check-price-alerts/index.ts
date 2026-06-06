/**
 * check-price-alerts Edge Function — HTTP-only FIFO scheduler
 *
 * Runtime:
 * - External HTTP POST trigger only (Bearer CRON_SECRET)
 *
 * Design goals:
 * - FIFO queueing by oldest last_checked_at
 * - 1-hour max drift target (alerts become due every 60 minutes)
 * - Queue must advance even on scrape/API failures
 * - Per-alert failures are isolated and logged to DB
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import {
  runPricingPipeline,
  type PricingPipelineResult,
} from "../_shared/pricingPipeline.ts";

type AlertRow = {
  id: string;
  user_id: string;
  query: string;
  target_price: number;
  status: "active" | "triggered" | "expired";
  last_checked_at: string | null;
  next_check_at?: string | null;
  push_token: string | null;
};

type BatchOptions = {
  source: "http";
  batchLimit: number;
  force: boolean;
};

type BatchSummary = {
  source: "http";
  considered: number;
  claimed: number;
  processed: number;
  skippedDueToDeadline: number;
  triggered: number;
  errors: number;
  terminatedEarly: boolean;
  elapsedMs: number;
  startedAt: string;
  finishedAt: string;
};

// ---------------------------------------------------------------------------
// Environment & clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SERPAPI_KEY = Deno.env.get("SERPAPI_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

if (!SERPAPI_KEY) {
  console.warn("[check-price-alerts] SERPAPI_KEY is missing; price checks may fail.");
}
if (!GEMINI_API_KEY) {
  console.warn("[check-price-alerts] GEMINI_API_KEY is missing; pipeline quality may degrade.");
}
if (!CRON_SECRET) {
  console.warn("[check-price-alerts] CRON_SECRET is missing; HTTP trigger will reject all requests.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Alerts become due again after 60 minutes. */
const DUE_WINDOW_MINUTES = Number(Deno.env.get("PRICE_ALERT_DUE_MINUTES") ?? "60");

/** Throughput tuning: default 20 per run (fits 60s serverless ceiling with parallelism). */
const DEFAULT_BATCH_LIMIT = Number(Deno.env.get("PRICE_ALERT_BATCH_LIMIT") ?? "20");

/** Hard cap to protect runtime from abusive HTTP override values. */
const MAX_BATCH_LIMIT = Number(Deno.env.get("PRICE_ALERT_BATCH_LIMIT_MAX") ?? "500");

/** Parallel workers per batch. */
const DEFAULT_CONCURRENCY = Number(Deno.env.get("PRICE_ALERT_CONCURRENCY") ?? "8");
const MAX_CONCURRENCY = Number(Deno.env.get("PRICE_ALERT_CONCURRENCY_MAX") ?? "20");

/** Stop before platform timeout (60s) to return a clean summary. */
const MAX_BATCH_RUNTIME_MS = Number(Deno.env.get("PRICE_ALERT_MAX_RUNTIME_MS") ?? "50000");

/** Adaptive scheduler gate (requires DB migration columns/functions). */
const ADAPTIVE_ENABLED = /^true$/i.test(Deno.env.get("PRICE_ALERT_ADAPTIVE_ENABLED") ?? "false");

/** Expo Push API endpoint */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function clampBatchLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BATCH_LIMIT;
  return Math.min(Math.floor(value), MAX_BATCH_LIMIT);
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CONCURRENCY;
  return Math.min(Math.floor(value), MAX_CONCURRENCY);
}

function dueCutoffIso(): string {
  const ms = DUE_WINDOW_MINUTES * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function truncate(value: string, len = 500): string {
  return value.length <= len ? value : `${value.slice(0, len - 3)}...`;
}

/** Reject null, undefined, non-finite, or zero prices before writing price_snapshots. */
function isValidSnapshotPrice(price: unknown): price is number {
  if (price === null || price === undefined) return false;
  const n = Number(price);
  return Number.isFinite(n) && n > 0;
}

async function logAlertErrorToDb(
  alert: AlertRow,
  stage: string,
  err: unknown,
): Promise<void> {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown");
  const message = truncate(`[${stage}] ${raw}`, 700);

  // Write to the dedicated error audit table — price_snapshots stays clean.
  const { error: insertError } = await supabase.from("price_check_errors").insert({
    alert_id: alert.id,
    user_id: alert.user_id,
    stage,
    message,
  });

  if (insertError) {
    console.error(
      `[check-price-alerts][alert:${alert.id.slice(0, 8)}] Failed price_check_errors insert:`,
      insertError.message,
    );
  }

  // Stamp last_error_at so the client can surface the error state without
  // an extra query (Option A: already on the alerts row from SELECT *).
  const { error: stampError } = await supabase
    .from("price_alerts")
    .update({ last_error_at: new Date().toISOString() })
    .eq("id", alert.id);

  if (stampError) {
    console.error(
      `[check-price-alerts][alert:${alert.id.slice(0, 8)}] Failed last_error_at stamp:`,
      stampError.message,
    );
  }
}

// ---------------------------------------------------------------------------
// Expo Push helper
// ---------------------------------------------------------------------------

async function sendExpoPush(
  pushToken: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken[")) {
    console.warn("[check-price-alerts] Invalid push token, skipping send");
    return;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        sound: "default",
        channelId: "price-alerts",
        data,
      }),
    });

    const json = await res.json();
    const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
    if (ticket?.status === 'error') {
      console.warn('[check-price-alerts] Expo push error:', ticket.message, ticket.details ?? '');
    } else if (ticket?.status === 'ok') {
      console.log('[check-price-alerts] Push sent, ticket:', ticket.id);
    } else if (!res.ok) {
      console.warn('[check-price-alerts] Expo push HTTP error:', res.status, JSON.stringify(json));
    }
  } catch (err) {
    console.warn(
      "[check-price-alerts] Push send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Core alert-processing logic
// ---------------------------------------------------------------------------

async function fetchDueAlerts(batchLimit: number, force: boolean): Promise<AlertRow[]> {
  if (ADAPTIVE_ENABLED && !force) {
    const nowIso = new Date().toISOString();
    const { data: adaptiveData, error: adaptiveError } = await supabase
      .from("price_alerts")
      .select("id,user_id,query,target_price,status,last_checked_at,next_check_at,push_token")
      .eq("status", "active")
      .lte("next_check_at", nowIso)
      .order("next_check_at", { ascending: true, nullsFirst: true })
      .limit(batchLimit);

    if (!adaptiveError) {
      return (adaptiveData ?? []) as AlertRow[];
    }

    console.warn(
      "[check-price-alerts] Adaptive due query failed; falling back to legacy last_checked_at mode:",
      adaptiveError.message,
    );
  }

  const cutoff = dueCutoffIso();

  let query = supabase
    .from("price_alerts")
    .select("id,user_id,query,target_price,status,last_checked_at,push_token")
    .eq("status", "active")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(batchLimit);

  if (!force) {
    query = query.or(`last_checked_at.is.null,last_checked_at.lte.${cutoff}`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch due alerts: ${error.message}`);
  }
  return (data ?? []) as AlertRow[];
}

async function claimAlert(alert: AlertRow, claimIso: string, force: boolean): Promise<boolean> {
  const cutoff = dueCutoffIso();
  let q = supabase
    .from("price_alerts")
    .update({ last_checked_at: claimIso })
    .eq("id", alert.id)
    .eq("status", "active")
    .select("id");

  if (!force) {
    q = q.or(`last_checked_at.is.null,last_checked_at.lte.${cutoff}`);
  }

  const { data, error } = await q;
  if (error) {
    console.error(
      `[check-price-alerts][alert:${alert.id.slice(0, 8)}] Claim failed:`,
      error.message,
    );
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function processOneAlert(alert: AlertRow): Promise<{ triggered: boolean; errored: boolean }> {
  const tag = `[alert:${alert.id.slice(0, 8)}]`;
  let triggered = false;
  let errored = false;

  try {
    console.log(`${tag} Checking query="${alert.query}" target=$${alert.target_price}`);

    const result = await runPricingPipeline({
      query: alert.query,
      maxOffers: 5,
      includeOutOfStock: false,
    });

    if ("status" in result && result.status === "error") {
      errored = true;
      await logAlertErrorToDb(alert, "pipeline", result.message);
      console.error(`${tag} Pipeline error: ${result.message}`);
      return { triggered, errored };
    }

    const pipelineResult = result as PricingPipelineResult;
    const { lowestPrice, lowestRetailer, offers } = pipelineResult;

    if (!isValidSnapshotPrice(lowestPrice)) {
      errored = true;
      const detail = lowestPrice === null || lowestPrice === undefined
        ? "null/undefined"
        : String(lowestPrice);
      await logAlertErrorToDb(
        alert,
        "invalid_price",
        `Pipeline returned invalid lowest price (${detail}); snapshot rejected`,
      );
      console.error(`${tag} Rejected invalid snapshot price: ${detail}`);
      return { triggered, errored };
    }

    const bestOffer = offers.find((o) => o.price === lowestPrice);
    const productUrl = bestOffer?.url ?? null;

    const { error: snapshotError } = await supabase
      .from("price_snapshots")
      .insert({
        alert_id: alert.id,
        user_id: alert.user_id,
        lowest_price: lowestPrice,
        retailer: lowestRetailer,
        product_url: productUrl,
      });

    if (snapshotError) {
      errored = true;
      await logAlertErrorToDb(alert, "snapshot_insert", snapshotError.message);
      console.error(`${tag} Snapshot insert failed: ${snapshotError.message}`);
      return { triggered, errored };
    }

    // Successful snapshot — clear any previous error state so the card
    // stops showing "Retailer temporarily unreachable" on the next read.
    void supabase
      .from("price_alerts")
      .update({ last_error_at: null })
      .eq("id", alert.id)
      .then(({ error: clearErr }) => {
        if (clearErr) {
          console.warn(`${tag} Failed to clear last_error_at:`, clearErr.message);
        }
      });

    const isTriggered =
      lowestPrice !== null &&
      Number.isFinite(lowestPrice) &&
      Number(lowestPrice) > 0 &&
      Number(lowestPrice) <= Number(alert.target_price);

    if (isTriggered) {
      triggered = true;
      console.log(
        `${tag} TRIGGERED: $${lowestPrice} <= target $${alert.target_price} @ ${lowestRetailer}`,
      );

      const { error: triggerUpdateError } = await supabase
        .from("price_alerts")
        .update({ status: "triggered" })
        .eq("id", alert.id)
        .eq("status", "active");

      if (triggerUpdateError) {
        errored = true;
        await logAlertErrorToDb(alert, "trigger_update", triggerUpdateError.message);
        console.error(`${tag} Trigger status update failed: ${triggerUpdateError.message}`);
      }

      if (alert.push_token) {
        await sendExpoPush(
          alert.push_token,
          "Price Drop Alert 🎉",
          `${alert.query} dropped to $${lowestPrice} at ${lowestRetailer ?? "a retailer"}!`,
          { screen: "MyAlerts", alertId: alert.id },
        );
      }
    } else {
      console.log(`${tag} No trigger: lowest=$${lowestPrice} vs target=$${alert.target_price}`);
    }
  } catch (err) {
    errored = true;
    await logAlertErrorToDb(alert, "unexpected", err);
    console.error(`${tag} Unexpected error:`, err instanceof Error ? err.message : err);
  } finally {
    if (ADAPTIVE_ENABLED) {
      const { error: refreshError } = await supabase
        .rpc("refresh_price_alert_priority", { p_alert_id: alert.id });

      if (refreshError) {
        console.warn(`${tag} Adaptive refresh RPC failed; falling back to last_checked_at update: ${refreshError.message}`);
        const { error: fallbackUpdateError } = await supabase
          .from("price_alerts")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", alert.id);
        if (fallbackUpdateError) {
          errored = true;
          console.error(`${tag} Finally fallback update failed: ${fallbackUpdateError.message}`);
        }
      }
    } else {
      // Queue liveness guarantee for legacy mode.
      const { error: finalUpdateError } = await supabase
        .from("price_alerts")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", alert.id);

      if (finalUpdateError) {
        errored = true;
        console.error(`${tag} Finally last_checked_at update failed: ${finalUpdateError.message}`);
      }
    }
  }

  return { triggered, errored };
}

async function processAlertBatch(options: BatchOptions): Promise<BatchSummary> {
  const startMs = Date.now();
  const deadlineMs = startMs + MAX_BATCH_RUNTIME_MS;
  const startedAt = new Date().toISOString();
  console.log(
    `[check-price-alerts] Start source=${options.source} limit=${options.batchLimit} force=${options.force}`,
  );

  const dueAlerts = await fetchDueAlerts(options.batchLimit, options.force);
  if (dueAlerts.length === 0) {
    const emptySummary: BatchSummary = {
      source: options.source,
      considered: 0,
      claimed: 0,
      processed: 0,
      skippedDueToDeadline: 0,
      triggered: 0,
      errors: 0,
      terminatedEarly: false,
      elapsedMs: Date.now() - startMs,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    console.log(`[check-price-alerts] No due alerts. ${JSON.stringify(emptySummary)}`);
    return emptySummary;
  }

  let claimed = 0;
  let processed = 0;
  let skippedDueToDeadline = 0;
  let triggered = 0;
  let errors = 0;
  let terminatedEarly = false;

  const concurrency = Math.max(1, Math.min(clampConcurrency(DEFAULT_CONCURRENCY), dueAlerts.length));
  let cursor = 0;

  async function worker(workerId: number): Promise<void> {
    while (true) {
      if (Date.now() >= deadlineMs) {
        terminatedEarly = true;
        console.warn(`[check-price-alerts] Worker ${workerId} hit runtime deadline`);
        return;
      }

      const idx = cursor;
      cursor += 1;
      if (idx >= dueAlerts.length) return;

      const alert = dueAlerts[idx];
      const claimIso = new Date().toISOString();
      const ok = await claimAlert(alert, claimIso, options.force);
      if (!ok) {
        continue;
      }
      claimed++;

      // Deadline guard after claim: queue has progressed via claim update.
      if (Date.now() >= deadlineMs) {
        terminatedEarly = true;
        skippedDueToDeadline++;
        continue;
      }

      const result = await processOneAlert(alert);
      processed++;
      if (result.triggered) triggered++;
      if (result.errored) errors++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));

  const elapsedMs = Date.now() - startMs;
  if (elapsedMs >= MAX_BATCH_RUNTIME_MS) {
    terminatedEarly = true;
    console.warn(`[check-price-alerts] Graceful self-termination at ${elapsedMs}ms`);
  }

  const summary: BatchSummary = {
    source: options.source,
    considered: dueAlerts.length,
    claimed,
    processed,
    skippedDueToDeadline,
    triggered,
    errors,
    terminatedEarly,
    elapsedMs,
    startedAt,
    finishedAt: new Date().toISOString(),
  };

  console.log(`[check-price-alerts] Total execution time: ${elapsedMs}ms`);
  console.log(`[check-price-alerts] Done ${JSON.stringify(summary)}`);
  return summary;
}

// ---------------------------------------------------------------------------
// HTTP trigger (manual diagnostics / external scheduler fallback)
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  console.log("[HEARTBEAT] Triggered via http");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || token !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedLimit = Number(body?.limit ?? DEFAULT_BATCH_LIMIT);
  const force = body?.force === true;

  try {
    const summary = await processAlertBatch({ source: "http", batchLimit: clampBatchLimit(requestedLimit), force });
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "unknown");
    console.error("[check-price-alerts] HTTP fatal:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
