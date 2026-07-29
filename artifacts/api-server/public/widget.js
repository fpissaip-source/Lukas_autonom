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
 *   data-radius         Eckenradius, z.B. "0px" oder "24px" (nur Desktop —
 *                       auf Mobil ist das Panel bewusst randlos/vollflächig)
 *   data-position       "bottom-right" (Standard) | "bottom-left"
 *   data-width          Panelbreite  (Standard 380px, nur Desktop)
 *   data-height         Panelhöhe    (Standard 520px, nur Desktop)
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
 *   data-voice="agent"   OpenAI Realtime API — direkte WebRTC-Verbindung im
 *                        Browser (keine externe SDK-Abhängigkeit), echtes
 *                        Speech-to-Speech, Millisekunden-Latenz. Aus
 *                        Kostenschutz-Gründen ist das Gespräch auf ein paar
 *                        Minuten pro Session gedeckelt.
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
    radius: ds.radius || "20px",
    position: ds.position === "bottom-left" ? "left" : "right",
    width: ds.width || "380px",
    height: ds.height || "560px",
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
    dark: { bg: "#0c0c14", panel: "#15151f", text: "#eeeef4", muted: "#8d8da3", border: "#26263a", bubble: "#1c1c2a" },
    light: { bg: "#ffffff", panel: "#f6f6f9", text: "#16161f", muted: "#6b6b7c", border: "#e2e2ea", bubble: "#f0f0f4" },
  };
  var t = themes[cfg.theme];
  if (cfg.bg) t.bg = cfg.bg;
  if (cfg.text) t.text = cfg.text;

  // ── Styles (alles über Variablen; Host-CSS kann jede Klasse überschreiben)
  // Wichtig: Eingabefelder haben mind. 16px Schrift — darunter zoomt iOS
  // Safari beim Fokussieren automatisch in die Seite hinein (der Effekt, der
  // sich wie "das Panel ist rein-/rausgezoomt" anfühlt). Auf schmalen
  // Bildschirmen wird das Panel außerdem komplett vollflächig statt als
  // kleines schwebendes Fenster, in dem nicht alle Elemente gleichzeitig
  // sichtbar sind.
  var css =
    ".lukas-w{--lukas-accent:" + cfg.accent + ";--lukas-accent-2:" + cfg.accent2 + ";--lukas-bg:" + t.bg +
    ";--lukas-panel-bg:" + t.panel + ";--lukas-text:" + t.text + ";--lukas-muted:" + t.muted +
    ";--lukas-border:" + t.border + ";--lukas-bubble:" + t.bubble + ";--lukas-radius:" + cfg.radius +
    ";--lukas-width:" + cfg.width + ";--lukas-height:" + cfg.height + ";--lukas-font:" + cfg.font + ";" +
    "position:fixed;bottom:max(20px,env(safe-area-inset-bottom));" +
    (cfg.position === "left" ? "left:max(20px,env(safe-area-inset-left));" : "right:max(20px,env(safe-area-inset-right));") +
    "z-index:2147483000;font-family:var(--lukas-font)}" +
    ".lukas-w *{box-sizing:border-box}" +
    ".lukas-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));color:#fff;font-size:26px;box-shadow:0 10px 30px -6px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08) inset;transition:transform .2s ease,box-shadow .2s ease}" +
    ".lukas-btn:hover{transform:scale(1.06);box-shadow:0 14px 36px -6px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.1) inset}" +
    ".lukas-btn:active{transform:scale(0.96)}" +
    ".lukas-btn.lukas-live{animation:lukas-pulse 1.2s infinite}" +
    ".lukas-panel{display:none;flex-direction:column;position:absolute;bottom:76px;" +
    (cfg.position === "left" ? "left:0;" : "right:0;") +
    "width:min(var(--lukas-width),calc(100vw - 32px));height:min(var(--lukas-height),calc(100vh - 120px));" +
    "background:var(--lukas-bg);color:var(--lukas-text);border:1px solid var(--lukas-border);border-radius:var(--lukas-radius);" +
    "overflow:hidden;box-shadow:0 24px 70px -16px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.04) inset}" +
    ".lukas-panel.open{display:flex}" +
    ".lukas-head{padding:14px 8px 14px 16px;background:var(--lukas-panel-bg);border-bottom:1px solid var(--lukas-border);display:flex;align-items:center;gap:10px;flex:none}" +
    ".lukas-head-info{flex:1;min-width:0}" +
    ".lukas-head b{font-size:14px;display:block;line-height:1.3}" +
    ".lukas-head span{font-size:11.5px;color:var(--lukas-muted);display:block;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".lukas-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex:none;box-shadow:0 0 0 3px rgba(34,197,94,.18)}" +
    ".lukas-close{flex:none;width:32px;height:32px;border-radius:50%;border:none;background:transparent;color:var(--lukas-muted);cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}" +
    ".lukas-close:hover{background:var(--lukas-bubble);color:var(--lukas-text)}" +
    ".lukas-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;display:flex;flex-direction:column;gap:10px}" +
    ".lukas-m{max-width:85%;padding:10px 13px;border-radius:calc(var(--lukas-radius)*.65);font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}" +
    ".lukas-m.u{align-self:flex-end;background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));color:#fff;border-bottom-right-radius:4px}" +
    ".lukas-m.a{align-self:flex-start;background:var(--lukas-bubble);border:1px solid var(--lukas-border);border-bottom-left-radius:4px}" +
    ".lukas-suggest{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px;flex:none}" +
    ".lukas-suggest:empty{display:none;padding:0}" +
    ".lukas-chip{border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);border-radius:999px;padding:7px 13px;font-size:12.5px;line-height:1.3;cursor:pointer;text-align:left;transition:border-color .15s,background .15s}" +
    ".lukas-chip:hover{border-color:var(--lukas-accent);background:var(--lukas-panel-bg)}" +
    ".lukas-status{font-size:11.5px;color:var(--lukas-muted);text-align:center;padding:0 12px 8px;flex:none}" +
    ".lukas-form{display:flex;align-items:center;gap:8px;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom));border-top:1px solid var(--lukas-border);background:var(--lukas-panel-bg);flex:none}" +
    ".lukas-in{flex:1;min-width:0;background:var(--lukas-bg);border:1px solid var(--lukas-border);color:var(--lukas-text);border-radius:999px;padding:11px 15px;font-size:16px;outline:none;transition:border-color .15s}" +
    ".lukas-in:focus{border-color:var(--lukas-accent)}" +
    ".lukas-ic{width:40px;height:40px;flex:none;border-radius:50%;border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s,transform .15s}" +
    ".lukas-ic:hover{border-color:var(--lukas-accent)}" +
    ".lukas-ic:active{transform:scale(0.94)}" +
    ".lukas-ic:disabled{opacity:.4;cursor:default;transform:none}" +
    ".lukas-ic.rec{background:#dc2626;border-color:#dc2626;color:#fff;animation:lukas-pulse 1s infinite}" +
    ".lukas-send{background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));border-color:transparent;color:#fff}" +
    "@keyframes lukas-pulse{50%{opacity:.55}}" +
    "@media (max-width:640px){" +
    ".lukas-panel{position:fixed;inset:0;width:100%;height:100dvh;height:100svh;border-radius:0;border-width:0}" +
    ".lukas-head{padding-top:max(14px,env(safe-area-inset-top))}" +
    ".lukas-close{width:36px;height:36px;font-size:20px}" +
    // Die fixierte Panel-Overlay-Schicht liegt später im DOM als der
    // schwebende Button, malt also sonst über ihn drüber — solange das
    // Panel (jetzt vollflächig) offen ist, braucht es den Button ohnehin
    // nicht, der eigene Schließen-Button im Header übernimmt das.
    ".lukas-panel.open ~ .lukas-btn{display:none}" +
    "}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────
  var root = document.createElement("div");
  root.className = "lukas-w";
  root.innerHTML =
    '<div class="lukas-panel">' +
    '<div class="lukas-head"><div class="lukas-dot"></div>' +
    '<div class="lukas-head-info"><b></b><span></span></div>' +
    '<button type="button" class="lukas-close" aria-label="Schließen">✕</button></div>' +
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
  var closeBtn = root.querySelector(".lukas-close");
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

  // ── Realtime-Client-Secret vorladen (Latenz): schon beim Öffnen des
  // Panels anfordern, nicht erst beim Mikro-Klick — sonst zieht sich das
  // "Verbinden…" spürbar hin, weil dann erst noch eine Session vom Server
  // geholt werden muss, bevor die WebRTC-Verbindung überhaupt starten kann.
  var pendingSession = null;
  var pendingSessionAt = 0;
  var SESSION_PREFETCH_MAX_AGE_MS = 4 * 60 * 1000; // Secret läuft nach 5min ab
  function prefetchSession() {
    var age = Date.now() - pendingSessionAt;
    if (pendingSession && age < SESSION_PREFETCH_MAX_AGE_MS) return pendingSession;
    pendingSessionAt = Date.now();
    pendingSession = fetch(API + "/api/public/realtime-session", { method: "POST" }).then(function (r) {
      if (!r.ok) {
        return r
          .json()
          .catch(function () { return null; })
          .then(function (body) {
            var detail = body && (body.detail || body.error);
            throw new Error(detail || "Session " + r.status);
          });
      }
      return r.json();
    });
    pendingSession.catch(function () {
      pendingSession = null;
    });
    return pendingSession;
  }

  function setOpen(open) {
    panel.classList.toggle("open", open);
    if (open) {
      input.focus();
      if (!history.length) {
        addMsg("a", cfg.greeting);
        renderChips(STARTER_QUESTIONS);
      }
      if (cfg.voice === "agent") prefetchSession();
    }
  }

  mainBtn.addEventListener("click", function () {
    setOpen(!panel.classList.contains("open"));
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
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

  // Die Eingabe-Transkription (gpt-4o-mini-transcribe) halluziniert bei sehr
  // kurzen, leisen oder abgeschnittenen Audio-Schnipseln gelegentlich Text in
  // einer völlig fremden Schrift. Auf issahareb.me tauchte so mitten in einem
  // deutschen Gespräch eine koreanische Zeile in der eigenen Sprechblase auf.
  //
  // Der language-Hinweis der Session (transcription.language = "de", siehe
  // routes/public.ts) ist bereits gesetzt und verhindert das NICHT: er
  // gewichtet die Erkennung, er erzwingt sie nicht.
  //
  // Verwerfen ist hier gefahrlos, weil das Transkript reine Anzeige ist: das
  // Modell hört das Audio direkt (Speech-to-Speech). Genau deshalb war die
  // Antwort im Fehlerfall auch inhaltlich korrekt, während die Blase Unsinn
  // zeigte. Dem Nutzer Worte anzuzeigen, die er nie gesagt hat, ist schlimmer
  // als gar keine Blase — der Gesprächsfluss bleibt unberührt.
  //
  // Gilt ausdrücklich nur für den Sprach-Pfad. Getippter Text (siehe send())
  // wird nie gefiltert: den hat der Nutzer bewusst so eingegeben, in welcher
  // Schrift auch immer.
  function isHallucinatedTranscript(text) {
    var letters = text.match(/\p{L}/gu);
    // Zu kurz für eine belastbare Aussage — im Zweifel anzeigen.
    if (!letters || letters.length < 3) return false;
    var latin = text.match(/\p{Script=Latin}/gu);
    return (latin ? latin.length : 0) / letters.length < 0.5;
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
    // OpenAI Realtime API: direkte WebRTC-Verbindung im Browser, ohne
    // externe SDK-Abhängigkeit (bewusst kein CDN-Import — das erwies sich
    // als unzuverlässig: das Mikro blinkte kurz rot auf und tat dann
    // nichts, weil das dynamisch geladene SDK-Bundle in freier Wildbahn
    // nicht zuverlässig funktionierte). Das Verbindungsprotokoll (POST der
    // SDP-Offer an /v1/realtime/calls mit dem ephemeren Client-Secret als
    // Bearer-Token) ist 1:1 aus dem echten SDK-Quellcode übernommen.
    var pc = null;
    var dc = null;
    var micStream = null;
    var audioEl = null;
    var sessionTimer = null;
    var SESSION_MAX_MS = 3 * 60 * 1000; // Kostenschutz: harte Kappung pro Gespräch

    function stopAgent() {
      if (sessionTimer) {
        window.clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      if (dc) {
        try { dc.close(); } catch (e) {}
        dc = null;
      }
      if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
      }
      if (micStream) {
        micStream.getTracks().forEach(function (tr) { tr.stop(); });
        micStream = null;
      }
      if (audioEl) {
        try { audioEl.pause(); } catch (e) {}
        audioEl.srcObject = null;
        audioEl.remove();
        audioEl = null;
      }
      micBtn.classList.remove("rec");
      mainBtn.classList.remove("lukas-live");
      setStatus("");
    }

    micBtn.addEventListener("click", function () {
      if (pc) return stopAgent();
      micBtn.classList.add("rec");
      setStatus("Verbinde…");

      // Mikro-Berechtigung SOFORT anfragen, im selben Tick wie der Klick —
      // Mobile Browser (v.a. iOS Safari) verlangen, dass getUserMedia
      // direkt auf eine Nutzergeste folgt, sonst wird die Anfrage nach
      // async Arbeit dazwischen stillschweigend blockiert. Explizite Echo-
      // Unterdrückung: sonst hört das Mikro (v.a. am Handylautsprecher)
      // Lukas' eigene Stimme mit und "antwortet" sich selbst in einer Schleife.
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
          : Promise.resolve(false);

      Promise.all([micPromise, prefetchSession()])
        .then(function (results) {
          var micOk = results[0];
          var s = results[1];
          pendingSession = null; // Client-Secret ist Einweg — nächstes Mal frisch holen
          if (!micOk || !micStream) throw new Error("Mikrofonzugriff verweigert");

          pc = new RTCPeerConnection();
          audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          pc.ontrack = function (e) {
            audioEl.srcObject = e.streams[0];
          };
          pc.addTrack(micStream.getAudioTracks()[0], micStream);

          dc = pc.createDataChannel("oai-events");
          dc.addEventListener("message", function (ev) {
            var evt;
            try { evt = JSON.parse(ev.data); } catch (e) { return; }
            if (!evt || !evt.type) return;
            if (evt.type === "response.created") {
              mainBtn.classList.add("lukas-live");
              setStatus("Lukas spricht…");
            } else if (evt.type === "output_audio_buffer.started") {
              // Mikro stummschalten, solange Lukas' eigene Stimme über den
              // Lautsprecher läuft — echoCancellation allein reicht auf vielen
              // Geräten (v.a. ohne Headset/Bluetooth) nicht aus, das Mikro hört
              // dann Lukas mit, der sich selbst "hört" und sich unterbricht
              // bzw. auf sich selbst antwortet.
              if (micStream) micStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
            } else if (evt.type === "output_audio_buffer.stopped") {
              if (micStream) micStream.getAudioTracks().forEach(function (t) { t.enabled = true; });
            } else if (evt.type === "response.done") {
              setStatus("Lukas hört zu…");
            } else if (evt.type === "response.output_audio_transcript.done" && evt.transcript) {
              addMsg("a", evt.transcript);
            } else if (evt.type === "conversation.item.input_audio_transcription.completed" && evt.transcript) {
              if (!isHallucinatedTranscript(evt.transcript)) addMsg("user", evt.transcript);
            } else if (evt.type === "error") {
              addMsg("a", "Sprachfehler: " + (evt.error && evt.error.message ? evt.error.message : "unbekannt"));
            }
          });
          dc.addEventListener("close", function () {
            if (pc) stopAgent();
          });

          return pc
            .createOffer()
            .then(function (offer) {
              return pc.setLocalDescription(offer).then(function () {
                return offer;
              });
            })
            .then(function (offer) {
              return fetch("https://api.openai.com/v1/realtime/calls", {
                method: "POST",
                body: offer.sdp,
                headers: { "Content-Type": "application/sdp", Authorization: "Bearer " + s.value },
              });
            })
            .then(function (resp) {
              if (!resp.ok) throw new Error("Verbindung fehlgeschlagen (" + resp.status + ")");
              return resp.text();
            })
            .then(function (answerSdp) {
              return pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
            })
            .then(function () {
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
