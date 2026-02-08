// v4 : accélération des chocs efficaces sans revenir aux paquets "collés"
// - réaction possible dès que les centres sont "assez proches" (pas besoin de chevauchement)
// - probabilité max de réaction augmentée
// - un peu plus d'agitation (surtout vers T ~50°C)
// Boutons/curseurs inchangés

const canvas = document.getElementById("simu");
const ctx = canvas.getContext("2d");

const tempSlider = document.getElementById("temp");
const tempVal = document.getElementById("tempVal");

const h2Slider = document.getElementById("h2");
const h2Val = document.getElementById("h2Val");

const cl2Slider = document.getElementById("cl2");
const cl2Val = document.getElementById("cl2Val");

const restartBtn = document.getElementById("restart");
const toggleAtomsBtn = document.getElementById("toggleAtoms");

let molecules = [];
let products = [];
let animationId;

let showAtoms = false;
let showDiag = false;   // P (optionnel)
let trapMode = false;   // T (optionnel)

let reactionsDone = 0;
let initialCounts = { H2: 0, Cl2: 0 };

const R = { H: 6, Cl: 10 };

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx*dx + dy*dy);
}

function normalize(dx, dy) {
  const d = Math.sqrt(dx*dx + dy*dy) || 1;
  return { x: dx/d, y: dy/d };
}

function drawBond(x, y, r1, c1, label1, r2, c2, label2) {
  ctx.beginPath();
  ctx.strokeStyle = "#777";
  ctx.lineWidth = 2;
  ctx.moveTo(x - r1 + 1, y);
  ctx.lineTo(x + r2 - 1, y);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";

  ctx.beginPath();
  ctx.fillStyle = c1;
  ctx.arc(x - r1, y, r1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = c2;
  ctx.arc(x + r2, y, r2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (showAtoms) {
    ctx.fillStyle = "#000";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label1, x - r1, y);
    ctx.fillText(label2, x + r2, y);
  }
}

class Molecule {
  constructor(type) {
    this.type = type;
    this.x = rand(70, canvas.width - 70);
    this.y = rand(70, canvas.height - 70);
    this.vx = rand(-1, 1);
    this.vy = rand(-1, 1);
    this.used = false;
  }

  envelopeRadius() {
    if (this.type === "H2") return R.H + R.H + 4;
    if (this.type === "Cl2") return R.Cl + R.Cl + 4;
    if (this.type === "HCl") return R.H + R.Cl + 4;
    return 22;
  }

  move(speed) {
    this.x += this.vx * speed;
    this.y += this.vy * speed;

    const r = this.envelopeRadius();
    if (this.x < r) { this.x = r; this.vx *= -1; }
    if (this.x > canvas.width - r) { this.x = canvas.width - r; this.vx *= -1; }
    if (this.y < r) { this.y = r; this.vy *= -1; }
    if (this.y > canvas.height - r) { this.y = canvas.height - r; this.vy *= -1; }
  }

  draw() {
    if (this.type === "H2")  drawBond(this.x, this.y, R.H, "#fff", "H", R.H, "#fff", "H");
    if (this.type === "Cl2") drawBond(this.x, this.y, R.Cl, "#4caf50", "Cl", R.Cl, "#4caf50", "Cl");
    if (this.type === "HCl") drawBond(this.x, this.y, R.H, "#fff", "H", R.Cl, "#4caf50", "Cl");
  }
}

// Cinétique : rend l'effet de T visible + accélère la transformation
function kineticParams() {
  const Tc = parseFloat(tempSlider.value);
  const Tk = Tc + 273.15;

  // agitation plus énergique (visuel) : [0.45 ; 3.8]
  let speed = 0.45 + ((Tc - 10) / (120 - 10)) * 3.35;
  speed = clamp(speed, 0.40, 3.8);

  // probabilité de réaction sur "quasi-contact"
  const Rgas = 8.314;
  const Ea = 9500;   // un peu plus faible => plus réactif
  const A = 0.95;    // plus élevé => plus de chocs efficaces
  let p = A * Math.exp(-Ea / (Rgas * Tk));
  p = clamp(p, 0, 0.50); // plafonné

  if (Tc < 25) {
    const factor = trapMode ? 0.015 : 0.08;
    p *= factor;
    speed *= trapMode ? 0.55 : 0.78;
  }

  return { speed, p };
}

// Garder Cl2 > H2
function enforceExcess() {
  let h2 = parseInt(h2Slider.value, 10);
  let cl2 = parseInt(cl2Slider.value, 10);

  if (h2 >= cl2) {
    if (cl2 < parseInt(cl2Slider.max, 10)) {
      cl2 = Math.min(parseInt(cl2Slider.max, 10), h2 + 1);
      cl2Slider.value = String(cl2);
    } else {
      h2 = Math.max(parseInt(h2Slider.min, 10), cl2 - 1);
      h2Slider.value = String(h2);
    }
  }

  h2Val.textContent = h2Slider.value;
  cl2Val.textContent = cl2Slider.value;
}

function init() {
  cancelAnimationFrame(animationId);
  molecules = [];
  products = [];
  reactionsDone = 0;

  enforceExcess();

  const h2Count = parseInt(h2Slider.value, 10);
  const cl2Count = parseInt(cl2Slider.value, 10);

  for (let i = 0; i < h2Count; i++) molecules.push(new Molecule("H2"));
  for (let i = 0; i < cl2Count; i++) molecules.push(new Molecule("Cl2"));

  initialCounts = { H2: h2Count, Cl2: cl2Count };

  for (let k = 0; k < 220; k++) resolveOverlaps(molecules);

  animate();
}

// Anti-chevauchement (conserve la lisibilité)
function resolveOverlaps(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.used) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.used) continue;

      const ra = a.envelopeRadius();
      const rb = b.envelopeRadius();
      const d = dist(a.x, a.y, b.x, b.y);
      const minD = ra + rb;

      if (d < minD && d > 0.001) {
        const overlap = (minD - d);
        const n = normalize(a.x - b.x, a.y - b.y);
        a.x += n.x * (overlap * 0.55);
        a.y += n.y * (overlap * 0.55);
        b.x -= n.x * (overlap * 0.55);
        b.y -= n.y * (overlap * 0.55);
      }
    }
  }
}

// Réactions : maintenant possibles dès "proximité suffisante"
function handleEncounters(pReact) {
  // facteur : rend le "contact" un peu plus large sans superposer
  const contactFactor = 1.25; // 25% plus permissif

  for (let i = 0; i < molecules.length; i++) {
    const a = molecules[i];
    if (a.used) continue;

    for (let j = i + 1; j < molecules.length; j++) {
      const b = molecules[j];
      if (b.used) continue;

      // cible uniquement H2/Cl2
      const pair = (a.type === "H2" && b.type === "Cl2") || (a.type === "Cl2" && b.type === "H2");
      if (!pair) continue;

      const ra = a.envelopeRadius();
      const rb = b.envelopeRadius();
      const d = dist(a.x, a.y, b.x, b.y);
      const threshold = (ra + rb) * contactFactor;

      if (d <= threshold) {
        // petit rebond pour éviter qu'ils restent collés visuellement
        const tmpx = a.vx; a.vx = b.vx; b.vx = tmpx;
        const tmpy = a.vy; a.vy = b.vy; b.vy = tmpy;

        // réaction probabiliste
        if (Math.random() < pReact) {
          a.used = true;
          b.used = true;

          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;

          const p1 = new Molecule("HCl");
          const p2 = new Molecule("HCl");
          p1.x = cx + rand(-12, 12); p1.y = cy + rand(-12, 12);
          p2.x = cx + rand(-12, 12); p2.y = cy + rand(-12, 12);

          p1.vx = rand(-1, 1); p1.vy = rand(-1, 1);
          p2.vx = rand(-1, 1); p2.vy = rand(-1, 1);

          products.push(p1, p2);
          reactionsDone += 1;
        }
      }
    }
  }
}

function counts() {
  const h2 = molecules.filter(m => m.type === "H2" && !m.used).length;
  const cl2 = molecules.filter(m => m.type === "Cl2" && !m.used).length;
  const hcl = products.length;
  return { h2, cl2, hcl };
}

function diagOverlay() {
  const { h2, cl2, hcl } = counts();
  const Tc = parseFloat(tempSlider.value);
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#111";
  ctx.fillRect(12, 12, 320, 132);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "14px Arial";
  ctx.fillText("Diagnostic prof (P)", 22, 34);
  ctx.font = "13px Arial";
  ctx.fillText(`T = ${Tc.toFixed(0)} °C   |   Mode piège (T) : ${trapMode ? "ON" : "OFF"}`, 22, 56);
  ctx.fillText(`Initial : H2=${initialCounts.H2}   Cl2=${initialCounts.Cl2}`, 22, 78);
  ctx.fillText(`Restant : H2=${h2}   Cl2=${cl2}`, 22, 98);
  ctx.fillText(`Produit : ${hcl}   |   Événements : ${reactionsDone}`, 22, 118);
  ctx.restore();
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { speed, p } = kineticParams();

  for (const m of molecules) {
    if (!m.used) {
      m.move(speed);
      m.draw();
    }
  }
  for (const pdt of products) {
    pdt.move(speed);
    pdt.draw();
  }

  // garde la lisibilité
  resolveOverlaps(molecules);
  resolveOverlaps(products);

  // chocs efficaces plus fréquents
  handleEncounters(p);

  if (showDiag) diagOverlay();

  animationId = requestAnimationFrame(animate);
}

// UI
tempSlider.oninput = () => tempVal.textContent = tempSlider.value;
h2Slider.oninput = () => { enforceExcess(); };
cl2Slider.oninput = () => { enforceExcess(); };
restartBtn.onclick = init;

toggleAtomsBtn.onclick = () => {
  showAtoms = !showAtoms;
  toggleAtomsBtn.textContent = `Atomes : ${showAtoms ? "ON" : "OFF"}`;
};

window.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (k === "p") showDiag = !showDiag;
  if (k === "t") trapMode = !trapMode;
});

tempVal.textContent = tempSlider.value;
h2Val.textContent = h2Slider.value;
cl2Val.textContent = cl2Slider.value;

init();
