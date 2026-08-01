/**
 * Frontend for the prediction API.
 *
 * Serves both deployments unchanged:
 *   - On Flask, the form would work without this file (it posts to /response).
 *   - On Netlify there is no server-side rendering, so this file is what makes
 *     the page live: it calls /api/v1/* through the proxy declared in
 *     netlify.toml and fills in the result and history regions.
 *
 * Progressive enhancement: the native form submit is only intercepted once the
 * script has loaded, so a JS failure degrades to the server-rendered path
 * rather than a dead button.
 */
(function () {
  "use strict";

  var CONFIG = window.MBPP_CONFIG || {};
  var API_BASE = CONFIG.apiBase || "/api/v1";
  var IS_STATIC = CONFIG.static === true;

  var AXIS_ORDER = ["ei", "sn", "tf", "jp"];
  // Letter -> human label, keyed the same way the API keys its axes.
  var AXIS_LABELS = {
    ei: { I: "Introversion", E: "Extraversion" },
    sn: { N: "Intuition", S: "Sensing" },
    tf: { F: "Feeling", T: "Thinking" },
    jp: { P: "Perceiving", J: "Judging" }
  };

  function el(id) {
    return document.getElementById(id);
  }

  /** Text-only insertion; never build HTML from API strings. */
  function setText(node, value) {
    if (node) {
      node.textContent = value == null ? "" : String(value);
    }
  }

  function show(node) {
    if (node) node.removeAttribute("hidden");
  }

  function hide(node) {
    if (node) node.setAttribute("hidden", "hidden");
  }

  function percent(value) {
    if (value == null || isNaN(value)) return "n/a";
    return Math.round(value * 100) + "%";
  }

  function request(path, options) {
    var opts = options || {};
    return fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: opts.body
        ? { "Content-Type": "application/json", Accept: "application/json" }
        : { Accept: "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin"
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (payload) {
          if (!res.ok) {
            var message =
              (payload.error && payload.error.message) ||
              "Request failed with status " + res.status + ".";
            var err = new Error(message);
            err.status = res.status;
            err.requestId = payload.request_id;
            throw err;
          }
          return payload;
        });
    });
  }

  // ----------------------------------------------------------------- predict
  function renderPrediction(result, snippet) {
    var container = el("prediction-result");
    if (!container) return;

    setText(el("prediction-type"), result.personality_type);
    setText(el("prediction-snippet"), snippet);

    var link = el("prediction-link");
    if (link) {
      var type = String(result.personality_type || "").toLowerCase();
      link.href = "https://www.16personalities.com/" + type + "-personality";
      setText(link, "16personalities.com/" + type);
    }

    var breakdown = el("prediction-axes");
    if (breakdown) {
      breakdown.innerHTML = "";
      AXIS_ORDER.forEach(function (key) {
        var axis = (result.axes || {})[key];
        if (!axis) return;
        var chosen = axis.letter;
        var name = (AXIS_LABELS[key] || {})[chosen] || axis.name || "";

        var row = document.createElement("li");
        row.className = "axis-row";

        var strong = document.createElement("strong");
        strong.textContent = chosen + " ";
        row.appendChild(strong);

        var span = document.createElement("span");
        span.textContent = name + " - " + percent(axis.probability) + " probability";
        row.appendChild(span);

        breakdown.appendChild(row);
      });
    }

    var stored = el("prediction-stored");
    if (stored) {
      setText(
        stored,
        result.stored
          ? "Saved to Firestore (id " + result.id + ")."
          : "Not saved: the database is unavailable, your prediction still stands."
      );
    }

    hide(el("prediction-error"));
    show(container);
  }

  function renderError(message, requestId) {
    var box = el("prediction-error");
    if (!box) {
      window.alert(message);
      return;
    }
    setText(
      box,
      requestId ? message + " (request " + requestId + ")" : message
    );
    hide(el("prediction-result"));
    show(box);
  }

  function wirePredictForm() {
    var form = el("predict-form");
    if (!form) return;

    form.addEventListener("submit", function (event) {
      var input = form.querySelector("[name='fsnippet'], [name='text']");
      var snippet = input ? input.value.trim() : "";
      if (!snippet) return; // let the browser's required-field validation run

      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      var originalLabel = button ? button.textContent : "";
      if (button) {
        button.disabled = true;
        button.textContent = "Predicting...";
      }
      hide(el("prediction-error"));

      request("/predict", { method: "POST", body: { text: snippet } })
        .then(function (result) {
          renderPrediction(result, snippet);
          if (el("history-body")) loadHistory();
        })
        .catch(function (err) {
          if (!CONFIG.backendConfigured && IS_STATIC) {
            renderError(
              "The prediction backend is not configured for this site yet " +
                "(set BACKEND_URL in Netlify and redeploy)."
            );
          } else {
            renderError(err.message, err.requestId);
          }
        })
        .then(function () {
          if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
          }
        });
    });
  }

  // ----------------------------------------------------------------- history
  function loadHistory() {
    var body = el("history-body");
    if (!body) return;

    request("/predictions?limit=20")
      .then(function (payload) {
        body.innerHTML = "";
        var items = payload.items || [];
        if (!items.length) {
          var empty = document.createElement("tr");
          var cell = document.createElement("td");
          cell.colSpan = 4;
          cell.textContent = payload.storage_available
            ? "No predictions stored yet."
            : "The database is currently unavailable.";
          empty.appendChild(cell);
          body.appendChild(empty);
          return;
        }
        items.forEach(function (item) {
          var row = document.createElement("tr");
          [
            item.personality_type || "-",
            item.text || "(not stored)",
            item.created_at || "-",
            item.source || "-"
          ].forEach(function (value) {
            var cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
          });
          body.appendChild(row);
        });
      })
      .catch(function () {
        body.innerHTML = "";
        var row = document.createElement("tr");
        var cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "Could not load history.";
        row.appendChild(cell);
        body.appendChild(row);
      });
  }

  function loadStats() {
    var total = el("stats-total");
    if (!total) return;
    request("/stats")
      .then(function (payload) {
        setText(total, payload.total || 0);
        var top = el("stats-top-types");
        if (!top) return;
        var types = payload.types || {};
        var ranked = Object.keys(types)
          .sort(function (a, b) {
            return types[b] - types[a];
          })
          .slice(0, 5);
        top.innerHTML = "";
        ranked.forEach(function (type) {
          var item = document.createElement("li");
          item.textContent = type + ": " + types[type];
          top.appendChild(item);
        });
      })
      .catch(function () {
        setText(total, "unavailable");
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wirePredictForm();
    // On the static build there is no server-rendered table, so always
    // hydrate; under Flask this refreshes what was rendered.
    loadHistory();
    loadStats();
  });
})();
