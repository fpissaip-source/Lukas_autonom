/*
 * Lukas Widget v2 — einbettbarer, frei designbarer Chat/Voice-Assistent.
 *
 * Einbindung (eine Zeile):
 *   <script src="https://DEINE-LUKAS-DOMAIN/widget.js" data-api="https://DEINE-LUKAS-DOMAIN" defer></script>
 *
 * ── Design per data-Attributen ─────────────────────────────────────────────
 *   data-theme          "dark" (Standard) | "light"
 *   data-accent         Hauptfarbe, z.B. "#e11d48"
 *   data-accent2        zweite Gradient-Farbe des Buttons (Standard: accent)
 *   data-bg             Panel-Hintergrund        data-text   Textfarbe
 *   data-radius         Eckenradius, z.B. "0px" oder "24px"
 *   data-position       "bottom-right" (Standard) | "bottom-left"
 *   data-width          Panelbreite  (Standard 380px)
 *   data-height         Panelhöhe    (Standard 520px)
 *   data-font           font-family
 *   data-button-icon    Emoji des Buttons (Standard 🤖)
 *   data-title          Titel        data-subtitle  Untertitel
 *   data-greeting       Begrüßung    data-placeholder  Eingabe-Platzhalter
 *
 * ── Voll-Custom per CSS ────────────────────────────────────────────────────
 * Kein Shadow-DOM: die Host-Seite kann mit normalem CSS ALLES überschreiben.
 * Stabile Klassen: .lukas-w .lukas-btn .lukas-panel .lukas-head .lukas-msgs
 * .lukas-m .lukas-m.u .lukas-m.a .lukas-form .lukas-in .lukas-ic .lukas-mic
 * CSS-Variablen: --lukas-accent --lukas-accent-2 --lukas-bg --lukas-panel-bg
 * --lukas-text --lukas-muted --lukas-border --lukas-radius --lukas-width
 * --lukas-height --lukas-font
 *
 * ── Stimme ─────────────────────────────────────────────────────────────────
 *   data-voice="agent"   OpenAI Realtime API (WebRTC, echtes Speech-to-
 *                        Speech, Millisekunden-Latenz). SDK wird erst beim
 *                        ersten Mikro-Klick per CDN geladen; das Gespräch
 *                        ist aus Kostenschutz-Gründen auf ein paar Minuten
 *                        pro Session gedeckelt.
 *   data-voice="classic" Browser-Spracherkennung + Server-TTS (Standard,
 *                        braucht keine Konfiguration).
 *   data-voice="off"     Mikro-Button ausblenden.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var API = (ds.api || (script ? new URL(script.src).origin : "")).replace(/\/+$/, "");

  var cfg = {
    theme: ds.theme === "light" ? "light" : "dark",
    accent: ds.accent || "#6d28d9",
    accent2: ds.accent2 || ds.accent || "#2563eb",
    bg: ds.bg || "",
    text: ds.text || "",
    radius: ds.radius || "16px",
    position: ds.position === "bottom-left" ? "left" : "right",
    width: ds.width || "380px",
    height: ds.height || "520px",
    font: ds.font || "system-ui,-apple-system,sans-serif",
    buttonIcon: ds.buttonIcon || "🤖",
    title: ds.title || "Lukas",
    subtitle: ds.subtitle || "Issas KI-Agent — frag mich was",
    greeting:
      ds.greeting ||
      "Hey! Ich bin Lukas, Issas KI-Agent. Frag mich etwas über ihn oder seine Projekte — tippen oder aufs Mikro drücken.",
    placeholder: ds.placeholder || "Frag mich etwas über Issa…",
    voice: ds.voice || "classic",
  };

  var themes = {
    dark: { bg: "#0f0f1a", panel: "#161628", text: "#e5e5f0", muted: "#8b8ba7", border: "#2a2a4e", bubble: "#1d1d33" },
    light: { bg: "#ffffff", panel: "#f4f4f8", text: "#1a1a2e", muted: "#6b6b80", border: "#dcdce6", bubble: "#ececf4" },
  };
  var t = themes[cfg.theme];
  if (cfg.bg) t.bg = cfg.bg;
  if (cfg.text) t.text = cfg.text;

  // ── Styles (alles über Variablen; Host-CSS kann jede Klasse überschreiben)
  var css =
    ".lukas-w{--lukas-accent:" + cfg.accent + ";--lukas-accent-2:" + cfg.accent2 + ";--lukas-bg:" + t.bg +
    ";--lukas-panel-bg:" + t.panel + ";--lukas-text:" + t.text + ";--lukas-muted:" + t.muted +
    ";--lukas-border:" + t.border + ";--lukas-bubble:" + t.bubble + ";--lukas-radius:" + cfg.radius +
    ";--lukas-width:" + cfg.width + ";--lukas-height:" + cfg.height + ";--lukas-font:" + cfg.font + ";" +
    "position:fixed;bottom:24px;" + (cfg.position === "left" ? "left:24px;" : "right:24px;") +
    "z-index:99999;font-family:var(--lukas-font)}" +
    ".lukas-w *{box-sizing:border-box}" +
    ".lukas-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,var(--lukas-accent),var(--lukas-accent-2));color:#fff;font-size:26px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .15s}" +
    ".lukas-btn:hover{transform:scale(1.08)}" +
    ".lukas-btn.lukas-live{animation:lukas-pulse 1.2s infinite}" +
    ".lukas-panel{display:none;flex-direction:column;position:absolute;bottom:76px;" +
    (cfg.position === "left" ? "left:0;" : "right:0;") +
    "width:min(var(--lukas-width),calc(100vw - 32px));height:var(--lukas-height);background:var(--lukas-bg);color:var(--lukas-text);border:1px solid var(--lukas-border);border-radius:var(--lukas-radius);overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.35)}" +
    ".lukas-head{padding:14px 16px;background:var(--lukas-panel-bg);border-bottom:1px solid var(--lukas-border);display:flex;align-items:center;gap:10px}" +
    ".lukas-head b{font-size:14px}" +
    ".lukas-head span{font-size:11px;color:var(--lukas-muted)}" +
    ".lukas-dot{width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}" +
    ".lukas-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".lukas-m{max-width:85%;padding:9px 12px;border-radius:calc(var(--lukas-radius)*.75);font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}" +
    ".lukas-m.u{align-self:flex-end;background:var(--lukas-accent);color:#fff;border-bottom-right-radius:4px}" +
    ".lukas-m.a{align-self:flex-start;background:var(--lukas-bubble);border:1px solid var(--lukas-border);border-bottom-left-radius:4px}" +
    ".lukas-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--lukas-border);background:var(--lukas-panel-bg)}" +
    ".lukas-in{flex:1;background:var(--lukas-bg);border:1px solid var(--lukas-border);color:var(--lukas-text);border-radius:calc(var(--lukas-radius)*.6);padding:9px 12px;font-size:13.5px;outline:none}" +
    ".lukas-in:focus{border-color:var(--lukas-accent)}" +
    ".lukas-ic{width:38px;height:38px;flex:none;border-radius:calc(var(--lukas-radius)*.6);border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);cursor:pointer;font-size:16px}" +
    ".lukas-ic:disabled{opacity:.4;cursor:default}" +
    ".lukas-ic.rec{background:#dc2626;border-color:#dc2626;color:#fff;animation:lukas-pulse 1s infinite}" +
    ".lukas-status{font-size:11px;color:var(--lukas-muted);text-align:center;padding:2px 0}" +
    ".lukas-suggest{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}" +
    ".lukas-suggest:empty{display:none;padding:0}" +
    ".lukas-chip{border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);border-radius:999px;padding:6px 12px;font-size:12px;line-height:1.3;cursor:pointer;text-align:left;transition:border-color .15s,background .15s}" +
    ".lukas-chip:hover{border-color:var(--lukas-accent);background:var(--lukas-panel-bg)}" +
    "@keyframes lukas-pulse{50%{opacity:.55}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────
  var root = document.createElement("div");
  root.className = "lukas-w";
  root.innerHTML =
    '<div class="lukas-panel">' +
    '<div class="lukas-head"><div class="lukas-dot"></div><div><b></b><br><span></span></div></div>' +
    '<div class="lukas-msgs"></div>' +
    '<div class="lukas-suggest"></div>' +
    '<div class="lukas-status" style="display:none"></div>' +
    '<form class="lukas-form">' +
    '<input class="lukas-in" autocomplete="off">' +
    '<button type="button" class="lukas-ic lukas-mic" title="Sprechen">🎤</button>' +
    '<button type="submit" class="lukas-ic lukas-send" title="Senden">➤</button>' +
    "</form></div>" +
    '<button class="lukas-btn"></button>';
  document.body.appendChild(root);

  root.querySelector(".lukas-head b").textContent = cfg.title;
  root.querySelector(".lukas-head span").textContent = cfg.subtitle;
  root.querySelector(".lukas-btn").textContent = cfg.buttonIcon;
  var panel = root.querySelector(".lukas-panel");
  var msgs = root.querySelector(".lukas-msgs");
  var suggestBox = root.querySelector(".lukas-suggest");
  var statusBar = root.querySelector(".lukas-status");
  var form = root.querySelector(".lukas-form");
  var input = root.querySelector(".lukas-in");
  input.placeholder = cfg.placeholder;
  var micBtn = root.querySelector(".lukas-mic");
  var sendBtn = root.querySelector(".lukas-send");
  var mainBtn = root.querySelector(".lukas-btn");

  var history = [];
  var busy = false;
  var voiceMode = false;

  // ── Vorschlags-Chips: ein paar Starter-Fragen beim ersten Öffnen, danach
  // je EINE konkrete Folgefrage passend zur letzten Antwort (kommt vom
  // Server mit, siehe `suggestion` im SSE-Stream unten).
  var isEnglish = document.documentElement.lang && document.documentElement.lang.indexOf("en") === 0;
  var STARTER_QUESTIONS = isEnglish
    ? [
        "What is TaxiBB Essen?",
        "Tell me about GuardianGrid",
        "What are you working on right now?",
        "How did you build this portfolio?",
      ]
    : [
        "Was ist TaxiBB Essen?",
        "Erzähl mir von GuardianGrid",
        "Woran arbeitest du gerade?",
        "Wie hast du das Portfolio gebaut?",
      ];

  function renderChips(questions) {
    suggestBox.innerHTML = "";
    (questions || []).forEach(function (q) {
      if (!q) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lukas-chip";
      b.textContent = q;
      b.addEventListener("click", function () {
        voiceMode = false;
        send(q);
      });
      suggestBox.appendChild(b);
    });
  }

  // ── Vorladen für Sprache (Latenz): SDK-Modul (CDN) und Realtime-
  // Client-Secret schon beim Öffnen des Panels anfordern, nicht erst beim
  // Mikro-Klick — sonst zieht sich das "Verbinden…" spürbar hin, weil dann
  // erst noch das SDK aus dem Netz geladen UND eine Session vom Server
  // geholt werden muss, bevor die eigentliche WebRTC-Verbindung überhaupt
  // starten kann.
  var sdkPromise = null;
  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import("https://cdn.jsdelivr.net/npm/@openai/agents-realtime/+esm");
    }
    return sdkPromise;
  }
  var pendingSession = null;
  var pendingSessionAt = 0;
  var SESSION_PREFETCH_MAX_AGE_MS = 4 * 60 * 1000; // Secret läuft nach 5min ab
  function prefetchSession() {
    var age = Date.now() - pendingSessionAt;
    if (pendingSession && age < SESSION_PREFETCH_MAX_AGE_MS) return pendingSession;
    pendingSessionAt = Date.now();
    pendingSession = fetch(API + "/api/public/realtime-session", { method: "POST" }).then(function (r) {
      if (!r.ok) throw new Error("Session " + r.status);
      return r.json();
    });
    pendingSession.catch(function () {
      pendingSession = null;
    });
    return pendingSession;
  }

  mainBtn.addEventListener("click", function () {
    var open = panel.style.display === "flex";
    panel.style.display = open ? "none" : "flex";
    if (!open) {
      input.focus();
      if (!history.length) {
        addMsg("a", cfg.greeting);
        renderChips(STARTER_QUESTIONS);
      }
      if (cfg.voice === "agent") {
        loadSdk();
        prefetchSession();
      }
    }
  });

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "lukas-m " + (role === "user" ? "u" : "a");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function setStatus(text) {
    statusBar.style.display = text ? "block" : "none";
    statusBar.textContent = text || "";
  }

  // ── Klassischer TTS-Pfad: progressive Wiedergabe über GET-URL ─────────
  var audioQueue = [];
  var playing = false;

  function playNext() {
    if (playing || audioQueue.length === 0) return;
    playing = true;
    var audio = new Audio(audioQueue.shift());
    audio.onended = audio.onerror = function () {
      playing = false;
      playNext();
    };
    audio.play().catch(function () {
      playing = false;
    });
  }

  function speak(sentence) {
    if (!voiceMode || !sentence.trim()) return;
    audioQueue.push(API + "/api/public/tts?text=" + encodeURIComponent(sentence.trim()));
    playNext();
  }

  // ── Text-Chat (SSE) ───────────────────────────────────────────────────
  function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    sendBtn.disabled = true;
    renderChips(null);
    addMsg("user", text);
    history.push({ role: "user", content: text });

    var el = addMsg("a", "…");
    var full = "";
    var spoken = 0;
    var followUp = null;

    fetch(API + "/api/public/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error("chat " + res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.value) {
              buf += dec.decode(r.value, { stream: !r.done });
              var lines = buf.split("\n");
              buf = lines.pop();
              lines.forEach(function (line) {
                if (line.indexOf("data: ") !== 0) return;
                try {
                  var p = JSON.parse(line.slice(6));
                  if (p.content) {
                    full += p.content;
                    el.textContent = full;
                    msgs.scrollTop = msgs.scrollHeight;
                    var rest = full.slice(spoken);
                    var m = rest.match(/^[\s\S]*?[.!?…](\s|$)/);
                    if (m) {
                      speak(m[0]);
                      spoken += m[0].length;
                    }
                  } else if (p.suggestion) {
                    followUp = p.suggestion;
                  }
                } catch (e) {}
              });
            }
            if (!r.done) return pump();
          });
        }
        return pump();
      })
      .then(function () {
        if (!full) {
          el.textContent = "Hmm, da ist etwas schiefgelaufen. Versuch es gleich nochmal.";
        } else {
          if (spoken < full.length) speak(full.slice(spoken));
          history.push({ role: "assistant", content: full });
          if (history.length > 20) history = history.slice(-20);
          if (followUp) renderChips([followUp]);
        }
      })
      .catch(function () {
        el.textContent = "Verbindung fehlgeschlagen — bitte später nochmal versuchen.";
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    voiceMode = false;
    var v = input.value;
    input.value = "";
    send(v);
  });

  // ── Stimme ────────────────────────────────────────────────────────────
  if (cfg.voice === "off") {
    micBtn.style.display = "none";
  } else if (cfg.voice === "agent") {
    // OpenAI Realtime API: echtes Speech-to-Speech, Millisekunden-Latenz
    // statt ElevenLabs' Cloud-Turnaround. Ephemeres Client-Secret kommt vom
    // Server (nur der öffentliche System-Prompt fließt dort ein).
    var session = null;
    var micStream = null;
    var sessionTimer = null;
    var seenHistoryIds = {};
    var SESSION_MAX_MS = 3 * 60 * 1000; // Kostenschutz: harte Kappung pro Gespräch

    function stopAgent() {
      if (sessionTimer) {
        window.clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      if (session) {
        var s = session;
        session = null;
        try { s.close(); } catch (e) {}
      }
      if (micStream) {
        micStream.getTracks().forEach(function (tr) { tr.stop(); });
        micStream = null;
      }
      micBtn.classList.remove("rec");
      mainBtn.classList.remove("lukas-live");
      setStatus("");
    }

    function handleHistory(history) {
      (history || []).forEach(function (item) {
        var id = item.itemId || item.id;
        if (item.type !== "message" || item.role === "system" || !id || seenHistoryIds[id]) return;
        var text = "";
        (item.content || []).forEach(function (c) {
          text += c.text || c.transcript || "";
        });
        text = text.trim();
        if (!text) return;
        seenHistoryIds[id] = true;
        addMsg(item.role === "user" ? "user" : "a", text);
      });
    }

    micBtn.addEventListener("click", function () {
      if (session) return stopAgent();
      micBtn.classList.add("rec");
      setStatus("Verbinde…");

      // Mikro-Berechtigung SOFORT anfragen, im selben Tick wie der Klick —
      // nicht erst nachdem das SDK per Netzwerk geladen und eine Session
      // abgefragt wurde. Mobile Browser (v.a. iOS Safari) verlangen, dass
      // getUserMedia direkt auf eine Nutzergeste folgt; nach async Arbeit
      // dazwischen wird die Anfrage sonst stillschweigend blockiert — das
      // ließ die Stimme auf dem Desktop funktionieren, mobil aber nicht.
      // Diesen Stream (mit expliziter Echo-Unterdrückung) geben wir dem SDK
      // direkt weiter (statt es seinen eigenen holen zu lassen) — ohne
      // echoCancellation hört das Mikro (v.a. am Handylautsprecher) Lukas'
      // eigene Stimme mit, das führte zu Phantom-"Antworten" und einer
      // Endlosschleife aus sich selbst unterbrechenden Reaktionen.
      var micPromise =
        navigator.mediaDevices && navigator.mediaDevices.getUserMedia
          ? navigator.mediaDevices
              .getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              })
              .then(function (stream) {
                micStream = stream;
                return true;
              })
              .catch(function () { return false; })
          : Promise.resolve(true);

      Promise.all([micPromise, loadSdk(), prefetchSession()])
        .then(function (results) {
          var micOk = results[0];
          var sdk = results[1];
          var s = results[2];
          pendingSession = null; // Client-Secret ist Einweg — nächstes Mal frisch holen
          if (!micOk || !micStream) throw new Error("Mikrofonzugriff verweigert");

          var agent = new sdk.RealtimeAgent({ name: "Lukas" });
          var rt = new sdk.RealtimeSession(agent, {
            model: s.model,
            transport: new sdk.OpenAIRealtimeWebRTC({ mediaStream: micStream }),
          });

          rt.on("audio_start", function () {
            mainBtn.classList.add("lukas-live");
            setStatus("Lukas spricht…");
          });
          rt.on("audio_stopped", function () {
            setStatus("Lukas hört zu…");
          });
          rt.on("history_updated", handleHistory);
          rt.on("error", function () {
            stopAgent();
            addMsg("a", "Sprachverbindung fehlgeschlagen.");
          });

          return rt.connect({ apiKey: s.value }).then(function () {
            session = rt;
            setStatus("Sprich einfach — Lukas hört zu.");
            sessionTimer = window.setTimeout(function () {
              stopAgent();
              addMsg("a", "Die Zeit für dieses Gespräch ist um — gerne nochmal starten!");
            }, SESSION_MAX_MS);
          });
        })
        .catch(function (err) {
          stopAgent();
          addMsg("a", "Voice nicht verfügbar: " + (err && err.message ? err.message : "unbekannt"));
        });
    });
  } else {
    // Klassisch: Browser-Spracherkennung + Server-TTS
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.style.display = "none";
    } else {
      var rec = new SR();
      rec.lang =
        document.documentElement.lang && document.documentElement.lang.indexOf("en") === 0 ? "en-US" : "de-DE";
      rec.interimResults = true;
      var recActive = false;

      rec.onresult = function (e) {
        var txt = "";
        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        input.value = txt;
        if (e.results[e.results.length - 1].isFinal) {
          rec.stop();
          voiceMode = true;
          var v = input.value;
          input.value = "";
          send(v);
        }
      };
      rec.onend = function () {
        recActive = false;
        micBtn.classList.remove("rec");
      };
      rec.onerror = rec.onend;

      micBtn.addEventListener("click", function () {
        if (recActive) return rec.stop();
        recActive = true;
        micBtn.classList.add("rec");
        rec.start();
      });
    }
  }
})();
