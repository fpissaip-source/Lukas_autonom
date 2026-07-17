/*
 * Lukas Widget — einbettbarer Chat/Voice-Assistent für die Portfolio-Seite.
 *
 * Einbindung:
 *   <script src="https://DEINE-LUKAS-DOMAIN/widget.js" data-api="https://DEINE-LUKAS-DOMAIN" defer></script>
 *
 * data-api  Basis-URL des Lukas-API-Servers (ohne /api). Fehlt es, wird der
 *           Host verwendet, von dem widget.js geladen wurde.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var API = (script && script.dataset.api) || (script ? new URL(script.src).origin : "");
  API = API.replace(/\/+$/, "");

  // ── Styles ────────────────────────────────────────────────────────────
  var css = [
    "#lukas-w{position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,-apple-system,sans-serif}",
    "#lukas-w *{box-sizing:border-box}",
    "#lukas-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#6d28d9,#2563eb);color:#fff;font-size:26px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .15s}",
    "#lukas-btn:hover{transform:scale(1.08)}",
    "#lukas-panel{display:none;flex-direction:column;position:absolute;bottom:76px;right:0;width:min(380px,calc(100vw - 32px));height:520px;background:#0f0f1a;color:#e5e5f0;border:1px solid #2a2a4e;border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.5)}",
    "#lukas-head{padding:14px 16px;background:#161628;border-bottom:1px solid #2a2a4e;display:flex;align-items:center;gap:10px}",
    "#lukas-head b{font-size:14px}",
    "#lukas-head span{font-size:11px;color:#8b8ba7}",
    "#lukas-dot{width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}",
    "#lukas-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}",
    ".lukas-m{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}",
    ".lukas-m.u{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px}",
    ".lukas-m.a{align-self:flex-start;background:#1d1d33;border:1px solid #2a2a4e;border-bottom-left-radius:4px}",
    "#lukas-form{display:flex;gap:8px;padding:12px;border-top:1px solid #2a2a4e;background:#161628}",
    "#lukas-in{flex:1;background:#0f0f1a;border:1px solid #3a3a5e;color:#e5e5f0;border-radius:10px;padding:9px 12px;font-size:13.5px;outline:none}",
    "#lukas-in:focus{border-color:#6d28d9}",
    ".lukas-ic{width:38px;height:38px;flex:none;border-radius:10px;border:1px solid #3a3a5e;background:#1d1d33;color:#e5e5f0;cursor:pointer;font-size:16px}",
    ".lukas-ic:disabled{opacity:.4;cursor:default}",
    ".lukas-ic.rec{background:#dc2626;border-color:#dc2626;animation:lukas-pulse 1s infinite}",
    "@keyframes lukas-pulse{50%{opacity:.6}}",
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────
  var root = document.createElement("div");
  root.id = "lukas-w";
  root.innerHTML =
    '<div id="lukas-panel">' +
    '<div id="lukas-head"><div id="lukas-dot"></div><div><b>Lukas</b><br><span>Issas KI-Agent — frag mich was</span></div></div>' +
    '<div id="lukas-msgs"></div>' +
    '<form id="lukas-form">' +
    '<input id="lukas-in" autocomplete="off" placeholder="Frag mich etwas über Issa…">' +
    '<button type="button" class="lukas-ic" id="lukas-mic" title="Sprechen">🎤</button>' +
    '<button type="submit" class="lukas-ic" id="lukas-send" title="Senden">➤</button>' +
    "</form></div>" +
    '<button id="lukas-btn" title="Mit Lukas sprechen">🤖</button>';
  document.body.appendChild(root);

  var panel = document.getElementById("lukas-panel");
  var msgs = document.getElementById("lukas-msgs");
  var form = document.getElementById("lukas-form");
  var input = document.getElementById("lukas-in");
  var micBtn = document.getElementById("lukas-mic");
  var sendBtn = document.getElementById("lukas-send");

  document.getElementById("lukas-btn").addEventListener("click", function () {
    var open = panel.style.display === "flex";
    panel.style.display = open ? "none" : "flex";
    if (!open) {
      input.focus();
      if (!history.length) addMsg("a", "Hey! Ich bin Lukas, Issas KI-Agent. Frag mich etwas über ihn oder seine Projekte — tippen oder aufs Mikro drücken.");
    }
  });

  var history = [];
  var busy = false;
  var voiceMode = false;

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "lukas-m " + (role === "user" ? "u" : "a");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  // ── Audio-Queue (satzweises TTS für schnelle erste Audio-Ausgabe) ─────
  var audioQueue = [];
  var playing = false;

  function playNext() {
    if (playing || audioQueue.length === 0) return;
    playing = true;
    var url = audioQueue.shift();
    var audio = new Audio(url);
    audio.onended = audio.onerror = function () {
      URL.revokeObjectURL(url);
      playing = false;
      playNext();
    };
    audio.play().catch(function () {
      playing = false;
    });
  }

  function speak(sentence) {
    if (!voiceMode || !sentence.trim()) return;
    fetch(API + "/api/public/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("tts " + r.status);
        return r.blob();
      })
      .then(function (blob) {
        audioQueue.push(URL.createObjectURL(blob));
        playNext();
      })
      .catch(function () {});
  }

  // ── Chat (SSE) ────────────────────────────────────────────────────────
  function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    sendBtn.disabled = true;
    addMsg("user", text);
    history.push({ role: "user", content: text });

    var el = addMsg("a", "…");
    var full = "";
    var spoken = 0; // Index bis zu dem bereits vorgelesen wurde

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
                    // Satzweise vorlesen, sobald ein Satzende auftaucht
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
    var t = input.value;
    input.value = "";
    send(t);
  });

  // ── Spracheingabe (Web Speech API — sofort, ohne Server) ─────────────
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.style.display = "none";
  } else {
    var rec = new SR();
    rec.lang = document.documentElement.lang && document.documentElement.lang.indexOf("en") === 0 ? "en-US" : "de-DE";
    rec.interimResults = true;
    var recActive = false;

    rec.onresult = function (e) {
      var t = "";
      for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
      if (e.results[e.results.length - 1].isFinal) {
        rec.stop();
        voiceMode = true; // Antwort wird vorgelesen
        var text = input.value;
        input.value = "";
        send(text);
      }
    };
    rec.onend = function () {
      recActive = false;
      micBtn.classList.remove("rec");
    };
    rec.onerror = rec.onend;

    micBtn.addEventListener("click", function () {
      if (recActive) {
        rec.stop();
        return;
      }
      recActive = true;
      micBtn.classList.add("rec");
      rec.start();
    });
  }
})();
