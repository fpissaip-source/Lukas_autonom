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
 *   data-voice="agent"   + data-agent-id="…": ElevenLabs Agents (WebRTC,
 *                        Sub-Sekunden-Latenz, echtes Turn-Taking). SDK wird
 *                        erst beim ersten Mikro-Klick geladen.
 *   data-voice="classic" Browser-Spracherkennung + Server-TTS (Fallback,
 *                        automatisch wenn keine agent-id vorhanden).
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
    voice: ds.voice || (ds.agentId ? "agent" : "classic"),
    agentId: ds.agentId || "",
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

  mainBtn.addEventListener("click", function () {
    var open = panel.style.display === "flex";
    panel.style.display = open ? "none" : "flex";
    if (!open) {
      input.focus();
      if (!history.length) addMsg("a", cfg.greeting);
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
    addMsg("user", text);
    history.push({ role: "user", content: text });

    var el = addMsg("a", "…");
    var full = "";
    var spoken = 0;

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
    // ElevenLabs Agents: WebRTC-Konversation mit Lukas' Gehirn (Custom LLM)
    var conversation = null;
    var sdkPromise = null;

    function loadSdk() {
      if (!sdkPromise) {
        sdkPromise = import("https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm");
      }
      return sdkPromise;
    }

    function stopAgent() {
      if (conversation) {
        var c = conversation;
        conversation = null;
        c.endSession().catch(function () {});
      }
      micBtn.classList.remove("rec");
      mainBtn.classList.remove("lukas-live");
      setStatus("");
    }

    micBtn.addEventListener("click", function () {
      if (conversation) return stopAgent();
      micBtn.classList.add("rec");
      setStatus("Verbinde…");

      Promise.all([
        loadSdk(),
        fetch(API + "/api/public/voice-session" + (cfg.agentId ? "?agent_id=" + encodeURIComponent(cfg.agentId) : ""))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; }),
      ])
        .then(function (results) {
          var sdk = results[0];
          var session = results[1];
          var opts = {
            onConnect: function () {
              mainBtn.classList.add("lukas-live");
              setStatus("Sprich einfach — Lukas hört zu.");
            },
            onDisconnect: function () { stopAgent(); },
            onError: function () { stopAgent(); addMsg("a", "Sprachverbindung fehlgeschlagen."); },
            onModeChange: function (m) {
              setStatus(m && m.mode === "speaking" ? "Lukas spricht…" : "Lukas hört zu…");
            },
            onMessage: function (msg) {
              if (!msg) return;
              var srcUser = msg.source === "user";
              var text = msg.message || "";
              if (text) addMsg(srcUser ? "user" : "a", text);
            },
          };
          if (session && session.signedUrl) opts.signedUrl = session.signedUrl;
          else if (cfg.agentId) opts.agentId = cfg.agentId;
          else if (session && session.agentId) opts.agentId = session.agentId;
          else throw new Error("Keine Agent-ID konfiguriert");
          return sdk.Conversation.startSession(opts);
        })
        .then(function (conv) {
          conversation = conv;
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
