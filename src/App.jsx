import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { enableNotifications, onForegroundMessage } from "./notifications";
import { ref, onValue, set, update, runTransaction, push, remove } from "firebase/database";

// ── palette & constants ───────────────────────────────────────────────────────
const PALETTE = [
  "#c0533e","#3f6b8a","#cf8a3c","#7a8c3f","#9a5b8f",
  "#3f8a72","#b06a8e","#6a7fb0","#a87b3f","#4f9090","#8a5a3f","#7a4040"
];
// ── court timing helpers ─────────────────────────────────────────────────────
// Court convenes every Friday at 3:00 PM and adjourns at 5:00 PM — a 2-hour
// window. Outside that window, it's back to the countdown for next Friday.
function isCourtOpenNow(d = new Date()) {
  return d.getDay() === 5 && d.getHours() >= 15 && d.getHours() < 17;
}
function getNextFriday3PM(d = new Date()) {
  const target = new Date(d);
  target.setHours(15, 0, 0, 0);
  const closeTime = new Date(d);
  closeTime.setHours(17, 0, 0, 0);
  let diff = (5 - d.getDay() + 7) % 7;
  // If it's Friday and we're already past the 5PM close, the next session is next week.
  if (diff === 0 && d >= closeTime) diff = 7;
  target.setDate(d.getDate() + diff);
  return target;
}
function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00:00";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hrs  = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = n => String(n).padStart(2, "0");
  return `${pad(days)}:${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}
function getCaseNumber(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - start) / 86400000) + start.getDay() + 1) / 7);
  return `SESHANS/${d.getFullYear()}/W${String(week).padStart(2, "0")}`;
}
// ── gavel sound (synthesized — no audio file needed) ─────────────────────────
function playGavel() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // low thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.3);
    // crack (filtered noise burst)
    const bufferSize = ctx.sampleRate * 0.06;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass"; noiseFilter.frequency.value = 800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(ctx.destination);
    noise.start(now);
    setTimeout(() => ctx.close(), 500);
  } catch (_) { /* audio not available — silently skip */ }
}

// ── CSS injection ─────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; }
  ::-webkit-scrollbar { height: 5px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,0.1); border-radius: 4px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 4px; }
  @keyframes wave {
    from { transform: translateX(0); }
    to   { transform: translateX(-22px); }
  }
  @keyframes pop {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
  @keyframes slideUp {
    from { opacity:0; transform: translateY(20px); }
    to   { opacity:1; transform: translateY(0); }
  }
  @keyframes glow {
    0%,100% { box-shadow: 0 0 8px rgba(232,192,116,0.4); }
    50%      { box-shadow: 0 0 22px rgba(232,192,116,0.9); }
  }
  @keyframes shake {
    0%,100% { transform: translate(0,0); }
    20%     { transform: translate(-6px,2px); }
    40%     { transform: translate(5px,-2px); }
    60%     { transform: translate(-4px,1px); }
    80%     { transform: translate(3px,-1px); }
  }
  @keyframes confettiFall {
    0%   { transform: translateY(-20px) rotate(0deg); opacity:1; }
    100% { transform: translateY(420px) rotate(540deg); opacity:0; }
  }
  @keyframes gavelSwing {
    0%   { transform: rotate(0deg); }
    30%  { transform: rotate(-28deg); }
    55%  { transform: rotate(8deg); }
    100% { transform: rotate(0deg); }
  }
  @keyframes blink {
    0%,100% { opacity:1; } 50% { opacity:0.3; }
  }
  .jar-col { display:flex; flex-direction:column; align-items:center; position:relative; flex-shrink:0; }
  .btn-circle {
    width:26px; height:26px; border-radius:50%; border:none;
    background:rgba(255,255,255,0.88); color:#1f3a30;
    font-size:0.9rem; font-weight:700; cursor:pointer;
    transition: transform 0.12s ease, background 0.12s ease;
    display:flex; align-items:center; justify-content:center;
  }
  .btn-circle:hover { transform:scale(1.15); background:#fff; }
  .btn-circle:active { transform:scale(0.9); }
  .pop { animation: pop 0.3s ease; }
`;

// ── svg figures ───────────────────────────────────────────────────────────────
function MaleSVG({ color, size = 42 }) {
  return (
    <svg width={size} viewBox="0 0 60 92" style={{ display: "block" }}>
      <circle cx="30" cy="17" r="13" fill="#2e2018" />
      <circle cx="30" cy="19" r="10" fill="#e3a978" />
      {/* smile */}
      <path d="M26 22 Q30 26 34 22" stroke="#c8875a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      <rect x="15" y="33" width="30" height="34" rx="8" fill={color} />
      <rect x="10" y="39" width="8"  height="22" rx="4" fill="#e3a978" />
      <rect x="42" y="39" width="8"  height="22" rx="4" fill="#e3a978" />
      <rect x="19" y="65" width="9"  height="16" rx="4" fill="#2b2b2b" />
      <rect x="32" y="65" width="9"  height="16" rx="4" fill="#2b2b2b" />
    </svg>
  );
}

function FemaleSVG({ color, size = 42 }) {
  return (
    <svg width={size} viewBox="0 0 60 92" style={{ display: "block" }}>
      {/* hair */}
      <ellipse cx="30" cy="16" rx="13" ry="14" fill="#2b1c12" />
      <ellipse cx="30" cy="19" rx="10" ry="10" fill="#e8b894" />
      {/* hair sides */}
      <rect x="17" y="14" width="5" height="18" rx="3" fill="#2b1c12" />
      <rect x="38" y="14" width="5" height="18" rx="3" fill="#2b1c12" />
      {/* smile */}
      <path d="M26 22 Q30 26 34 22" stroke="#c8875a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      {/* dress */}
      <path d="M18 34 L42 34 L46 68 Q30 76 14 68 Z" fill={color} />
      <rect x="11" y="38" width="7"  height="20" rx="3" fill="#e8b894" />
      <rect x="42" y="38" width="7"  height="20" rx="3" fill="#e8b894" />
      <rect x="20" y="68" width="8"  height="14" rx="3" fill="#3a2a1e" />
      <rect x="32" y="68" width="8"  height="14" rx="3" fill="#3a2a1e" />
    </svg>
  );
}

// ── jar column ────────────────────────────────────────────────────────────────
function JarColumn({ person, color, maxAmt, isTop, onPlus, onMinus, onEditName, popping }) {
  const [editing, setEditing]   = useState(false);
  const [nameVal, setNameVal]   = useState(person.name);
  const inputRef                = useRef(null);

  const MAX_H = 155, MIN_H = 34;
  const jarH    = person.amt === 0 ? MIN_H : MIN_H + (person.amt / maxAmt) * (MAX_H - MIN_H);
  const fillPct = person.amt === 0 ? 0 : 46 + (person.amt / maxAmt) * 46;

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  function saveName() {
    const v = nameVal.trim();
    if (v) onEditName(person.id, v);
    setEditing(false);
  }

  return (
    <div className="jar-col" style={{ width: 72 }}>
      {/* top offender marker */}
      {isTop && (
        <div style={{ position:"absolute", top:-26, fontSize:"1.1rem", zIndex:5, animation:"glow 2s infinite" }}>💩</div>
      )}

      {/* amount */}
      <div style={{
        fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"0.9rem",
        color:"#fff", marginBottom:5, whiteSpace:"nowrap",
        textShadow:"0 1px 4px rgba(0,0,0,0.3)"
      }}>
        ₹{person.amt}
      </div>

      {/* character / photo */}
      <div className={popping ? "pop" : ""} style={{ marginBottom:-5, zIndex:3, position:"relative" }}>
        {person.photo ? (
          <img src={person.photo} alt={person.name} style={{
            width:42, height:42, borderRadius:"50%", objectFit:"cover",
            border:`2px solid ${color}`, boxShadow:`0 2px 8px ${color}66`, display:"block"
          }} />
        ) : (
          person.gender === "f" ? <FemaleSVG color={color} size={42} /> : <MaleSVG color={color} size={42} />
        )}
      </div>

      {/* lid */}
      <div style={{
        width:46, height:7, background:"rgba(255,255,255,0.6)",
        borderRadius:4, margin:"0 auto -1px", zIndex:2,
        boxShadow:"0 2px 4px rgba(0,0,0,0.15)"
      }} />

      {/* jar */}
      <div style={{
        position:"relative", width:54,
        height:jarH, borderRadius:"6px 6px 12px 12px",
        background:"rgba(255,255,255,0.12)",
        border:"1.5px solid rgba(255,255,255,0.38)",
        boxShadow:"inset 0 0 10px rgba(255,255,255,0.12), 3px 5px 0 rgba(0,0,0,0.08)",
        overflow:"hidden",
        transition:"height 0.75s cubic-bezier(.34,1.3,.64,1)"
      }}>
        {/* glass shine */}
        <div style={{
          position:"absolute", top:5, left:7, width:6, height:"80%",
          background:"rgba(255,255,255,0.26)", borderRadius:6, zIndex:2
        }} />
        {person.amt === 0
          ? <div style={{ position:"absolute", top:7, right:8, fontSize:"0.7rem", zIndex:3 }}>✨</div>
          : <div style={{
              position:"absolute", bottom:0, left:0, right:0,
              height:`${fillPct}%`,
              background:`linear-gradient(180deg, ${color}aa 0%, ${color} 100%)`,
              transition:"height 0.75s cubic-bezier(.34,1.3,.64,1)"
            }}>
              {/* animated wave surface */}
              <div style={{
                position:"absolute", top:-5, left:0,
                width:"200%", height:10,
                backgroundImage:`radial-gradient(circle, ${color}ff 38%, transparent 40%)`,
                backgroundSize:"22px 10px",
                backgroundRepeat:"repeat-x",
                animation:"wave 2.4s linear infinite",
                opacity:0.7
              }} />
            </div>
        }
      </div>

      {/* name row */}
      <div style={{ marginTop:9, display:"flex", alignItems:"center", gap:3, minHeight:22 }}>
        {editing ? (
          <>
            <input
              ref={inputRef}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveName()}
              maxLength={10}
              style={{
                width:50, fontSize:"0.6rem", textTransform:"uppercase",
                background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.45)",
                borderRadius:5, color:"#fff", padding:"2px 5px", outline:"none"
              }}
            />
            <button onClick={saveName} style={{
              background:"none", border:"none", cursor:"pointer",
              fontSize:"0.65rem", color:"#fff", padding:0, lineHeight:1
            }}>✅</button>
          </>
        ) : (
          <>
            <span style={{
              fontSize:"0.65rem", letterSpacing:"0.6px", textTransform:"uppercase",
              color:"rgba(255,255,255,0.92)", whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis", maxWidth:48
            }}>{person.name}</span>
            <button onClick={() => { setNameVal(person.name); setEditing(true); }} style={{
              background:"none", border:"none", cursor:"pointer",
              fontSize:"0.58rem", opacity:0.55, color:"#fff", padding:0, lineHeight:1
            }}>✏️</button>
          </>
        )}
      </div>

      {/* +/- buttons */}
      <div style={{ display:"flex", gap:6, marginTop:7 }}>
        <button className="btn-circle" onClick={onMinus} title="Undo ₹2">−</button>
        <button className="btn-circle" onClick={onPlus}  title="Charge ₹2">+</button>
      </div>
    </div>
  );
}

// ── confetti piece field ──────────────────────────────────────────────────────
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 36 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 1.6 + Math.random() * 1.1,
      color: PALETTE[i % PALETTE.length],
      size: 5 + Math.random() * 5,
      rotate: Math.random() * 360
    }))
  ).current;
  return (
    <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none", zIndex:5 }}>
      {pieces.map(pc => (
        <div key={pc.id} style={{
          position:"absolute", top:0, left:`${pc.left}%`,
          width:pc.size, height:pc.size * 0.4, background:pc.color,
          transform:`rotate(${pc.rotate}deg)`,
          animation:`confettiFall ${pc.duration}s ease-in ${pc.delay}s forwards`
        }} />
      ))}
    </div>
  );
}

// ── court session ─────────────────────────────────────────────────────────────
function CourtSession({ people, onClose, onBack, colorOf }) {
  const sorted    = [...people].sort((a, b) => b.amt - a.amt);
  const totalPot  = people.reduce((s, p) => s + p.amt, 0);
  const top       = sorted[0];
  const rest      = sorted.slice(1);
  const hasFines  = top && top.amt > 0;

  const [now, setNow]       = useState(new Date());
  const [stage, setStage]   = useState("intro"); // intro → list → drumroll → verdict
  const [shake, setShake]   = useState(false);
  const [gavel, setGavel]   = useState(false);

  const isOpen = isCourtOpenNow(now);
  const caseNo = getCaseNumber(now);

  // live clock — drives the countdown when court is in recess
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // staged dramatic reveal — only runs once court is actually open
  useEffect(() => {
    if (!isOpen || people.length === 0) return;
    const listMs = 900;
    const drumMs = listMs + rest.length * 220 + 700;
    const verdictMs = drumMs + 1400;
    const t1 = setTimeout(() => setStage("list"), listMs);
    const t2 = setTimeout(() => setStage("drumroll"), drumMs);
    const t3 = setTimeout(() => {
      setStage("verdict");
      setShake(true);
      playGavel();
      setTimeout(() => setShake(false), 500);
    }, verdictMs);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleClose() {
    setGavel(true);
    setTimeout(onClose, 600);
  }

  // ── recess screen — judge isn't in yet ──
  if (!isOpen) {
    const countdown = formatCountdown(getNextFriday3PM(now) - now);
    return (
      <div style={{
        position:"fixed", inset:0,
        background:"linear-gradient(135deg, #0e1e16 0%, #1a3028 60%, #0e1e16 100%)",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        zIndex:300, color:"#fff", fontFamily:"'Inter', sans-serif",
        animation:"slideUp 0.3s ease", padding:"24px"
      }}>
        <div style={{ fontSize:"2.6rem", marginBottom:10, animation:"blink 3s ease infinite" }}>👩‍⚖️</div>
        <div style={{
          fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.25rem",
          color:"#e8c074", textAlign:"center", marginBottom:6
        }}>Court is in recess</div>
        <div style={{
          fontSize:"0.8rem", color:"rgba(255,255,255,0.55)",
          textAlign:"center", marginBottom:32, maxWidth:280, lineHeight:1.6
        }}>
          ബഹുമാനപ്പെട്ട ജഡ്ജി Devika presides only on Fridays, 3:00 PM.<br/>Until then, the jars keep filling.
        </div>

        <div style={{ display:"flex", gap:10, marginBottom:8 }}>
          {["Days","Hrs","Min","Sec"].map((label, i) => (
            <div key={label} style={{
              background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:10, padding:"10px 12px", textAlign:"center", minWidth:56
            }}>
              <div style={{ fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.3rem", color:"#e8c074" }}>
                {countdown.split(":")[i]}
              </div>
              <div style={{ fontSize:"0.6rem", color:"rgba(255,255,255,0.4)", letterSpacing:1 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:"0.68rem", color:"rgba(255,255,255,0.3)", marginBottom:36 }}>until next session</div>

        {totalPot > 0 && (
          <div style={{
            padding:"6px 16px", borderRadius:20, marginBottom:30,
            background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
            fontSize:"0.78rem", color:"rgba(255,255,255,0.6)"
          }}>🏺 Pot building: <strong style={{ color:"#e8c074" }}>₹{totalPot}</strong></div>
        )}

        <button onClick={onBack} style={{
          padding:"12px 28px", borderRadius:12, width:"100%", maxWidth:280,
          border:"1px solid rgba(255,255,255,0.22)", background:"rgba(255,255,255,0.06)",
          color:"rgba(255,255,255,0.8)", cursor:"pointer", fontSize:"0.88rem", fontWeight:500
        }}>← Back</button>
      </div>
    );
  }

  // ── empty court ──
  if (people.length === 0) {
    return (
      <div style={{
        position:"fixed", inset:0, background:"linear-gradient(135deg, #0e1e16 0%, #1a3028 60%, #0e1e16 100%)",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        zIndex:300, color:"#fff", fontFamily:"'Inter', sans-serif", padding:24, textAlign:"center"
      }}>
        <div style={{ fontSize:"2.2rem", marginBottom:10 }}>👩‍⚖️</div>
        <div style={{ color:"rgba(255,255,255,0.6)", marginBottom:24 }}>No defendants on the docket this week.</div>
        <button onClick={onBack} style={{
          padding:"12px 28px", borderRadius:12,
          border:"1px solid rgba(255,255,255,0.22)", background:"rgba(255,255,255,0.06)",
          color:"rgba(255,255,255,0.8)", cursor:"pointer", fontSize:"0.88rem"
        }}>← Back</button>
      </div>
    );
  }

  // ── court is in session — the ceremony ──
  return (
    <div style={{
      position:"fixed", inset:0,
      background:"linear-gradient(135deg, #0e1e16 0%, #1a3028 60%, #0e1e16 100%)",
      display:"flex", flexDirection:"column", alignItems:"center",
      zIndex:300, color:"#fff", fontFamily:"'Inter', sans-serif",
      animation: shake ? "shake 0.5s ease" : "slideUp 0.3s ease",
      overflow:"hidden"
    }}>
      {stage === "verdict" && <Confetti />}

      <div style={{
        flex:1, overflowY:"auto", width:"100%",
        display:"flex", flexDirection:"column", alignItems:"center",
        padding:"30px 24px 16px", position:"relative", zIndex:2
      }}>
        <div style={{ fontSize:"2.2rem", marginBottom:6, transformOrigin:"top center", animation:"gavelSwing 1.1s ease 0.2s 1" }}>👩‍⚖️</div>
        <div style={{
          fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.4rem",
          color:"#e8c074", letterSpacing:1, marginBottom:3, textAlign:"center"
        }}>COURT IS NOW IN SESSION</div>
        <div style={{
          fontSize:"0.78rem", color:"rgba(255,255,255,0.55)", textAlign:"center", marginBottom:5
        }}>ബഹുമാനപ്പെട്ട ജഡ്ജി Devika presiding</div>
        <div style={{
          fontSize:"0.65rem", letterSpacing:2, textTransform:"uppercase",
          color:"rgba(255,255,255,0.3)", marginBottom:26
        }}>Case No. {caseNo}</div>

        {stage === "intro" && (
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:"0.85rem", marginTop:20, fontStyle:"italic" }}>
            The judge is reviewing this week's conduct…
          </div>
        )}

        {(stage === "list" || stage === "drumroll" || stage === "verdict") && rest.length > 0 && (
          <div style={{ width:"100%", maxWidth:380, marginBottom:18 }}>
            {[...rest].reverse().map((p, i) => (
              <div key={p.id} style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"11px 18px", marginBottom:7,
                background:"rgba(255,255,255,0.05)", borderRadius:11,
                border:"1px solid rgba(255,255,255,0.07)",
                animation:`slideUp 0.3s ease ${i * 0.22}s both`
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:"0.75rem", color:"rgba(255,255,255,0.35)", width:20 }}>
                    #{rest.length - i + 1}
                  </span>
                  <span style={{ fontWeight:600, fontSize:"0.95rem" }}>{p.name}</span>
                </div>
                <span style={{
                  fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.1rem",
                  color: p.amt === 0 ? "rgba(255,255,255,0.25)" : "#e8c074"
                }}>₹{p.amt}</span>
              </div>
            ))}
          </div>
        )}

        {stage === "drumroll" && (
          <div style={{
            fontFamily:"'Fraunces', serif", fontWeight:700, fontSize:"1rem",
            color:"#e8c074", textAlign:"center", margin:"10px 0 20px", animation:"blink 0.8s ease infinite"
          }}>
            ⚖️ And the most fined of the week is…
          </div>
        )}

        {stage === "verdict" && top && (
          <div style={{
            width:"100%", maxWidth:300, margin:"6px 0 22px",
            background: hasFines ? "rgba(232,192,116,0.1)" : "rgba(122,140,63,0.12)",
            border: `2px dashed ${hasFines ? "rgba(232,192,116,0.55)" : "rgba(122,140,63,0.5)"}`,
            borderRadius:16, padding:"22px 18px", textAlign:"center",
            animation:"slideUp 0.4s ease both"
          }}>
            <div style={{ fontSize:"0.68rem", letterSpacing:3, color: hasFines ? "#e8c074" : "#a9c178", marginBottom:10 }}>
              {hasFines ? "🚨 GUILTY AS CHARGED 🚨" : "🎉 CASE DISMISSED 🎉"}
            </div>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
              {top.photo ? (
                <img src={top.photo} alt={top.name} style={{
                  width:56, height:56, borderRadius:"50%", objectFit:"cover",
                  border:`2px solid ${colorOf(top.id)}`, boxShadow:`0 2px 10px ${colorOf(top.id)}66`
                }} />
              ) : (
                top.gender === "f" ? <FemaleSVG color={colorOf(top.id)} size={56} /> : <MaleSVG color={colorOf(top.id)} size={56} />
              )}
            </div>
            <div style={{ fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.3rem", marginBottom:4 }}>
              {top.name}
            </div>
            <div style={{
              fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.7rem",
              color: hasFines ? "#e8c074" : "#a9c178"
            }}>₹{top.amt}</div>
            <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.45)", marginTop:6 }}>
              {hasFines ? "Highest fine of the week" : "Everyone stayed clean this week"}
            </div>
          </div>
        )}

        {stage === "verdict" && (
          <div style={{
            display:"flex", gap:28, marginBottom:8,
            textAlign:"center", color:"rgba(255,255,255,0.6)", fontSize:"0.8rem"
          }}>
            <div>
              <div style={{ fontFamily:"'Fraunces', serif", fontSize:"1.4rem", fontWeight:900, color:"#e8c074", marginBottom:3 }}>
                ₹{totalPot}
              </div>
              Total Pot
            </div>
            <div>
              <div style={{ fontFamily:"'Fraunces', serif", fontSize:"1.4rem", fontWeight:900, color:"#e8c074", marginBottom:3 }}>
                {people.filter(p => p.amt === 0).length}
              </div>
              Stayed clean
            </div>
          </div>
        )}
      </div>

      {/* buttons — always pinned to bottom */}
      <div style={{
        width:"100%", maxWidth:380, padding:"16px 24px 28px",
        display:"flex", flexDirection:"column", gap:10,
        background:"linear-gradient(0deg, #0e1e16 60%, transparent)",
        flexShrink:0, position:"relative", zIndex:2
      }}>
        <button onClick={onBack} style={{
          width:"100%", padding:"12px", borderRadius:12,
          border:"1px solid rgba(255,255,255,0.22)", background:"rgba(255,255,255,0.06)",
          color:"rgba(255,255,255,0.8)", cursor:"pointer", fontSize:"0.88rem", fontWeight:500
        }}>
          ← Back to Leaderboard
        </button>
        {stage === "verdict" && (
          <>
            <button onClick={handleClose} style={{
              width:"100%", padding:"15px", borderRadius:12, border:"none",
              background: gavel ? "#888" : "#c0533e",
              color:"#fff", fontSize:"1rem", fontWeight:700, cursor:"pointer",
              letterSpacing:0.5, transition:"background 0.3s",
              boxShadow: gavel ? "none" : "0 4px 18px rgba(192,83,62,0.45)"
            }}>
              {gavel ? "🔨 Resetting…" : "🔨 Close the Court & Reset"}
            </button>
            <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.25)", textAlign:"center" }}>
              Reset will wipe all fines to ₹0
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Shrinks & center-crops an uploaded photo down to a small square JPEG, so
// storing it directly in the database stays lightweight (no separate file
// storage service needed for a friend-group app this size).
function compressImageToDataUrl(file, size = 160, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── settings ──────────────────────────────────────────────────────────────────
function Settings({ people, onSave, onClose, onOpenHistory }) {
  const [list, setList]         = useState(people.map(p => ({ ...p })));
  const [newName, setNewName]   = useState("");
  const [newGender, setNewGender] = useState("m");
  const counterRef              = useRef(Math.max(...people.map(p => p.id), 0) + 1);

  function addPerson() {
    const name = newName.trim();
    if (!name) return;
    setList(prev => [...prev, { id: counterRef.current++, name, gender: newGender, amt: 0 }]);
    setNewName("");
  }

  function removePerson(id) { setList(prev => prev.filter(p => p.id !== id)); }

  function toggleGender(id) {
    setList(prev => prev.map(p => p.id === id ? { ...p, gender: p.gender === "m" ? "f" : "m" } : p));
  }

  async function handlePhotoChange(id, file) {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setList(prev => prev.map(p => p.id === id ? { ...p, photo: dataUrl } : p));
    } catch (e) { console.error("Photo processing failed:", e); }
  }

  function removePhoto(id) {
    setList(prev => prev.map(p => p.id === id ? { ...p, photo: null } : p));
  }

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.58)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:250
    }}>
      <div style={{
        background:"linear-gradient(145deg, #2a4a38, #1e3328)",
        borderRadius:18, padding:"24px 26px",
        width:340, maxHeight:"88vh", overflowY:"auto",
        color:"#fff", fontFamily:"'Inter', sans-serif",
        boxShadow:"0 20px 60px rgba(0,0,0,0.5)"
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontFamily:"'Fraunces',serif", fontWeight:900, fontSize:"1.1rem" }}>⚙️ Members</div>
          <button onClick={() => onSave(list)} style={{
            padding:"6px 16px", borderRadius:8, border:"none",
            background:"#7a8c3f", color:"#fff", cursor:"pointer",
            fontSize:"0.82rem", fontWeight:600
          }}>Save & Close</button>
        </div>

        {list.map(p => (
          <div key={p.id} style={{
            display:"flex", alignItems:"center", gap:8, marginBottom:9,
            padding:"9px 13px", background:"rgba(255,255,255,0.07)",
            borderRadius:10, border:"1px solid rgba(255,255,255,0.08)"
          }}>
            <label style={{
              width:30, height:30, borderRadius:"50%", flexShrink:0, cursor:"pointer",
              background: p.photo ? "transparent" : "rgba(255,255,255,0.12)",
              display:"flex", alignItems:"center", justifyContent:"center",
              overflow:"hidden", border:"1px solid rgba(255,255,255,0.2)"
            }} title="Tap to add/change photo">
              {p.photo
                ? <img src={p.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                : <span style={{ fontSize:"0.75rem" }}>📷</span>}
              <input type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => handlePhotoChange(p.id, e.target.files[0])} />
            </label>
            {p.photo && (
              <button onClick={() => removePhoto(p.id)} title="Remove photo" style={{
                marginLeft:-14, marginRight:2, width:16, height:16, borderRadius:"50%",
                border:"none", background:"#c0533e", color:"#fff", fontSize:"0.55rem",
                cursor:"pointer", flexShrink:0, lineHeight:1, padding:0
              }}>✕</button>
            )}
            <span style={{ flex:1, fontSize:"0.88rem", fontWeight:500 }}>{p.name}</span>
            <span style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.45)" }}>₹{p.amt}</span>
            <button onClick={() => toggleGender(p.id)} title="Toggle gender" style={{
              padding:"3px 9px", borderRadius:6, border:"none",
              background: p.gender === "m" ? "#3f6b8a" : "#b06a8e",
              color:"#fff", fontSize:"0.72rem", cursor:"pointer"
            }}>{p.gender === "m" ? "♂" : "♀"}</button>
            <button onClick={() => removePerson(p.id)} style={{
              padding:"3px 8px", borderRadius:6, border:"none",
              background:"rgba(192,83,62,0.4)", color:"#fff",
              fontSize:"0.72rem", cursor:"pointer"
            }}>✕</button>
          </div>
        ))}

        {/* add new member */}
        <div style={{
          marginTop:16, padding:"14px 14px 12px",
          background:"rgba(255,255,255,0.05)",
          borderRadius:11, border:"1px dashed rgba(255,255,255,0.18)"
        }}>
          <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.5)", marginBottom:9, letterSpacing:1 }}>
            ADD MEMBER
          </div>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPerson()}
            placeholder="Name…"
            maxLength={12}
            style={{
              width:"100%", padding:"8px 11px", borderRadius:8,
              background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.18)",
              color:"#fff", fontSize:"0.85rem", outline:"none", marginBottom:9,
              fontFamily:"'Inter', sans-serif"
            }}
          />
          <div style={{ display:"flex", gap:7 }}>
            <button onClick={() => setNewGender("m")} style={{
              flex:1, padding:"7px", borderRadius:8, border:"none",
              background: newGender === "m" ? "#3f6b8a" : "rgba(255,255,255,0.1)",
              color:"#fff", fontSize:"0.8rem", cursor:"pointer", fontWeight: newGender==="m"?600:400
            }}>♂ Male</button>
            <button onClick={() => setNewGender("f")} style={{
              flex:1, padding:"7px", borderRadius:8, border:"none",
              background: newGender === "f" ? "#b06a8e" : "rgba(255,255,255,0.1)",
              color:"#fff", fontSize:"0.8rem", cursor:"pointer", fontWeight: newGender==="f"?600:400
            }}>♀ Female</button>
            <button onClick={addPerson} style={{
              flex:1, padding:"7px", borderRadius:8, border:"none",
              background:"#7a8c3f", color:"#fff", fontSize:"0.8rem",
              cursor:"pointer", fontWeight:600
            }}>Add</button>
          </div>
        </div>

        <button onClick={onOpenHistory} style={{
          marginTop:13, width:"100%", padding:"9px", borderRadius:9,
          border:"1px solid rgba(232,192,116,0.3)", background:"rgba(232,192,116,0.08)",
          color:"#e8c074", cursor:"pointer", fontSize:"0.82rem", fontWeight:500
        }}>📜 View History & Backups</button>

        <button onClick={onClose} style={{
          marginTop:9, width:"100%", padding:"9px", borderRadius:9,
          border:"1px solid rgba(255,255,255,0.15)", background:"transparent",
          color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:"0.82rem"
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ── chat ─────────────────────────────────────────────────────────────────────
function ChatPanel({ people, onClose }) {
  const [myName, setMyName]   = useState(() => localStorage.getItem("devikas_chat_name") || "");
  const [messages, setMessages] = useState([]);
  const [text, setText]       = useState("");
  const [notifStatus, setNotifStatus] = useState(
    localStorage.getItem("devikas_fcm_token") ? "on" : "off"
  );
  const [notifError, setNotifError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const msgsRef = ref(db, "chat/messages");
    const unsub = onValue(msgsRef, snapshot => {
      const data = snapshot.val() || {};
      const arr = Object.entries(data)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setMessages(arr);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function pickName(name) {
    setMyName(name);
    localStorage.setItem("devikas_chat_name", name);
  }

  async function handleEnableNotifs() {
    setNotifStatus("asking");
    setNotifError(null);
    const result = await enableNotifications(myName);
    if (result?.token) {
      setNotifStatus("on");
    } else {
      setNotifStatus("off");
      setNotifError(result?.error || "Unknown error");
    }
  }

  async function sendMessage() {
    const trimmed = text.trim();
    if (!trimmed || !myName) return;
    setText("");
    await push(ref(db, "chat/messages"), { name: myName, text: trimmed, ts: Date.now() });
    // fire-and-forget — ask the server to push a notification to everyone else
    fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: myName,
        body: trimmed,
        senderToken: localStorage.getItem("devikas_fcm_token") || ""
      })
    }).catch(() => {}); // if this fails, the chat itself still works fine
  }

  // ── identity picker — first time only ──
  if (!myName) {
    return (
      <div style={{
        position:"fixed", inset:0, background:"linear-gradient(135deg, #0e1e16 0%, #1a3028 60%, #0e1e16 100%)",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        zIndex:300, color:"#fff", fontFamily:"'Inter', sans-serif", padding:24
      }}>
        <div style={{ fontSize:"2rem", marginBottom:14 }}>💬</div>
        <div style={{ fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.2rem", marginBottom:22 }}>
          Which one are you?
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:280, marginBottom:24 }}>
          {people.map(p => (
            <button key={p.id} onClick={() => pickName(p.name)} style={{
              padding:"13px", borderRadius:12, border:"1px solid rgba(255,255,255,0.2)",
              background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:"0.95rem",
              fontWeight:600, cursor:"pointer"
            }}>{p.name}</button>
          ))}
        </div>
        <button onClick={onClose} style={{
          padding:"10px 24px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)",
          background:"transparent", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:"0.85rem"
        }}>← Back</button>
      </div>
    );
  }

  return (
    <div style={{
      position:"fixed", inset:0, background:"linear-gradient(135deg, #0e1e16 0%, #1a3028 60%, #0e1e16 100%)",
      display:"flex", flexDirection:"column", zIndex:300, color:"#fff", fontFamily:"'Inter', sans-serif"
    }}>
      {/* header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"18px 20px 12px", borderBottom:"1px solid rgba(255,255,255,0.08)"
      }}>
        <button onClick={onClose} style={{
          background:"none", border:"none", color:"#fff", fontSize:"1.3rem", cursor:"pointer", padding:0
        }}>←</button>
        <div style={{ fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.05rem" }}>💬 Chat</div>
        <div style={{ width:22 }} />
      </div>

      {notifStatus !== "on" && (
        <button onClick={handleEnableNotifs} disabled={notifStatus === "asking"} style={{
          margin:"10px 20px 0", padding:"9px 14px", borderRadius:10, border:"1px solid rgba(232,192,116,0.4)",
          background:"rgba(232,192,116,0.1)", color:"#e8c074", fontSize:"0.78rem", cursor:"pointer", fontWeight:500
        }}>
          {notifStatus === "asking" ? "Requesting…" : "🔔 Turn on notifications for new messages"}
        </button>
      )}
      {notifError && (
        <div style={{
          margin:"6px 20px 0", padding:"8px 12px", borderRadius:8,
          background:"rgba(192,83,62,0.15)", border:"1px solid rgba(192,83,62,0.35)",
          color:"#e8a394", fontSize:"0.7rem", lineHeight:1.4, wordBreak:"break-word"
        }}>
          ⚠️ {notifError}
        </div>
      )}

      {/* messages */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign:"center", color:"rgba(255,255,255,0.35)", fontSize:"0.85rem", marginTop:40 }}>
            No messages yet — say something.
          </div>
        )}
        {messages.map(m => {
          const mine = m.name === myName;
          return (
            <div key={m.key} style={{
              display:"flex", flexDirection:"column",
              alignItems: mine ? "flex-end" : "flex-start", marginBottom:12
            }}>
              {!mine && (
                <div style={{ fontSize:"0.68rem", color:"rgba(255,255,255,0.4)", marginBottom:3, marginLeft:4 }}>
                  {m.name}
                </div>
              )}
              <div style={{
                maxWidth:"75%", padding:"9px 13px", borderRadius: mine ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                background: mine ? "#e8c074" : "rgba(255,255,255,0.08)",
                color: mine ? "#1a1a1a" : "#fff", fontSize:"0.9rem", lineHeight:1.4,
                wordBreak:"break-word"
              }}>{m.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <div style={{
        display:"flex", gap:8, padding:"12px 16px", paddingBottom:"max(12px, env(safe-area-inset-bottom))",
        borderTop:"1px solid rgba(255,255,255,0.08)"
      }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendMessage(); }}
          placeholder="Message the group…"
          style={{
            flex:1, padding:"11px 15px", borderRadius:20,
            background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)",
            color:"#fff", fontSize:"0.9rem", outline:"none"
          }}
        />
        <button onClick={sendMessage} style={{
          width:44, height:44, borderRadius:"50%", border:"none",
          background:"#c0533e", color:"#fff", fontSize:"1.1rem", cursor:"pointer",
          flexShrink:0
        }}>➤</button>
      </div>
    </div>
  );
}

// ── history & backups ────────────────────────────────────────────────────────
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

const ACTION_META = {
  charge: { icon: "💰", verb: (e) => `charged ${e.personName} +₹2` },
  undo:   { icon: "↩️", verb: (e) => `undid ${e.personName}'s ₹2 fine` },
  rename: { icon: "✏️", verb: (e) => `renamed "${e.before}" → "${e.after}"` },
  reset:  { icon: "🔨", verb: (e) => `closed court (cleared ₹${e.totalCleared})` },
  roster_edit: { icon: "⚙️", verb: () => `updated the member list` },
  revert: { icon: "🛡️", verb: (e) => `reverted an earlier action` },
  restore: { icon: "🛡️", verb: () => `restored a backup snapshot` },
};

function HistoryPanel({ onClose }) {
  const [tab, setTab]             = useState("activity"); // activity | backups | collections
  const [entries, setEntries]     = useState([]);
  const [collections, setCollections] = useState([]);
  const [backups, setBackups]     = useState([]);
  const [busyKey, setBusyKey]     = useState(null);

  useEffect(() => {
    const unsub1 = onValue(ref(db, "court/auditLog"), snap => {
      const data = snap.val() || {};
      const all = Object.entries(data)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setEntries(all.slice(0, 50));
      // "reset" entries are the moment court closed for the week — each one
      // already records the total collected. Kept unsliced (not just the
      // last 50) so a month's worth of weeks is never cut off.
      setCollections(all.filter(e => e.action === "reset"));
    });
    const unsub2 = onValue(ref(db, "backups"), snap => {
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 15);
      setBackups(arr);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  function whoAmI() {
    return localStorage.getItem("devikas_chat_name") || "Someone";
  }
  function logAction(action, details) {
    push(ref(db, "court/auditLog"), { action, by: whoAmI(), ts: Date.now(), ...details })
      .catch(e => console.error(e));
  }

  async function revertEntry(entry) {
    setBusyKey(entry.key);
    try {
      if (entry.action === "charge" || entry.action === "undo") {
        await runTransaction(
          ref(db, `court/people/${entry.personId}/amt`),
          current => Math.max((current || 0) - entry.delta, 0)
        );
        logAction("revert", { originalAction: entry.action, personId: entry.personId, personName: entry.personName });
      } else if (entry.action === "rename") {
        await update(ref(db, `court/people/${entry.personId}`), { name: entry.before });
        logAction("revert", { originalAction: "rename", personId: entry.personId });
      }
    } catch (e) { console.error(e); }
    setBusyKey(null);
  }

  async function restoreBackup(backup) {
    setBusyKey(backup.key);
    try {
      const updates = {};
      (backup.people || []).forEach(p => { updates[`court/people/${p.id}/amt`] = p.amt; });
      await update(ref(db), updates);
      logAction("restore", { backupTs: backup.ts });
    } catch (e) { console.error(e); }
    setBusyKey(null);
  }

  async function deleteBackup(backup) {
    if (!window.confirm("Delete this backup snapshot permanently?")) return;
    setBusyKey(backup.key);
    try { await remove(ref(db, `backups/${backup.key}`)); }
    catch (e) { console.error(e); }
    setBusyKey(null);
  }

  async function deleteCollectionEntry(entry) {
    if (!window.confirm(`Delete this week's ₹${entry.totalCleared || 0} record permanently? This can't be undone.`)) return;
    setBusyKey(entry.key);
    try { await remove(ref(db, `court/auditLog/${entry.key}`)); }
    catch (e) { console.error(e); }
    setBusyKey(null);
  }

  const revertible = new Set(["charge", "undo", "rename"]);

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:400
    }}>
      <div style={{
        background:"linear-gradient(145deg, #2a4a38, #1e3328)",
        borderRadius:18, padding:"22px 20px",
        width:360, maxHeight:"85vh", display:"flex", flexDirection:"column",
        color:"#fff", fontFamily:"'Inter', sans-serif",
        boxShadow:"0 20px 60px rgba(0,0,0,0.5)"
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontFamily:"'Fraunces',serif", fontWeight:900, fontSize:"1.05rem" }}>📜 History</div>
          <button onClick={onClose} style={{
            background:"none", border:"none", color:"rgba(255,255,255,0.6)",
            fontSize:"1.1rem", cursor:"pointer", padding:0
          }}>✕</button>
        </div>

        <div style={{ display:"flex", gap:6, marginBottom:14 }}>
          <button onClick={() => setTab("activity")} style={{
            flex:1, padding:"7px", borderRadius:8, border:"none", cursor:"pointer",
            background: tab === "activity" ? "#7a8c3f" : "rgba(255,255,255,0.08)",
            color:"#fff", fontSize:"0.78rem", fontWeight:600
          }}>Activity</button>
          <button onClick={() => setTab("backups")} style={{
            flex:1, padding:"7px", borderRadius:8, border:"none", cursor:"pointer",
            background: tab === "backups" ? "#7a8c3f" : "rgba(255,255,255,0.08)",
            color:"#fff", fontSize:"0.78rem", fontWeight:600
          }}>Backups</button>
          <button onClick={() => setTab("collections")} style={{
            flex:1, padding:"7px", borderRadius:8, border:"none", cursor:"pointer",
            background: tab === "collections" ? "#7a8c3f" : "rgba(255,255,255,0.08)",
            color:"#fff", fontSize:"0.78rem", fontWeight:600
          }}>Collections</button>
        </div>

        <div style={{ overflowY:"auto", flex:1 }}>
          {tab === "activity" && (
            entries.length === 0
              ? <div style={{ textAlign:"center", color:"rgba(255,255,255,0.35)", fontSize:"0.82rem", marginTop:20 }}>No activity yet.</div>
              : entries.map(e => {
                  const meta = ACTION_META[e.action] || { icon:"•", verb:() => e.action };
                  return (
                    <div key={e.key} style={{
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding:"9px 10px", marginBottom:6, borderRadius:10,
                      background:"rgba(255,255,255,0.05)"
                    }}>
                      <div style={{ display:"flex", gap:9, alignItems:"flex-start", minWidth:0 }}>
                        <span style={{ fontSize:"0.95rem" }}>{meta.icon}</span>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:"0.82rem", lineHeight:1.4 }}>
                            <strong>{e.by}</strong> {meta.verb(e)}
                          </div>
                          <div style={{ fontSize:"0.66rem", color:"rgba(255,255,255,0.4)" }}>{timeAgo(e.ts)}</div>
                        </div>
                      </div>
                      {revertible.has(e.action) && (
                        <button onClick={() => revertEntry(e)} disabled={busyKey === e.key} style={{
                          flexShrink:0, marginLeft:8, padding:"5px 10px", borderRadius:7,
                          border:"1px solid rgba(232,192,116,0.35)", background:"rgba(232,192,116,0.1)",
                          color:"#e8c074", fontSize:"0.68rem", cursor:"pointer", fontWeight:600
                        }}>{busyKey === e.key ? "…" : "Revert"}</button>
                      )}
                    </div>
                  );
                })
          )}

          {tab === "backups" && (
            backups.length === 0
              ? <div style={{ textAlign:"center", color:"rgba(255,255,255,0.35)", fontSize:"0.82rem", marginTop:20 }}>
                  No backups yet — one is saved automatically every time court closes.
                </div>
              : backups.map(b => (
                  <div key={b.key} style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"11px 12px", marginBottom:7, borderRadius:10,
                    background:"rgba(255,255,255,0.05)"
                  }}>
                    <div>
                      <div style={{ fontSize:"0.82rem" }}>
                        Snapshot from <strong>{timeAgo(b.ts)}</strong>
                      </div>
                      <div style={{ fontSize:"0.68rem", color:"rgba(255,255,255,0.4)" }}>
                        {(b.people || []).length} members · closed by {b.by}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6, flexShrink:0, marginLeft:8 }}>
                      <button onClick={() => restoreBackup(b)} disabled={busyKey === b.key} style={{
                        padding:"6px 12px", borderRadius:7,
                        border:"1px solid rgba(232,192,116,0.35)", background:"rgba(232,192,116,0.1)",
                        color:"#e8c074", fontSize:"0.7rem", cursor:"pointer", fontWeight:600
                      }}>{busyKey === b.key ? "…" : "Restore"}</button>
                      <button onClick={() => deleteBackup(b)} disabled={busyKey === b.key} style={{
                        padding:"6px 10px", borderRadius:7,
                        border:"1px solid rgba(192,83,62,0.35)", background:"rgba(192,83,62,0.1)",
                        color:"#e8a394", fontSize:"0.7rem", cursor:"pointer", fontWeight:600
                      }}>🗑</button>
                    </div>
                  </div>
                ))
          )}

          {tab === "collections" && (() => {
            if (collections.length === 0) {
              return (
                <div style={{ textAlign:"center", color:"rgba(255,255,255,0.35)", fontSize:"0.82rem", marginTop:20 }}>
                  No weeks closed yet — a total is recorded here every time court closes.
                </div>
              );
            }
            // group weeks by calendar month, newest month first
            const groups = {};
            const order = [];
            collections.forEach(c => {
              const label = new Date(c.ts).toLocaleDateString("en-US", { month: "long", year: "numeric" });
              if (!groups[label]) { groups[label] = []; order.push(label); }
              groups[label].push(c);
            });
            return order.map(label => {
              const weeks = groups[label];
              const monthTotal = weeks.reduce((s, w) => s + (w.totalCleared || 0), 0);
              return (
                <div key={label} style={{ marginBottom:18 }}>
                  <div style={{
                    display:"flex", justifyContent:"space-between", alignItems:"baseline",
                    marginBottom:8, paddingBottom:6, borderBottom:"1px solid rgba(255,255,255,0.1)"
                  }}>
                    <span style={{ fontFamily:"'Fraunces',serif", fontWeight:700, fontSize:"0.88rem" }}>{label}</span>
                    <span style={{ fontFamily:"'Fraunces',serif", fontWeight:900, fontSize:"1rem", color:"#e8c074" }}>
                      ₹{monthTotal} total
                    </span>
                  </div>
                  {weeks.map(w => (
                    <div key={w.key} style={{
                      display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"8px 10px", marginBottom:5, borderRadius:9, background:"rgba(255,255,255,0.05)"
                    }}>
                      <div>
                        <div style={{ fontSize:"0.8rem" }}>
                          {new Date(w.ts).toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" })}
                        </div>
                        <div style={{ fontSize:"0.65rem", color:"rgba(255,255,255,0.4)" }}>closed by {w.by}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ fontFamily:"'Fraunces',serif", fontWeight:900, fontSize:"0.95rem", color:"#e8c074" }}>
                          ₹{w.totalCleared || 0}
                        </div>
                        <button onClick={() => deleteCollectionEntry(w)} disabled={busyKey === w.key} style={{
                          padding:"4px 8px", borderRadius:6,
                          border:"1px solid rgba(192,83,62,0.35)", background:"rgba(192,83,62,0.1)",
                          color:"#e8a394", fontSize:"0.65rem", cursor:"pointer"
                        }}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [people,       setPeople]       = useState([]);
  const [loaded,       setLoaded]       = useState(false);
  const [nextId,       setNextId]       = useState(1);
  const [showCourt,    setShowCourt]    = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat,     setShowChat]     = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const [toast,        setToast]        = useState(null);
  const [poppingId,    setPoppingId]    = useState(null);
  const [offline,      setOffline]      = useState(false);

  const nextIdRef = useRef(1);   // always-current value, since setState is async
  const migratedRef = useRef(false); // ensures the one-time format upgrade below only runs once

  // People are stored in Firebase as an OBJECT keyed by id — court/people/{id} —
  // instead of one big array. This means charging one person only ever touches
  // that person's own little slot in the database, so two people tapping +
  // on two DIFFERENT friends at the same instant can never overwrite each other.
  function peopleObjToArray(obj) {
    if (!obj) return [];
    return Object.values(obj).sort((a, b) => a.id - b.id);
  }

  // Older versions of the app saved people as a plain list, which Firebase
  // stores internally keyed by *position* (0, 1, 2…) rather than by each
  // person's own id. The very first time this new code loads, we quietly
  // re-save the data keyed by id instead — so nobody's existing fines are
  // lost or duplicated when the app updates.
  function migrateToIdKeyedFormat(peopleArr, nn) {
    if (migratedRef.current || peopleArr.length === 0) return;
    migratedRef.current = true;
    const peopleObj = {};
    peopleArr.forEach(p => { peopleObj[p.id] = p; });
    set(ref(db, "court/people"), peopleObj).catch(e => console.error(e));
    set(ref(db, "court/nextId"), nn).catch(e => console.error(e));
  }

  // ── storage — shared Firebase Realtime Database ──────────────────────────────
  // Every device reads/writes the same "court" node, so A, B, C, D all see
  // the same live data instantly.
  useEffect(() => {
    const courtRef = ref(db, "court");
    const unsubscribe = onValue(
      courtRef,
      snapshot => {
        const data = snapshot.val();
        if (data) {
          const arr = peopleObjToArray(data.people);
          const nn  = data.nextId || 1;
          setPeople(arr);
          setNextId(nn);
          nextIdRef.current = nn;
          migrateToIdKeyedFormat(arr, nn);
        }
        setLoaded(true);
        setOffline(false);
      },
      () => {
        // couldn't reach Firebase — fall back gracefully
        setLoaded(true);
        setOffline(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // ── unread chat badge ──────────────────────────────────────────────────────
  useEffect(() => {
    const msgsRef = ref(db, "chat/messages");
    const unsub = onValue(msgsRef, snapshot => {
      const data = snapshot.val() || {};
      const msgs = Object.values(data);
      if (showChat) {
        const latestTs = msgs.reduce((m, x) => Math.max(m, x.ts || 0), 0);
        localStorage.setItem("devikas_chat_lastseen", String(latestTs));
        setUnreadCount(0);
      } else {
        const lastSeen = Number(localStorage.getItem("devikas_chat_lastseen") || 0);
        setUnreadCount(msgs.filter(m => (m.ts || 0) > lastSeen).length);
      }
    });
    return () => unsub();
  }, [showChat]);

  // ── foreground push toast — shown if a message arrives while the app is
  // already open (browsers don't auto-show OS notifications in that case) ──
  useEffect(() => {
    const unsub = onForegroundMessage(payload => {
      if (showChat) return; // already looking at the chat, no need for a toast
      setToast({
        title: payload.notification?.title || "New message",
        body: payload.notification?.body || ""
      });
      setTimeout(() => setToast(null), 3500);
    });
    return unsub;
  }, [showChat]);

  // ── actions ────────────────────────────────────────────────────────────────
  // Every change gets a small breadcrumb in court/auditLog — who did what,
  // and what the value was before/after — so anything can be reviewed or
  // reversed later, even if it wasn't done by the "right" person.
  function whoAmI() {
    return localStorage.getItem("devikas_chat_name") || "Someone";
  }
  function logAction(action, details) {
    push(ref(db, "court/auditLog"), { action, by: whoAmI(), ts: Date.now(), ...details })
      .catch(e => console.error(e));
  }

  function charge(personId) {
    const person = people.find(p => p.id === personId);
    const before = person ? person.amt : 0;
    // update the screen immediately so it feels instant…
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, amt: p.amt + 2 } : p));
    setPoppingId(personId);
    setTimeout(() => setPoppingId(null), 350);
    // …then ask Firebase to add ₹2 to whatever the CURRENT server value is
    // (a transaction), not whatever value we happened to have on our screen.
    // This is what makes simultaneous taps from different phones both count.
    runTransaction(ref(db, `court/people/${personId}/amt`), current => (current || 0) + 2)
      .catch(e => console.error(e));
    logAction("charge", { personId, personName: person?.name || "?", before, after: before + 2, delta: 2 });
  }

  function undo(personId) {
    const p = people.find(p => p.id === personId);
    if (!p || p.amt < 2) return;
    const before = p.amt;
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, amt: p.amt - 2 } : p));
    runTransaction(ref(db, `court/people/${personId}/amt`), current => Math.max((current || 0) - 2, 0))
      .catch(e => console.error(e));
    logAction("undo", { personId, personName: p.name, before, after: before - 2, delta: -2 });
  }

  function editName(personId, name) {
    const p = people.find(p => p.id === personId);
    const before = p?.name || "";
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, name } : p));
    update(ref(db, `court/people/${personId}`), { name }).catch(e => console.error(e));
    logAction("rename", { personId, before, after: name });
  }

  async function closeCourt() {
    // save a full snapshot BEFORE wiping anything — so a reset (accidental
    // or not) can always be undone from the History panel.
    try {
      const backupRef = push(ref(db, "backups"));
      await set(backupRef, { people, ts: Date.now(), by: whoAmI() });
    } catch (e) { console.error(e); }

    // resets everyone's fine to ₹0 — touches every person, but only the
    // "amt" field of each, in a single multi-path write.
    const totalCleared = people.reduce((s, p) => s + p.amt, 0);
    const updates = {};
    people.forEach(p => { updates[`court/people/${p.id}/amt`] = 0; });
    setPeople(prev => prev.map(p => ({ ...p, amt: 0 })));
    update(ref(db), updates).catch(e => console.error(e));
    logAction("reset", { totalCleared });
    setShowCourt(false);
  }

  function saveSettings(newList) {
    // roster edits (adding/removing/renaming members) are infrequent, so a
    // full replace of the people list is fine here — it's charge/undo taps
    // (which happen constantly) that needed the careful per-field writes above.
    const peopleObj = {};
    newList.forEach(p => {
      const existing = people.find(e => e.id === p.id);
      peopleObj[p.id] = existing ? { ...p, amt: existing.amt } : { ...p, amt: 0 };
    });
    const nn = Math.max(...newList.map(p => p.id), 0) + 1;
    setPeople(peopleObjToArray(peopleObj));
    setNextId(nn);
    nextIdRef.current = nn;
    set(ref(db, "court/people"), peopleObj).catch(e => console.error(e));
    set(ref(db, "court/nextId"), nn).catch(e => console.error(e));
    logAction("roster_edit", { memberCount: newList.length });
    setShowSettings(false);
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const sorted  = [...people].sort((a, b) => b.amt - a.amt);
  const maxAmt  = Math.max(...people.map(p => p.amt), 2);
  const topAmt  = sorted[0]?.amt ?? 0;
  const isFriday = isCourtOpenNow(new Date());
  const totalPot = people.reduce((s, p) => s + p.amt, 0);

  // stable color per person (by original insertion order / id)
  function colorOf(personId) {
    const idx = people.findIndex(p => p.id === personId);
    return PALETTE[idx % PALETTE.length];
  }

  if (!loaded) return (
    <div style={{
      background:"#a8c3b6", minHeight:"100vh",
      display:"flex", alignItems:"center", justifyContent:"center",
      color:"#fff", fontFamily:"Inter, sans-serif", fontSize:"0.9rem"
    }}>Loading…</div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div style={{
        background:"linear-gradient(160deg, #aec9bc 0%, #8fb3a4 100%)",
        minHeight:"100vh",
        display:"flex", flexDirection:"column", alignItems:"center",
        padding:"28px 20px 0", overflowX:"hidden"
      }}>
        {/* ── header ── */}
        <div style={{
          fontSize:"0.68rem", letterSpacing:3, textTransform:"uppercase",
          color:"rgba(255,255,255,0.65)", marginBottom:5
        }}>Court reconvenes Friday</div>

        <h1 style={{
          fontFamily:"'Fraunces', serif", fontWeight:900, fontSize:"1.6rem",
          textAlign:"center", color:"#fff", lineHeight:1.3, marginBottom:6,
          textShadow:"0 2px 8px rgba(0,0,0,0.2)"
        }}>
          Devika's Court ⚖️
        </h1>

        <div style={{
          fontSize:"0.83rem", color:"rgba(255,255,255,0.78)",
          fontStyle:"italic", marginBottom:6
        }}>₹2 per word. No exceptions.</div>

        {/* total pot pill */}
        {totalPot > 0 && (
          <div style={{
            padding:"4px 14px", borderRadius:20, marginBottom:18,
            background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.3)",
            fontSize:"0.78rem", color:"#fff"
          }}>
            🏺 Pot this week: <strong>₹{totalPot}</strong>
          </div>
        )}

        {/* action buttons */}
        <div style={{ display:"flex", gap:10, marginBottom:totalPot > 0 ? 16 : 22 }}>
          <button onClick={() => setShowSettings(true)} style={{
            padding:"8px 18px", borderRadius:22, cursor:"pointer",
            border:"1px solid rgba(255,255,255,0.32)",
            background:"rgba(255,255,255,0.15)", color:"#fff",
            fontSize:"0.8rem", fontWeight:500, backdropFilter:"blur(4px)"
          }}>⚙️ Members</button>

          <button onClick={() => setShowCourt(true)} style={{
            padding:"8px 18px", borderRadius:22, border:"none", cursor:"pointer",
            background: isFriday ? "#c0533e" : "rgba(255,255,255,0.2)",
            color:"#fff", fontSize:"0.8rem", fontWeight:600,
            boxShadow: isFriday ? "0 0 16px rgba(192,83,62,0.55)" : "none",
            animation: isFriday ? "glow 2s infinite" : "none"
          }}>
            ⚖️ {isFriday ? "Court is Open!" : "Court Session"}
          </button>

          <button onClick={() => setShowChat(true)} style={{
            padding:"8px 18px", borderRadius:22, cursor:"pointer",
            border:"1px solid rgba(255,255,255,0.32)",
            background:"rgba(255,255,255,0.15)", color:"#fff",
            fontSize:"0.8rem", fontWeight:500, backdropFilter:"blur(4px)",
            position:"relative"
          }}>
            💬 Chat
            {unreadCount > 0 && (
              <span style={{
                position:"absolute", top:-6, right:-6, background:"#c0533e",
                color:"#fff", fontSize:"0.62rem", fontWeight:700,
                minWidth:18, height:18, borderRadius:9, display:"flex",
                alignItems:"center", justifyContent:"center", padding:"0 4px"
              }}>{unreadCount}</span>
            )}
          </button>
        </div>

        {/* ── jar shelf ── */}
        {people.length === 0 ? (
          <div style={{
            color:"rgba(255,255,255,0.7)", marginTop:80,
            textAlign:"center", fontSize:"0.95rem", lineHeight:1.8
          }}>
            <div style={{ fontSize:"2.5rem", marginBottom:12 }}>🏺</div>
            No members yet.<br />
            Tap <strong>⚙️ Members</strong> to add your group.
          </div>
        ) : (
          <div style={{ overflowX:"auto", width:"100%", paddingBottom:16 }}>
            <div style={{
              display:"flex", alignItems:"flex-end", gap:22,
              padding:"44px 28px 0",
              minWidth:"max-content",
              margin:"0 auto",
              justifyContent: people.length <= 6 ? "center" : "flex-start"
            }}>
              {sorted.map(p => (
                <JarColumn
                  key={p.id}
                  person={p}
                  color={colorOf(p.id)}
                  maxAmt={maxAmt}
                  isTop={p.amt === topAmt && topAmt > 0}
                  onPlus={() => charge(p.id)}
                  onMinus={() => undo(p.id)}
                  onEditName={editName}
                  popping={poppingId === p.id}
                />
              ))}
            </div>
          </div>
        )}

        <div style={{
          marginTop:22, marginBottom:24, color:"rgba(255,255,255,0.52)",
          fontSize:"0.7rem", textAlign:"center", lineHeight:1.9
        }}>
          Tap + to charge ₹2 · Tap − to undo · ✏️ to rename
        </div>
      </div>

      {/* ── modals ── */}
      {showCourt && (
        <CourtSession people={people} colorOf={colorOf} onClose={closeCourt} onBack={() => setShowCourt(false)} />
      )}
      {showSettings && (
        <Settings
          people={people}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
          onOpenHistory={() => { setShowSettings(false); setShowHistory(true); }}
        />
      )}
      {showHistory && (
        <HistoryPanel onClose={() => setShowHistory(false)} />
      )}
      {showChat && (
        <ChatPanel people={people} onClose={() => setShowChat(false)} />
      )}
      {toast && (
        <div onClick={() => { setShowChat(true); setToast(null); }} style={{
          position:"fixed", top:16, left:16, right:16, zIndex:500,
          background:"#1a3028", border:"1px solid rgba(232,192,116,0.4)",
          borderRadius:14, padding:"12px 16px", color:"#fff", cursor:"pointer",
          boxShadow:"0 8px 24px rgba(0,0,0,0.4)", fontFamily:"'Inter', sans-serif"
        }}>
          <div style={{ fontWeight:700, fontSize:"0.85rem", color:"#e8c074", marginBottom:2 }}>
            💬 {toast.title}
          </div>
          <div style={{ fontSize:"0.82rem", color:"rgba(255,255,255,0.8)" }}>{toast.body}</div>
        </div>
      )}
    </>
  );
}
