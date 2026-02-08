// v2 : cinétique thermique + collisions conditionnelles + diagnostic prof (masqué)
// Raccourcis clavier (non affichés aux élèves) :
//   P : afficher/masquer diagnostic prof
//   T : activer/désactiver "mode piège" (réaction quasi bloquée à basse T)

const canvas = document.getElementById("simu");
const ctx = canvas.getContext("2d");

const tempSlider = document.getElementById("temp");
const tempVal = document.getElementById("tempVal");
const cl2Slider = document.getElementById("cl2");
const cl2Val = document.getElementById("cl2Val");
const restartBtn = document.getElementById("restart");

let molecules = [];
let products = [];
let animationId;

let showDiag = false;
let trapMode = false;

let reactionsDone = 0;
let initialCounts = { H2: 0, Cl2: 0 };

// Rayons (px)
const R = { H: 6, Cl: 10 };

function rand(min, max) { return Math.random() * (max - min) + min; }

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx*dx + dy*dy;
}

function drawBond(x, y, r1, c1, r2, c2) {
  // petit trait de liaison implicite (sans texte)
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
}

class Molecule {
  constructor(type) {
    this.type = type;
    this.x = rand(60, canvas.width - 60);
    this.y = rand(60, canvas.height - 60);
    // vitesse directionnelle initiale
    this.vx = rand(-1, 1);
    this.vy = rand(-1, 1);
    this.used = false;
  }

  radius() {
    // rayon "enveloppe" pour collision (approx)
    if (this.type === "H2") return R.H + R.H + 2;
    if (this.type === "Cl2") return R.Cl + R.Cl + 2;
    if (this.type === "HCl") return R.H + R.Cl + 2;
    return 18;
  }

  move(speed) {
    this.x += this.vx * speed;
    this.y += this.vy * speed;

    const r = this.radius();
    if (this.x < r) { this.x = r; this.vx *= -1; }
    if (this.x > canvas.width - r) { this.x = canvas.width - r; this.vx *= -1; }
    if (this.y < r) { this.y = r; this.vy *= -1; }
    if (this.y > canvas.height - r) { this.y = canvas.height - r; this.vy *= -1; }
  }

  draw() {
    if (this.type === "H2") drawBond(this.x, this.y, R.H, "#fff", R.H, "#fff");
    if (this.type === "Cl2") drawBond(this.x, this.y, R.Cl, "#4caf50", R.Cl, "#4caf50");
    if (this.type === "HCl") drawBond(this.x, this.y, R.H, "#fff", R.Cl, "#4caf50");
  }
}

// Cinétique :
// - vitesse ~ sqrt(T_K / Tref_K) (agitation thermique)
// - probabilité de réaction sur collision ~ A * exp(-Ea/(R*T))
// - si T < 25°C : facteur ralentissant fort ("quasi bloqué"), surtout en mode piège
function kineticParams() {
  const Tc = parseFloat(tempSlider.value);
  const Tk = Tc + 273.15;
  const Tref = 50 + 273.15;

  // agitation thermique (limiter pour rester lisible)
  let speed = Math.sqrt(Tk / Tref);
  speed = clamp(speed, 0.45, 2.0);

  // Arrhenius "douce" ajustée pour être visible
  const Rgas = 8.314;
  const Ea = 9000; // J/mol (choisi pour avoir une variation sensible)
  const A = 0.30;  // facteur de normalisation (probabilité max par collision)
  let p = A * Math.exp(-Ea / (Rgas * Tk));

  // Basse température : ralentissement fort
  if (Tc < 25) {
    const factor = trapMode ? 0.02 : 0.10; // mode piège = encore plus lent
    p *= factor;
    // agitation aussi plus faible (visuellement "quasi figé")
    speed *= trapMode ? 0.55 : 0.75;
  }

  // plafonner pour éviter des réactions trop rapides à haute T
  p = clamp(p, 0, 0.20);

  return { speed, p };
}

function init() {
  cancelAnimationFrame(animationId);
  molecules = [];
  products = [];
  reactionsDone = 0;

  const cl2Count = parseInt(cl2Slider.value, 10);
  const h2Count = 6; // conservé fixe : excès imposé côté Cl2

  for (let i = 0; i < h2Count; i++) molecules.push(new Molecule("H2"));
  for (let i = 0; i < cl2Count; i++) molecules.push(new Molecule("Cl2"));

  initialCounts = { H2: h2Count, Cl2: cl2Count };

  animate();
}

// Résolution de collision (rebond simple) + détection collision réactive
function handleCollisions(pReact) {
  for (let i = 0; i < molecules.length; i++) {
    const a = molecules[i];
    if (a.used) continue;

    for (let j = i + 1; j < molecules.length; j++) {
      const b = molecules[j];
      if (b.used) continue;

      // ne gère collisions que pour espèces actives
      const ra = a.radius();
      const rb = b.radius();
      const d2 = dist2(a.x, a.y, b.x, b.y);
      const minD = ra + rb;
      if (d2 <= minD * minD) {
        // rebond rudimentaire
        const tmpx = a.vx; a.vx = b.vx; b.vx = tmpx;
        const tmpy = a.vy; a.vy = b.vy; b.vy = tmpy;

        // collision "conditionnelle" : réaction seulement si (H2, Cl2) et tirage aléatoire
        const pair1 = (a.type === "H2" && b.type === "Cl2");
        const pair2 = (a.type === "Cl2" && b.type === "H2");

        if ((pair1 || pair2) && Math.random() < pReact) {
          // H2 + Cl2 -> 2 HCl (sans écrire l'équation)
          a.used = true;
          b.used = true;

          // Produits proches du point de collision (pour cohérence visuelle)
          const p1 = new Molecule("HCl");
          const p2 = new Molecule("HCl");
          p1.x = (a.x + b.x) / 2 + rand(-10, 10);
          p1.y = (a.y + b.y) / 2 + rand(-10, 10);
          p2.x = (a.x + b.x) / 2 + rand(-10, 10);
          p2.y = (a.y + b.y) / 2 + rand(-10, 10);

          // vitesse héritée (agitation)
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

  // diagnostic prof : affichage discret dans le coin
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#111";
  ctx.fillRect(12, 12, 300, 132);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "14px Arial";
  ctx.fillText("Diagnostic prof (P)", 22, 34);
  ctx.font = "13px Arial";
  ctx.fillText(`T = ${Tc.toFixed(0)} °C   |   Mode piège (T) : ${trapMode ? "ON" : "OFF"}`, 22, 56);
  ctx.fillText(`Initial : blanches=${initialCounts.H2}   vertes=${initialCounts.Cl2}`, 22, 78);
  ctx.fillText(`Restant : blanches=${h2}   vertes=${cl2}`, 22, 98);
  ctx.fillText(`Produit : ${hcl}   |   Événements réaction : ${reactionsDone}`, 22, 118);
  ctx.restore();
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { speed, p } = kineticParams();

  // bouger & dessiner réactifs encore présents
  for (const m of molecules) {
    if (!m.used) {
      m.move(speed);
      m.draw();
    }
  }

  // bouger & dessiner produits
  for (const pdt of products) {
    pdt.move(speed);
    pdt.draw();
  }

  // collisions (rebonds + réactions conditionnelles)
  handleCollisions(p);

  // overlay prof
  if (showDiag) diagOverlay();

  animationId = requestAnimationFrame(animate);
}

tempSlider.oninput = () => tempVal.textContent = tempSlider.value;
cl2Slider.oninput = () => cl2Val.textContent = cl2Slider.value;
restartBtn.onclick = init;

// touches "invisibles"
window.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (k === "p") showDiag = !showDiag;
  if (k === "t") trapMode = !trapMode;
});

init();
