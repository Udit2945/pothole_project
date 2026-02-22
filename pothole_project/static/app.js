import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onChildAdded,
  query,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/*
  Paste your Firebase Web config here.
  Firebase Console -> Project settings -> General -> Your apps -> Web app
*/
const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "pothole-data-3f291.firebaseapp.com",
  databaseURL: "https://pothole-data-3f291-default-rtdb.firebaseio.com",
  projectId: "pothole-data-3f291",
  storageBucket: "pothole-data-3f291.appspot.com",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// UI helpers
const el = (id) => document.getElementById(id);

const statusText = el("statusText");
const statusDot = el("statusDot");

const roadScoreEl = el("roadScore");
const scoreGlowEl = el("scoreGlow");
const severityEl = el("severity");
const severityPill = el("severityPill");

const speedEl = el("speed");
const distanceEl = el("distance");
const accelEl = el("acceleration");
const shockEl = el("shock");

const potholesEl = el("potholes");
const reactionMsEl = el("reactionMs");
const peakShockEl = el("peakShock");
const maxSevEl = el("maxSev");
const lastTsEl = el("lastTs");

const shockCard = el("shockCard");
const roadOverlay = el("roadOverlay");
const roadEl = el("road");

const carFront = el("carFront");
const carRear = el("carRear");

// Sparklines
const sparkSpeed = initSpark(el("sparkSpeed"));
const sparkDistance = initSpark(el("sparkDistance"));
const sparkShock = initSpark(el("sparkShock"));

// State
let lastSeverity = 0;
let lastSpeed = 0;
let lastTs = 0;

let potholes = 0;
let peakShock = 0;
let maxSev = 0;

let sevEventAt = null;
let reactionMs = null;

// Road animation
let frontX = 90;
let rearX = 10;
let frontV = 0;
let rearV = 0;
let rearBrakeUntil = 0;

const animated = {
  speed: makeTween(),
  distance: makeTween(),
  accel: makeTween(),
  shock: makeTween(),
  roadScore: makeTween()
};

function setConnected(yes){
  statusText.textContent = yes ? "Live" : "Connecting…";
  statusDot.style.background = yes ? "#22c55e" : "rgba(148,163,184,0.9)";
  statusDot.style.boxShadow = yes ? "0 0 16px rgba(34,197,94,0.7)" : "none";
}

function sevName(sev){
  if (sev === -1) return "CAL";
  if (sev === 0) return "SMOOTH";
  if (sev === 1) return "SMALL";
  if (sev === 2) return "MEDIUM";
  return "DEEP";
}

function sevColor(sev){
  if (sev === -1) return "#94a3b8";
  if (sev === 0) return "#22c55e";
  if (sev === 1) return "#facc15";
  if (sev === 2) return "#fb923c";
  return "#ef4444";
}

function scoreColor(score){
  if (score >= 85) return "#22c55e";
  if (score >= 65) return "#facc15";
  if (score >= 45) return "#fb923c";
  return "#ef4444";
}

function hexToRgba(hex, a){
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function updateSeverityUI(sev){
  const c = sevColor(sev);
  const name = sevName(sev);

  severityEl.textContent = `${name} (${sev})`;
  severityEl.style.color = c;

  severityPill.textContent = `SEV ${name}`;
  severityPill.style.color = c;
  severityPill.style.borderColor = hexToRgba(c, 0.40);
  severityPill.style.boxShadow = `0 0 18px ${hexToRgba(c, 0.22)}`;
}

function updateScoreUI(score){
  const c = scoreColor(score);
  roadScoreEl.style.color = c;
  scoreGlowEl.style.background = `radial-gradient(circle, ${hexToRgba(c, 0.88)} 0%, transparent 70%)`;
}

function pwmToPixelsPerSecond(pwm){
  const clamped = Math.max(0, Math.min(255, pwm));
  return 70 + (clamped / 255) * 260;
}

function wrapX(x){
  const w = roadEl.getBoundingClientRect().width || 900;
  if (x > w + 120) return -100;
  if (x < -140) return w + 80;
  return x;
}

function addPotholeMark(sev){
  const c = sevColor(sev);
  const roadRect = roadEl.getBoundingClientRect();
  const x = Math.min(roadRect.width - 30, frontX + 150);
  const y = 102;

  const ring = document.createElement("div");
  ring.className = "pothole-ring";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.color = c;

  const dot = document.createElement("div");
  dot.className = "pothole-dot";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.style.color = c;
  dot.style.background = c;

  roadOverlay.appendChild(ring);
  roadOverlay.appendChild(dot);

  setTimeout(() => ring.remove(), 1000);
  setTimeout(() => { dot.style.opacity = "0.55"; }, 1200);
}

function triggerRearBrake(){
  rearBrakeUntil = performance.now() + 1400;
}

function shockFlash(strength){
  if (strength < 120) return;
  shockCard.classList.remove("flash");
  void shockCard.offsetWidth;
  shockCard.classList.add("flash");
}

// Sparklines
function initSpark(canvas){
  const ctx = canvas.getContext("2d");
  return { canvas, ctx, values: [] };
}

function pushSpark(s, v, maxLen=50){
  s.values.push(v);
  if (s.values.length > maxLen) s.values.shift();
  drawSpark(s);
}

function drawSpark(s){
  const { ctx, canvas, values } = s;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0,0,w,h);
  if (values.length < 2) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;

  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i=0; i<values.length; i++){
    const x = (i / (values.length - 1)) * (w - 8) + 4;
    const y = h - 6 - ((values[i] - min) / span) * (h - 14);
    if (i === 0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.stroke();

  ctx.globalAlpha = 0.22;
  ctx.lineTo(w-4, h-6);
  ctx.lineTo(4, h-6);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fill();

  ctx.globalAlpha = 1.0;
}

// Smooth tween
function makeTween(){
  return { current: null, target: null };
}
function tweenTo(tw, target){
  if (tw.current === null) tw.current = target;
  tw.target = target;
}
function stepTween(tw, speed=0.18){
  if (tw.current === null || tw.target === null) return tw.current;
  tw.current += (tw.target - tw.current) * speed;
  return tw.current;
}

function fmt2(x){ return Number(x).toFixed(2); }

// Firebase realtime: listen to last items
setConnected(false);

const q = query(ref(db, "roadData"), limitToLast(50));

onChildAdded(q, (snap) => {
  const data = snap.val();
  if (!data) return;

  setConnected(true);

  const distance = Number(data.distance ?? 0);
  const speed = Number(data.speed ?? 0);
  const sev = Number(data.severity ?? 0);
  const roadScore = Number(data.roadScore ?? 0);

  const ts = Number(data.timestamp ?? Date.now());
  const poth = Number(data.potholes ?? potholes);

  /* =========================
     FIXED ACCEL + SHOCK BLOCK
     ========================= */

  // Prefer acceleration/shock if backend provides it, otherwise compute safely
  let accel;
  let shock;

  if ("acceleration" in data) {
    accel = Number(data.acceleration) || 0;
  } else {
    // dt in seconds
    let dtSec = lastTs ? (ts - lastTs) / 1000 : 0.06;

    // Reject dt that is too small, negative, or too large
    if (!dtSec || dtSec <= 0 || dtSec < 0.05 || dtSec > 1.0) {
      dtSec = 0.06;
    }

    accel = (speed - lastSpeed) / dtSec;

    // Deadzone at rest
    if (Math.abs(speed) < 5 && Math.abs(lastSpeed) < 5) {
      accel = 0;
    }

    // Clamp unrealistic spikes
    if (Math.abs(accel) > 800) {
      accel = Math.sign(accel) * 800;
    }
  }

  if ("shock" in data) {
    shock = Number(data.shock) || 0;
  } else {
    shock = Math.abs(accel) * (sev + 1);

    // Cap shock
    if (shock > 2000) shock = 2000;

    // Also force 0 at rest if speed is near 0 and severity is 0
    if (Math.abs(speed) < 5 && sev <= 0) {
      shock = 0;
    }
  }

  /* ========================= */

  const potholeEvent = Boolean(data.potholeEvent) || (sev > 0 && lastSeverity === 0);

  potholes = poth;
  peakShock = Math.max(peakShock, shock);
  maxSev = Math.max(maxSev, sev);

  potholesEl.textContent = `${potholes}`;
  peakShockEl.textContent = fmt2(peakShock);
  maxSevEl.textContent = `${maxSev}`;
  lastTsEl.textContent = `Last: ${new Date(ts).toLocaleTimeString()}`;

  // Reaction ms
  if (sev > 0 && lastSeverity === 0){
    sevEventAt = performance.now();
  }
  if (sevEventAt !== null && Math.abs(speed - lastSpeed) >= 15){
    reactionMs = Math.max(0, performance.now() - sevEventAt);
    reactionMsEl.textContent = `${Math.round(reactionMs)}`;
    sevEventAt = null;
  }
  if (reactionMs === null) reactionMsEl.textContent = "--";

  // UI targets
  tweenTo(animated.speed, speed);
  tweenTo(animated.distance, distance);
  tweenTo(animated.accel, accel);
  tweenTo(animated.shock, shock);
  tweenTo(animated.roadScore, roadScore);

  updateSeverityUI(sev);
  updateScoreUI(roadScore);

  // Events
  if (potholeEvent){
    addPotholeMark(sev);
    triggerRearBrake();
    shockFlash(shock);
  }

  // Sparklines
  pushSpark(sparkSpeed, speed);
  pushSpark(sparkDistance, distance);
  pushSpark(sparkShock, shock);

  // Road movement speed is real
  frontV = pwmToPixelsPerSecond(speed);

  lastSeverity = sev;
  lastSpeed = speed;
  lastTs = ts;
}, (err) => {
  setConnected(false);
  statusText.textContent = "Firebase permission blocked";
  console.error(err);
});

// Animation loop
let lastFrame = performance.now();
function tick(now){
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  const s = stepTween(animated.speed);
  const d = stepTween(animated.distance);
  const a = stepTween(animated.accel);
  const sh = stepTween(animated.shock);
  const rs = stepTween(animated.roadScore);

  if (s !== null) speedEl.textContent = `${Math.round(s)}`;
  if (d !== null) distanceEl.textContent = fmt2(d);
  if (a !== null) accelEl.textContent = fmt2(a);
  if (sh !== null) shockEl.textContent = fmt2(sh);
  if (rs !== null) roadScoreEl.textContent = `${Math.round(rs)}`;

  frontX = wrapX(frontX + frontV * dt);

  const braking = now < rearBrakeUntil;
  const targetRearV = braking ? Math.max(40, frontV * 0.42) : Math.max(60, frontV * 0.84);
  rearV += (targetRearV - rearV) * Math.min(1, dt * 3.0);
  rearX = wrapX(rearX + rearV * dt);

  if (Math.abs(frontX - rearX) < 65) rearX -= 42;

  carFront.style.transform = `translateX(${frontX}px)`;
  carRear.style.transform = `translateX(${rearX}px)`;

  const glowFront = hexToRgba(sevColor(lastSeverity), lastSeverity > 0 ? 0.55 : 0.22);
  const glowRear = braking ? "rgba(239,68,68,0.30)" : "rgba(148,163,184,0.16)";
  carFront.querySelector(".car-glow").style.background = glowFront;
  carRear.querySelector(".car-glow").style.background = glowRear;

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Parallax tilt
(() => {
  const root = document.getElementById("tiltRoot");
  if (!root) return;
  let raf = null;

  function onMove(e){
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = (e.clientX / w) - 0.5;
      const y = (e.clientY / h) - 0.5;
      root.style.transform = `translate3d(${x*6}px, ${y*6}px, 0)`;
    });
  }
  window.addEventListener("mousemove", onMove, { passive:true });
})();