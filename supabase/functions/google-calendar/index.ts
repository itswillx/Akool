import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  return user;
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// ─── Exchange authorization code for tokens ──────────────────────────────────
async function exchangeCode(
  userId: string,
  code: string,
  redirectUri: string
) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Token exchange failed:", JSON.stringify(data));
    throw new Error(data.error_description || data.error || "Token exchange failed");
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Get Google user email
  let googleEmail: string | null = null;
  try {
    const infoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
      }
    );
    if (infoRes.ok) {
      const info = await infoRes.json();
      googleEmail = info.email || null;
    }
  } catch {
    // non-critical
  }

  const db = getServiceClient();

  // Upsert tokens
  const { error: tokenError } = await db.from("user_google_tokens").upsert(
    {
      user_id: userId,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expiry: expiresAt,
      google_email: googleEmail,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (tokenError) throw new Error("Failed to store tokens: " + tokenError.message);

  // Set connected flag on profile
  await db
    .from("profiles")
    .update({ google_calendar_connected: true })
    .eq("id", userId);

  return { google_email: googleEmail };
}

// ─── Refresh access token using stored refresh_token ─────────────────────────
async function getValidAccessToken(userId: string): Promise<string> {
  const db = getServiceClient();
  const { data: tokens, error: dbError } = await db
    .from("user_google_tokens")
    .select("access_token, refresh_token, token_expiry")
    .eq("user_id", userId)
    .single();

  if (dbError) {
    console.log("[getValidAccessToken] DB error fetching tokens:", dbError.message);
  }
  if (!tokens) throw new Error("Google Calendar not connected");

  // Check if token is still valid (with 2 min buffer)
  const expiry = new Date(tokens.token_expiry).getTime();
  if (Date.now() < expiry - 120_000) {
    console.log("[getValidAccessToken] Token still valid, expires:", tokens.token_expiry);
    return tokens.access_token;
  }

  console.log("[getValidAccessToken] Token expired, refreshing...");
  // Refresh the token
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log("[getValidAccessToken] Token refresh failed:", JSON.stringify(data));
    throw new Error(
      data.error_description || data.error || "Token refresh failed"
    );
  }

  const newExpiry = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();
  console.log("[getValidAccessToken] Token refreshed, new expiry:", newExpiry);

  await db
    .from("user_google_tokens")
    .update({
      access_token: data.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return data.access_token;
}

// ─── List events from Google Calendar ────────────────────────────────────────
async function listEvents(
  userId: string,
  timeMin: string,
  timeMax: string,
  calendarId = "primary"
) {
  if (!timeMin || !timeMax) {
    throw new Error("time_min and time_max are required for list_events");
  }
  console.log("[listEvents] Fetching events:", { calendarId, timeMin, timeMax });
  const accessToken = await getValidAccessToken(userId);
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  console.log("[listEvents] Google API URL:", url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    console.log("[listEvents] Google API error:", res.status, JSON.stringify(data));
    throw new Error(data.error?.message || `Google Calendar API error (${res.status})`);
  }

  const events = (data.items || []).map((ev: Record<string, unknown>) => ({
    id: ev.id,
    summary: ev.summary || "",
    description: ev.description || "",
    start: ev.start,
    end: ev.end,
    colorId: ev.colorId,
    htmlLink: ev.htmlLink,
    status: ev.status,
    recurrence: ev.recurrence,
  }));
  console.log("[listEvents] Fetched", events.length, "events");
  return events;
}

// ─── Create event in Google Calendar ─────────────────────────────────────────
async function createEvent(
  userId: string,
  event: Record<string, unknown>,
  calendarId = "primary"
) {
  const accessToken = await getValidAccessToken(userId);
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error?.message || "Failed to create event");
  return data;
}

// ─── Update event in Google Calendar ─────────────────────────────────────────
async function updateEvent(
  userId: string,
  eventId: string,
  event: Record<string, unknown>,
  calendarId = "primary"
) {
  const accessToken = await getValidAccessToken(userId);
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error?.message || "Failed to update event");
  return data;
}

// ─── Delete event from Google Calendar ───────────────────────────────────────
async function deleteEvent(
  userId: string,
  eventId: string,
  calendarId = "primary"
) {
  const accessToken = await getValidAccessToken(userId);
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as Record<string, Record<string, string>>).error?.message || "Failed to delete event"
    );
  }
  return { success: true };
}

// ─── Disconnect Google Calendar ──────────────────────────────────────────────
async function disconnect(userId: string) {
  const db = getServiceClient();
  await db.from("user_google_tokens").delete().eq("user_id", userId);
  await db
    .from("profiles")
    .update({ google_calendar_connected: false })
    .eq("id", userId);
  return { success: true };
}

// ─── Get connection status ───────────────────────────────────────────────────
async function getStatus(userId: string) {
  const db = getServiceClient();
  const { data } = await db
    .from("user_google_tokens")
    .select("google_email, token_expiry")
    .eq("user_id", userId)
    .single();

  if (!data) return { connected: false };
  return {
    connected: true,
    google_email: data.google_email,
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { action } = body;
    console.log("[google-calendar] Action:", action);

    switch (action) {
      case "exchange_code": {
        const result = await exchangeCode(
          user.id,
          body.code,
          body.redirect_uri
        );
        return jsonResponse(result);
      }

      case "status": {
        const result = await getStatus(user.id);
        return jsonResponse(result);
      }

      case "list_events": {
        const events = await listEvents(
          user.id,
          body.time_min,
          body.time_max,
          body.calendar_id
        );
        return jsonResponse({ events });
      }

      case "create_event": {
        const result = await createEvent(
          user.id,
          body.event,
          body.calendar_id
        );
        return jsonResponse(result);
      }

      case "update_event": {
        const result = await updateEvent(
          user.id,
          body.event_id,
          body.event,
          body.calendar_id
        );
        return jsonResponse(result);
      }

      case "delete_event": {
        const result = await deleteEvent(
          user.id,
          body.event_id,
          body.calendar_id
        );
        return jsonResponse(result);
      }

      case "disconnect": {
        const result = await disconnect(user.id);
        return jsonResponse(result);
      }

      default:
        return jsonResponse({ error: "Unknown action: " + action }, 400);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log("[google-calendar] ERROR:", errorMessage);
    return jsonResponse({ error: errorMessage, details: String(err) }, 500);
  }
});
