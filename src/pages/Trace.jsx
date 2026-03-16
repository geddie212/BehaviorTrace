/**
 * BehaviorTrace - Trace Page (User Interaction + State Tracking)
 * Written by Paul Gedrimas - 12/2025
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";
import traceLogo from "../../assets/images/logo.png";
import "./Trace.css";

const ACTIVE_COLOR_STYLES = {
  danger: { backgroundColor: "#dc3545", borderColor: "#dc3545", color: "#fff" },
  warning: { backgroundColor: "#ffc107", borderColor: "#ffc107", color: "#212529" },
  success: { backgroundColor: "#198754", borderColor: "#198754", color: "#fff" },
  primary: { backgroundColor: "#0d6efd", borderColor: "#0d6efd", color: "#fff" },
  dark: { backgroundColor: "#212529", borderColor: "#212529", color: "#fff" },
};

const PENDING_ACTIONS_KEY = "trace.pendingActions";
const CACHED_ACTIVE_STATES_KEY = "trace.cachedActiveStates";
const CACHED_FORMS_KEY = "trace.cachedForms";
const CONNECTION_PROBE_INTERVAL_MS = 1000;
const CONNECTION_PROBE_TIMEOUT_MS = 1000;

function readJsonStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`[Trace] failed to read localStorage key "${key}":`, error);
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`[Trace] failed to write localStorage key "${key}":`, error);
  }
}

function createClientStateId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isNetworkFailure(error) {
  if (!error) return false;

  const message = String(error.message || error.details || error.description || "").toLowerCase();
  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("fetch")
  );
}

function toActiveStateMap(states) {
  return Object.fromEntries(states.map((state) => [state.label_id, state]));
}

function formatDuration(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const diffMs = Math.max(end - start, 0);
  const totalSeconds = Math.round(diffMs / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(source, target) {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function isLooseTokenMatch(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;

  const maxDistance = queryToken.length >= 8 ? 2 : 1;
  return levenshteinDistance(queryToken, candidateToken) <= maxDistance;
}

function matchesLabelSearch(query, form, label) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const candidateText = normalizeSearchValue(
    `${label.label_name} ${label.label_type} ${form.title} ${form.description || ""}`
  );

  if (candidateText.includes(normalizedQuery)) return true;

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const candidateTokens = candidateText.split(" ").filter(Boolean);

  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => isLooseTokenMatch(queryToken, candidateToken))
  );
}

export default function Trace() {
  const navigate = useNavigate();

  const [userId, setUserId] = useState(null);
  const [forms, setForms] = useState([]);
  const [activeStates, setActiveStates] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingActions, setPendingActions] = useState(() =>
    readJsonStorage(PENDING_ACTIONS_KEY, [])
  );

  const pendingActionsRef = useRef([]);
  const userIdRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const connectionProbeRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const cachedForms = readJsonStorage(CACHED_FORMS_KEY, []);
      const cachedActiveStates = readJsonStorage(CACHED_ACTIVE_STATES_KEY, {});

      if (cachedForms.length > 0) {
        setForms(cachedForms);
      }

      if (Object.keys(cachedActiveStates).length > 0) {
        setActiveStates(cachedActiveStates);
      }

      const {
        data: { session },
        error: sessErr,
      } = await supabase.auth.getSession();

      if (sessErr || !session) {
        if (sessErr) console.error("[Trace] session error:", sessErr);
        navigate("/");
        return;
      }

      setUserId(session.user.id);
      userIdRef.current = session.user.id;

      const { data: formsData, error: formsErr } = await supabase
        .from("forms")
        .select("id,title,description,created_at")
        .order("created_at", { ascending: false });

      if (formsErr) {
        console.error("[Trace] forms fetch error:", formsErr);
        if (isNetworkFailure(formsErr)) {
          setConnectionStatus(false);
        }
        return;
      }

      const safeForms = formsData || [];
      const formIds = safeForms.map((form) => form.id);

      let labelsData = [];
      if (formIds.length > 0) {
        const { data, error: labelsErr } = await supabase
          .from("labels")
          .select(
            "id,form_id,label_name,label_type,decay_seconds,ema_interval_seconds,ema_prompt,ema_active_text,ema_active_color,created_at"
          )
          .in("form_id", formIds);

        if (labelsErr) {
          console.error("[Trace] labels fetch error:", labelsErr);
          if (isNetworkFailure(labelsErr)) {
            setConnectionStatus(false);
          }
        } else {
          labelsData = data || [];
        }
      }

      const { data: activeStatesData, error: activeStatesErr } = await supabase
        .from("user_states")
        .select("id,label_id,form_id,started_at")
        .eq("user_id", session.user.id)
        .eq("active", true);

      if (activeStatesErr) {
        console.error("[Trace] active states fetch error:", activeStatesErr);
        if (isNetworkFailure(activeStatesErr)) {
          setConnectionStatus(false);
        }
      } else {
        setActiveStates(toActiveStateMap(activeStatesData || []));
      }

      const merged = safeForms.map((form) => ({
        ...form,
        labels: labelsData.filter((label) => label.form_id === form.id),
      }));

      setForms(merged);
      writeJsonStorage(CACHED_FORMS_KEY, merged);
    };

    init();
  }, [navigate]);

  useEffect(() => {
    writeJsonStorage(CACHED_ACTIVE_STATES_KEY, activeStates);
  }, [activeStates]);

  useEffect(() => {
    pendingActionsRef.current = pendingActions;
    writeJsonStorage(PENDING_ACTIONS_KEY, pendingActions);
  }, [pendingActions]);

  useEffect(() => {
    async function probeConnection() {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setConnectionStatus(false);
        return false;
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), CONNECTION_PROBE_TIMEOUT_MS);

      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
          method: "HEAD",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          cache: "no-store",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        setConnectionStatus(true);
        return true;
      } catch (error) {
        window.clearTimeout(timeoutId);
        if (isNetworkFailure(error)) {
          setConnectionStatus(false);
          return false;
        }

        return connectionStatus;
      }
    }

    const handleOnline = () => {
      probeConnection();
    };

    const handleOffline = () => {
      setConnectionStatus(false);
    };

    probeConnection();
    connectionProbeRef.current = window.setInterval(probeConnection, CONNECTION_PROBE_INTERVAL_MS);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      if (connectionProbeRef.current) {
        window.clearInterval(connectionProbeRef.current);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [connectionStatus]);

  useEffect(() => {
    if (connectionStatus && userId) {
      flushPendingActions();
    }
  }, [connectionStatus, userId]);

  function flashSuccess(message) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(""), 2500);
  }

  function queuePendingAction(action) {
    setPendingActions((current) => [...current, action]);
  }

  function saveLogOffline(payload, labelName) {
    setConnectionStatus(false);
    queuePendingAction({
      type: "log",
      user_id: payload.user_id,
      payload,
    });
    flashSuccess(`Saved "${labelName}" offline. It will sync when internet returns.`);
  }

  function startStateOffline({ formId, label, startedAt }) {
    const clientStateId = createClientStateId();
    const offlineState = {
      id: clientStateId,
      clientStateId,
      label_id: label.id,
      form_id: formId,
      started_at: startedAt,
      pendingSync: true,
    };

    setConnectionStatus(false);
    setActiveStates((current) => ({
      ...current,
      [label.id]: offlineState,
    }));

    queuePendingAction({
      type: "start_state",
      user_id: userId,
      clientStateId,
      payload: {
        user_id: userId,
        form_id: formId,
        label_id: label.id,
        started_at: startedAt,
      },
    });

    flashSuccess(`Started "${label.label_name}" offline. It will sync when internet returns.`);
  }

  function stopStateOffline({ label, existing, endedAt }) {
    setConnectionStatus(false);
    setActiveStates((current) => {
      const next = { ...current };
      delete next[label.id];
      return next;
    });

    queuePendingAction({
      type: "stop_state",
      user_id: userId,
      stateId: String(existing.id).startsWith("local-") ? null : existing.id,
      clientStateId: existing.clientStateId || existing.id,
      endedAt,
    });

    flashSuccess(
      `Stopped "${label.label_name}" offline after ${formatDuration(existing.started_at, endedAt)}.`
    );
  }

  async function flushPendingActions() {
    if (syncInFlightRef.current) return;

    const queued = pendingActionsRef.current;
    const currentUserId = userIdRef.current;

    if (!connectionStatus || !currentUserId || queued.length === 0) return;

    syncInFlightRef.current = true;
    const clientStateIdMap = new Map();
    const remaining = [];
    let actionIndex = 0;

    try {
      for (actionIndex = 0; actionIndex < queued.length; actionIndex += 1) {
        const action = queued[actionIndex];

        if (action.user_id !== currentUserId) {
          remaining.push(action);
          continue;
        }

        if (action.type === "log") {
          const { error } = await supabase.from("user_logs").insert(action.payload);
          if (error) throw error;
          continue;
        }

        if (action.type === "start_state") {
          const { data, error } = await supabase
            .from("user_states")
            .insert(action.payload)
            .select("id,label_id,form_id,started_at")
            .single();

          if (error) throw error;

          clientStateIdMap.set(action.clientStateId, data.id);

          setActiveStates((current) => {
            const existing = current[action.payload.label_id];

            if (!existing || existing.clientStateId === action.clientStateId) {
              return {
                ...current,
                [action.payload.label_id]: data,
              };
            }

            return current;
          });
          continue;
        }

        if (action.type === "stop_state") {
          const stateId = action.stateId || clientStateIdMap.get(action.clientStateId);

          if (!stateId) {
            remaining.push(action);
            continue;
          }

          const { error } = await supabase
            .from("user_states")
            .update({
              active: false,
              ended_at: action.endedAt,
            })
            .eq("id", stateId);

          if (error) throw error;
          continue;
        }
      }

      setPendingActions(remaining);

      if (queued.length > 0 && remaining.length === 0) {
        flashSuccess("Cached activity synced to the internet.");
      }
    } catch (error) {
      console.error("[Trace] pending sync error:", error);
      setPendingActions([...remaining, ...queued.slice(actionIndex)]);
    } finally {
      syncInFlightRef.current = false;
    }
  }

  async function logLabel(formId, label) {
    if (!userId) return;

    if (label.label_type !== "ema") {
      const payload = {
        user_id: userId,
        form_id: formId,
        label_id: label.id,
      };

      if (!connectionStatus) {
        saveLogOffline(payload, label.label_name);
        return;
      }

      const { error } = await supabase.from("user_logs").insert({
        user_id: userId,
        form_id: formId,
        label_id: label.id,
      });

      if (error) {
        console.error("[Trace] user_logs insert error:", error);
        if (isNetworkFailure(error)) {
          saveLogOffline(payload, label.label_name);
          return;
        }
        alert(error.message);
        return;
      }

      flashSuccess(`Logged "${label.label_name}"`);
      return;
    }

    const existing = activeStates[label.id];

    if (!existing) {
      const startedAt = new Date().toISOString();

      if (!connectionStatus) {
        startStateOffline({ formId, label, startedAt });
        return;
      }

      const { data: newState, error: insErr } = await supabase
        .from("user_states")
        .insert({
          user_id: userId,
          form_id: formId,
          label_id: label.id,
        })
        .select("id,label_id,form_id,started_at")
        .single();

      if (insErr) {
        console.error("[Trace] user_states insert error:", insErr);
        if (isNetworkFailure(insErr)) {
          startStateOffline({ formId, label, startedAt });
          return;
        }
        alert(insErr.message);
        return;
      }

      setActiveStates((current) => ({
        ...current,
        [label.id]: newState,
      }));
      flashSuccess(`Started "${label.label_name}"`);
      return;
    }

    const endedAt = new Date().toISOString();

    if (!connectionStatus) {
      stopStateOffline({ label, existing, endedAt });
      return;
    }

    const { error: endErr } = await supabase
      .from("user_states")
      .update({
        active: false,
        ended_at: endedAt,
      })
      .eq("id", existing.id);

    if (endErr) {
      console.error("[Trace] user_states update error:", endErr);
      if (isNetworkFailure(endErr)) {
        stopStateOffline({ label, existing, endedAt });
        return;
      }
      alert(endErr.message);
      return;
    }

    setActiveStates((current) => {
      const next = { ...current };
      delete next[label.id];
      return next;
    });

    flashSuccess(
      `Stopped "${label.label_name}" after ${formatDuration(existing.started_at, endedAt)}`
    );
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  function activeButtonText(label) {
    const customText = (label.ema_active_text || "").trim();
    return customText || `Stop - ${label.label_name}`;
  }

  function findLabelById(labelId) {
    return forms.flatMap((form) => form.labels).find((label) => String(label.id) === String(labelId));
  }

  function findFormIdForLabel(labelId) {
    return forms.find((form) =>
      form.labels.some((label) => String(label.id) === String(labelId))
    )?.id;
  }

  function stopActiveStateFromPanel(labelId) {
    const label = findLabelById(labelId);
    const formId = findFormIdForLabel(labelId);

    if (!label || !formId) return;

    logLabel(formId, label);
  }

  function buttonProps(label) {
    const activeState = activeStates[label.id];

    if (label.label_type === "ema" && activeState) {
      return {
        className: "trace-label-button",
        style: ACTIVE_COLOR_STYLES[label.ema_active_color] || ACTIVE_COLOR_STYLES.danger,
        text: activeButtonText(label),
      };
    }

    if (label.label_type === "decay") {
      return {
        className: "trace-label-button trace-label-decay",
        style: undefined,
        text: label.label_name,
      };
    }

    if (label.label_type === "ema") {
      return {
        className: "trace-label-button trace-label-state",
        style: undefined,
        text: label.label_name,
      };
    }

    return {
      className: "trace-label-button trace-label-event",
      style: undefined,
      text: label.label_name,
    };
  }

  const activeStateEntries = Object.entries(activeStates);
  const pendingCount = pendingActions.length;
  const filteredForms = forms
    .map((form) => ({
      ...form,
      labels: form.labels.filter((label) => matchesLabelSearch(searchQuery, form, label)),
    }))
    .filter((form) => form.labels.length > 0 || !searchQuery.trim());
  const totalVisibleLabels = filteredForms.reduce((count, form) => count + form.labels.length, 0);

  return (
    <div className="trace-shell">
      <div className="trace-backdrop trace-backdrop-one" />
      <div className="trace-backdrop trace-backdrop-two" />

      <div className="container py-4 py-md-5 position-relative">
        <section className="trace-hero">
          <div>
            <img className="trace-logo" src={traceLogo} alt="BehaviorTrace logo" />
            <h1 className="trace-title">Trace your current study labels</h1>
            <p className="trace-subtitle">
              Tap an instant or decay label to log it immediately. Tap a state label to start it, and
              tap again to stop and save the duration.
            </p>
          </div>

          <div className="trace-hero-actions">
            <div className="trace-stat">
              <span className="trace-stat-value">{forms.length}</span>
              <span className="trace-stat-label">Forms available</span>
            </div>
            <div className="trace-stat">
              <span className="trace-stat-value">{activeStateEntries.length}</span>
              <span className="trace-stat-label">Active states</span>
            </div>
            <div
              className={`trace-connection-status ${
                connectionStatus ? "trace-connection-online" : "trace-connection-offline"
              }`}
            >
              <span className="trace-connection-dot" />
              <div>
                <strong>
                  {connectionStatus ? "Connected to internet" : "Disconnected from internet"}
                </strong>
                <span>
                  {connectionStatus
                    ? pendingCount > 0
                      ? `Syncing ${pendingCount} cached item${pendingCount === 1 ? "" : "s"}`
                      : "Live updates are being saved to SQL now."
                    : `Caching ${pendingCount} item${pendingCount === 1 ? "" : "s"} locally until connection returns.`}
                </span>
              </div>
            </div>
          </div>

          <button className="trace-logout-btn" onClick={logout}>
            Logout
          </button>
        </section>

        {successMessage && <div className="trace-success">{successMessage}</div>}

        <section className="trace-active-panel">
          <p className="trace-kicker">Live status</p>
          <h2 className="trace-section-title">Active states</h2>
          <p className="trace-section-copy">
            These labels are currently running and will save a duration when you stop them.
          </p>

          {activeStateEntries.length === 0 ? (
            <div className="trace-empty mt-3">No state labels are active right now.</div>
          ) : (
            <div className="trace-chip-grid mt-3">
              {activeStateEntries.map(([labelId, state]) => {
                const activeLabel = findLabelById(labelId);

                return (
                  <div key={labelId} className="trace-active-chip">
                    <div>
                      <strong>{activeLabel?.label_name || "Active state"}</strong>
                      <span>
                        Started {new Date(state.started_at).toLocaleTimeString()}
                        {state.pendingSync ? " - waiting to sync" : ""}
                      </span>
                    </div>
                    {activeLabel && (
                      <button
                        className="trace-active-stop"
                        style={
                          ACTIVE_COLOR_STYLES[activeLabel.ema_active_color] ||
                          ACTIVE_COLOR_STYLES.danger
                        }
                        onClick={() => stopActiveStateFromPanel(labelId)}
                      >
                        {activeButtonText(activeLabel)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="trace-panel trace-search-panel">
          <p className="trace-kicker">Find labels</p>
          <h2 className="trace-section-title">Search states, urges, and effects</h2>
          <p className="trace-section-copy">
            Start typing and matching labels will appear automatically, even with small spelling
            mistakes.
          </p>

          <div className="trace-search-row">
            <input
              className="trace-search-input"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search for anxious, relaxed, weed craving, oxycodone..."
              aria-label="Search study labels"
            />
            {searchQuery.trim() && (
              <button className="trace-search-clear" onClick={() => setSearchQuery("")}>
                Clear
              </button>
            )}
          </div>

          <div className="trace-search-meta">
            {searchQuery.trim()
              ? `${totalVisibleLabels} matching label${totalVisibleLabels === 1 ? "" : "s"}`
              : "Showing all available labels"}
          </div>
        </section>

        {forms.length === 0 ? (
          <div className="trace-empty">No study forms are available right now.</div>
        ) : filteredForms.length === 0 ? (
          <div className="trace-empty">
            No labels matched "{searchQuery}". Try a shorter phrase or a nearby spelling.
          </div>
        ) : (
          <div className="trace-form-grid">
            {filteredForms.map((form) => (
              <section key={form.id} className="trace-form-card">
                <p className="trace-kicker">Study form</p>
                <h3>{form.title}</h3>
                <p className="trace-form-description">
                  {form.description || "Select a label below to log your current state or event."}
                </p>

                <div className="trace-label-row">
                  {form.labels.map((label) => {
                    const button = buttonProps(label);

                    return (
                      <button
                        key={label.id}
                        className={button.className}
                        style={button.style}
                        onClick={() => logLabel(form.id, label)}
                      >
                        {button.text}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
