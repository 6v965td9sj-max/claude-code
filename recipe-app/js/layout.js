// Kartenlayout "Kochkartei" (DIN A5 quer) und Druckbogen (2 × A5 übereinander
// auf DIN A4 hochkant).
//
// Alle Maße stammen aus der InDesign-Vorlage (Kochkartei.pdf) und stehen in
// LAYOUT – Positionen in mm ab der linken oberen Ecke der Karte, y-Werte sind
// Grundlinien. Schrift ist Arial; im PDF wird Helvetica verwendet, die
// dieselben Zeichenbreiten hat.

const { jsPDF } = window.jspdf;

const PT = 25.4 / 72; // mm pro Punkt

export const LAYOUT = {
  name: 'Kochkartei',
  page: { width: 210, height: 148.5 }, // DIN A5 quer
  sheet: { format: 'a4', orientation: 'portrait', slots: [[0, 0], [0, 148.5]] }, // oben, unten
  left: 8,
  right: 202,
  fonts: {
    regular: ['helvetica', 'normal'],
    bold: ['helvetica', 'bold'],
  },
  color: { text: [0, 0, 0], muted: [145, 143, 143] },
  title: { size: 16, minSize: 11, baseline: 12.11, charSpace: 0.62, uppercase: true },
  description: { size: 8, baseline: 18.4, maxLines: 2 },
  meta: { size: 8, baseline: 25.45, slots: [8, 46.1, 84.2, 135, 160.4], gap: 3 },
  rule: { y: 26.5, width: 0.18 },
  divider: { x: 105, top: 32, bottom: 89.45, width: 0.18 },
  columns: [
    { x: 8, width: 92 },
    { x: 110, width: 92 },
  ],
  headingBaseline: 34.06,
  body: { size: 8, leading: 12, charSpace: 0.004 }, // pt; Laufweite in mm
  headingCharSpace: 0.1, // mm
  headingGap: 6.4, // mm von der Überschrift bis zur ersten Textzeile
  sectionGap: 4.23, // mm Abstand vor einer weiteren Überschrift in derselben Spalte
  groupGap: 1.5, // mm vor Zwischenüberschriften in den Zutaten ("Für den Teig")
  paragraphGap: 0, // mm zwischen Arbeitsschritten (Vorlage: keiner)
  bottomBaseline: 140.5, // letzte mögliche Grundlinie
  footer: { size: 6, baseline: 144.5 },
  labels: {
    ingredients: 'ZUTATEN',
    steps: 'ANLEITUNG',
    notes: 'TIPPS',
    cont: ' (FORTSETZUNG)',
    continued: 'Fortsetzung auf der Rückseite',
    back: 'Fortsetzung',
    totalTime: 'Gesamtzeit',
    workTime: 'Arbeitszeit',
    cookTime: 'Koch-/Backzeit',
    servings: 'Portionen',
    difficulty: 'Schwierigkeitsgrad',
  },
  // Eigene Schriften (TTF) – z. B. echtes Arial:
  // customFonts: [{ name: 'Arial', style: 'normal', url: 'fonts/arial.ttf' }, …]
  // und oben bei fonts eintragen: regular: ['Arial', 'normal'] …
  customFonts: [],
};

// ---------------------------------------------------------------------------
// Schriften & Text

let fontData = null;

export async function loadFonts() {
  if (fontData || !LAYOUT.customFonts.length) return;
  fontData = await Promise.all(
    LAYOUT.customFonts.map(async (f) => {
      const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ...f, file: f.url.split('/').pop(), base64: btoa(bin) };
    }),
  );
}

export function newDoc(opts) {
  const doc = new jsPDF({ unit: 'mm', compress: true, ...opts });
  for (const f of fontData || []) {
    doc.addFileToVFS(f.file, f.base64);
    doc.addFont(f.file, f.name, f.style);
  }
  return doc;
}

// Die eingebauten PDF-Schriften kennen nur den WinAnsi-Zeichensatz.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const REPLACE = {
  '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅕': '1/5',
  '≈': 'ca. ', '−': '-', '‐': '-', '‑': '-', '⁄': '/', ' ': ' ', ' ': ' ', ' ': ' ',
  '℃': '°C', '→': '-', '✓': '', '\t': ' ',
};

export function sanitize(str) {
  if (fontData) return str || '';
  let out = '';
  for (const ch of (str || '').normalize('NFC')) {
    if (ch in REPLACE) out += REPLACE[ch];
    else if (ch.codePointAt(0) < 256 || WINANSI_EXTRA.includes(ch)) out += ch;
  }
  return out;
}

// Zeilenumbruch nach Wörtern; berücksichtigt die Laufweite (charSpace, mm).
// Die aktuelle Schrift muss gesetzt sein.
function wrap(doc, text, width, charSpace = 0) {
  const w = (t) => doc.getTextWidth(t) + charSpace * t.length;
  const lines = [];
  let cur = '';
  for (const word of text.split(/ +/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || w(next) <= width) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = word;
  }
  // überlange Wörter hart umbrechen
  const out = [];
  for (let line of [...lines, cur]) {
    while (w(line) > width && line.length > 1) {
      let k = line.length - 1;
      while (k > 1 && w(line.slice(0, k)) > width) k--;
      out.push(line.slice(0, k));
      line = line.slice(k);
    }
    out.push(line);
  }
  return out;
}

function setFont(doc, key, size) {
  const [family, style] = LAYOUT.fonts[key];
  doc.setFont(family, style);
  doc.setFontSize(size);
}

// ---------------------------------------------------------------------------
// Rezeptdaten → Text

export function parseLines(text) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const isGroup = (line) => /:$/.test(line) || /^#+\s*/.test(line);

// Infozeile: "Gesamtzeit: ca. 30 Minuten   Arbeitszeit: …   4 Portionen   Schwierigkeitsgrad: simpel"
export function metaItems(r) {
  const L = LAYOUT.labels;
  const time = (v) => (/^\d+$/.test(v) ? `${v} Minuten` : v);
  const items = [];
  if (r.totalTime) items.push(`${L.totalTime}: ${time(r.totalTime)}`);
  if (r.workTime) items.push(`${L.workTime}: ${time(r.workTime)}`);
  if (r.cookTime) items.push(`${L.cookTime}: ${time(r.cookTime)}`);
  if (r.servings) items.push(/^\d+([.,]\d+)?$/.test(r.servings) ? `${r.servings} ${L.servings}` : r.servings);
  if (r.difficulty) items.push(`${L.difficulty}: ${r.difficulty}`);
  return items.map(sanitize);
}

// ---------------------------------------------------------------------------
// Satz

// Ein Unit ist eine Zeile im Spaltenfluss:
// { h: Vorschub bis zur nächsten Grundlinie, before: Extra-Abstand davor,
//   keep: mit der nächsten Zeile zusammenhalten, draw(p, x, baseline) }

function buildStreams(doc, r, s) {
  const L = LAYOUT;
  const width = L.columns[0].width;
  const size = L.body.size * s;
  const pitch = L.body.leading * PT * s;
  const black = L.color.text;

  const cs = L.body.charSpace * s;
  const heading = (label) => ({
    kind: 'heading',
    label,
    h: L.headingGap * s,
    before: L.sectionGap * s,
    keep: true,
    draw: (p, x, b) => p.text(label, x, b, 'bold', size, black, L.headingCharSpace * s),
  });
  const line = (text, font, before = 0, keep = false) => ({
    h: pitch,
    before,
    keep,
    draw: (p, x, b) => p.text(text, x, b, font, size, black, cs),
  });
  const paragraph = (text, font, before) => {
    setFont(doc, font, size);
    const lines = wrap(doc, text, width, cs);
    return lines.map((ln, i) => line(ln, font, i === 0 ? before : 0, i < lines.length - 1));
  };

  const left = [];
  const ingredients = parseLines(sanitize(r.ingredients).replace(/\t/g, ' '));
  if (ingredients.length) {
    left.push(heading(L.labels.ingredients));
    ingredients.forEach((ing, i) => {
      if (isGroup(ing)) {
        const units = paragraph(ing.replace(/^#+\s*/, '').replace(/:$/, ''), 'bold', i ? L.groupGap * s : 0);
        units[units.length - 1].keep = true;
        left.push(...units);
      } else left.push(...paragraph(ing, 'regular', 0));
    });
  }
  const notes = parseLines(sanitize(r.notes));
  if (notes.length) {
    left.push(heading(L.labels.notes));
    notes.forEach((n, i) => left.push(...paragraph(n, 'regular', i ? L.paragraphGap * s : 0)));
  }

  const right = [];
  const steps = parseLines(sanitize(r.steps));
  if (steps.length) {
    right.push(heading(L.labels.steps));
    steps.forEach((st, i) => {
      const units = paragraph(st, 'regular', i ? L.paragraphGap * s : 0);
      // keine einzelne Zeile eines Absatzes am Spaltenende/-anfang
      if (units.length > 2) units[units.length - 2].keep = true;
      right.push(...units);
    });
  }
  return { left, right, heading };
}

// Füllt Units ab Index `start` in eine Spalte. Liefert platzierte Zeilen und
// den Index der ersten Zeile, die nicht mehr gepasst hat.
function flow(units, start, top, bottom) {
  const placed = [];
  let b = top;
  let i = start;
  for (; i < units.length; i++) {
    const u = units[i];
    const first = placed.length === 0;
    const base = first ? b : b + u.before;
    let end = base;
    for (let j = i; units[j].keep && j + 1 < units.length && j < i + 4; j++) end += units[j].h + units[j + 1].before;
    if (end > bottom + 0.01 && !first) break;
    placed.push({ u, b: base });
    b = base + u.h;
  }
  return { placed, next: i };
}

function header(doc, r, s) {
  const L = LAYOUT;
  const W = L.right - L.left;
  let title = sanitize(r.title || 'Ohne Titel');
  if (L.title.uppercase) title = title.toUpperCase();
  // Titel einzeilig halten, notfalls kleiner setzen
  let tSize = L.title.size;
  const tw = (sz) => {
    setFont(doc, 'bold', sz);
    return doc.getTextWidth(title) + L.title.charSpace * (sz / L.title.size) * (title.length - 1);
  };
  while (tSize > L.title.minSize && tw(tSize) > W) tSize -= 0.5;

  setFont(doc, 'regular', L.description.size);
  const desc = r.description ? wrap(doc, sanitize(r.description), W, L.body.charSpace).slice(0, L.description.maxLines) : [];
  const dy = Math.max(0, desc.length - 1) * L.body.leading * PT;
  return { title, tSize, desc, dy, meta: metaItems(r) };
}

export function layoutRecipe(doc, r, s = 1) {
  const L = LAYOUT;
  const head = header(doc, r, s);
  const { left, right, heading } = buildStreams(doc, r, s);
  const top = L.headingBaseline + head.dy;
  const bottom = L.bottomBaseline;

  const front = { columns: [flow(left, 0, top, bottom), flow(right, 0, top, bottom)] };
  const pages = [front];

  // Rest auf Rückseite(n): erst übrige Zutaten/Tipps, dann übrige Anleitung,
  // jeweils mit "(FORTSETZUNG)"-Überschrift; links, dann rechts.
  const rest = [];
  const cont = (units, idx) => {
    if (idx >= units.length) return;
    let label = null;
    for (let k = idx; k >= 0; k--) if (units[k].kind === 'heading') { label = units[k].label; break; }
    if (units[idx].kind !== 'heading' && label) rest.push(heading(label + L.labels.cont));
    rest.push(...units.slice(idx));
  };
  cont(left, front.columns[0].next);
  cont(right, front.columns[1].next);

  let idx = 0;
  while (idx < rest.length && pages.length < 4) {
    const top2 = L.headingBaseline;
    const c1 = flow(rest, idx, top2, bottom);
    const c2 = flow(rest, c1.next, top2, bottom);
    pages.push({ columns: [c1, c2] });
    idx = c2.next;
  }
  return { recipe: r, scale: s, head, pages, overflow: idx < rest.length };
}

// Wählt die Schriftgröße so, dass das Rezept auf die Vorderseite passt –
// sonst Vorder- und Rückseite.
export function fitRecipe(doc, recipe) {
  const at = (s) => layoutRecipe(doc, recipe, s);
  const full = at(1);
  if (full.pages.length === 1) return full;
  for (const s of [0.95, 0.9]) {
    const r = at(s);
    if (r.pages.length === 1) return r;
  }
  if (full.pages.length === 2 && !full.overflow) return full;
  for (const s of [0.95, 0.9, 0.85, 0.8, 0.75]) {
    const r = at(s);
    if (r.pages.length <= 2 && !r.overflow) return r;
  }
  const r = at(0.75);
  r.overflow = r.overflow || r.pages.length > 2;
  return r;
}

// ---------------------------------------------------------------------------
// Zeichnen

// Zeichnet in Kartenkoordinaten (mm) und verschiebt bzw. dreht (180°) die
// Karte auf dem Zielblatt.
function painter(doc, ox, oy, rotate) {
  const { width: W, height: H } = LAYOUT.page;
  const map = (x, y) => (rotate ? [ox + W - x, oy + H - y] : [ox + x, oy + y]);
  return {
    text(str, x, y, font, size, color, charSpace) {
      if (!str) return;
      setFont(doc, font, size);
      doc.setTextColor(...color);
      const [px, py] = map(x, y);
      const opt = {};
      if (rotate) opt.angle = 180;
      if (charSpace) opt.charSpace = charSpace;
      doc.text(str, px, py, opt);
    },
    width(str, font, size) {
      setFont(doc, font, size);
      return doc.getTextWidth(str);
    },
    line(x1, y1, x2, y2, color, width) {
      doc.setDrawColor(...color);
      doc.setLineWidth(width);
      const [a, b] = map(x1, y1);
      const [c, d] = map(x2, y2);
      doc.line(a, b, c, d);
    },
  };
}

export function drawCardPage(doc, laid, pageIndex, ox = 0, oy = 0, rotate = false) {
  const L = LAYOUT;
  const p = painter(doc, ox, oy, rotate);
  const { head } = laid;
  const back = pageIndex > 0;
  const dy = back ? 0 : head.dy;

  // Kopf
  const cs = L.title.charSpace * (head.tSize / L.title.size);
  p.text(head.title, L.left, L.title.baseline, 'bold', head.tSize, L.color.text, cs);
  const lead = L.body.leading * PT;
  if (back) p.text(L.labels.back, L.left, L.description.baseline, 'regular', L.description.size, L.color.muted);
  else head.desc.forEach((d, i) => p.text(d, L.left, L.description.baseline + i * lead, 'regular', L.description.size, L.color.muted));
  if (!back) {
    let x = L.left;
    head.meta.forEach((item, i) => {
      x = Math.max(x, L.meta.slots[i] ?? x);
      p.text(item, x, L.meta.baseline + dy, 'regular', L.meta.size, L.color.muted);
      x += p.width(item, 'regular', L.meta.size) + L.meta.gap;
    });
  }
  p.line(L.left, L.rule.y + dy, L.right, L.rule.y + dy, L.color.text, L.rule.width);
  p.line(L.divider.x, L.divider.top + dy, L.divider.x, L.divider.bottom + dy, L.color.text, L.divider.width);

  // Spalten
  laid.pages[pageIndex].columns.forEach((col, ci) => {
    for (const { u, b } of col.placed) u.draw(p, L.columns[ci].x, b);
  });

  if (pageIndex < laid.pages.length - 1) {
    const t = L.labels.continued;
    p.text(t, L.right - p.width(t, 'regular', L.footer.size), L.footer.baseline, 'regular', L.footer.size, L.color.muted);
  }
}

// ---------------------------------------------------------------------------
// PDF-Ausgabe

const MAGIC = 'rezeptkartei:v1:';
export const FIELDS = ['title', 'description', 'totalTime', 'workTime', 'cookTime', 'servings', 'difficulty', 'ingredients', 'steps', 'notes', 'tags'];

function embed(recipes) {
  const data = recipes.map((r) => Object.fromEntries(FIELDS.map((k) => [k, r[k]])));
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return MAGIC + btoa(bin);
}

export function readEmbedded(subject) {
  if (!subject || !subject.startsWith(MAGIC)) return null;
  try {
    const bin = atob(subject.slice(MAGIC.length));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

const cardFormat = () => {
  const { width: W, height: H } = LAYOUT.page;
  return { format: [W, H], orientation: W > H ? 'landscape' : 'portrait' };
};

// Einzelne Karte als PDF (Vorschau, Teilen, Archiv)
export function cardPdf(recipe) {
  const doc = newDoc(cardFormat());
  const laid = fitRecipe(doc, recipe);
  laid.pages.forEach((_, i) => {
    if (i > 0) doc.addPage(cardFormat().format, cardFormat().orientation);
    drawCardPage(doc, laid, i);
  });
  doc.setProperties({ title: recipe.title || 'Rezept', subject: embed([recipe]), creator: 'Rezeptkartei' });
  return { doc, laid };
}

export function pageCount(recipe) {
  const laid = fitRecipe(newDoc(cardFormat()), recipe);
  return { pages: laid.pages.length, scale: laid.scale, overflow: !!laid.overflow };
}

// Karten so auf A4-Bögen verteilen, dass möglichst wenig Papier übrig bleibt:
// zweiseitige Karten zusammen, einseitige zusammen.
export function planSheets(laidList) {
  const cards = [];
  for (const laid of laidList) {
    for (let i = 0; i < laid.pages.length; i += 2) {
      cards.push({ laid, front: i, back: i + 1 < laid.pages.length ? i + 1 : null });
    }
  }
  const doubles = cards.filter((c) => c.back !== null);
  const singles = cards.filter((c) => c.back === null);
  const sheets = [];
  while (doubles.length >= 2) sheets.push([doubles.shift(), doubles.shift()]);
  if (doubles.length) sheets.push([doubles.shift(), singles.shift() || null]);
  while (singles.length) sheets.push([singles.shift(), singles.shift() || null]);
  return sheets;
}

function sheetDoc() {
  return newDoc({ orientation: LAYOUT.sheet.orientation, format: LAYOUT.sheet.format });
}

function cutMarks(doc) {
  // Kurze Striche am Rand, wo die beiden Karten aneinanderstoßen
  const [, [sx, sy]] = LAYOUT.sheet.slots;
  doc.setDrawColor(160);
  doc.setLineWidth(0.15);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  if (sy > 0) {
    doc.line(0, sy, 5, sy);
    doc.line(W - 5, sy, W, sy);
  } else {
    doc.line(sx, 0, sx, 5);
    doc.line(sx, H - 5, sx, H);
  }
}

// Druckbogen: DIN A4, zwei Karten.
// opts.swapSlots: Rückseiten der beiden Karten tauschen
// opts.rotateBack: Rückseiten um 180° drehen
// opts.cutMarks: Schnittmarken
// opts.sides: 'both' | 'front' | 'back'
export function sheetsPdf(recipes, opts = {}) {
  const { swapSlots = false, rotateBack = false, cutMarks: marks = true, sides = 'both' } = opts;
  const doc = sheetDoc();
  const slots = LAYOUT.sheet.slots;
  const laidList = recipes.map((r) => fitRecipe(doc, r));
  const sheets = planSheets(laidList);
  const anyBack = sheets.some((sh) => sh.some((c) => c && c.back !== null));
  let first = true;
  const newPage = () => {
    if (!first) doc.addPage(LAYOUT.sheet.format, LAYOUT.sheet.orientation);
    first = false;
  };

  sheets.forEach((sheet, si) => {
    const hasBack = sheet.some((c) => c && c.back !== null);
    if (sides !== 'back') {
      newPage();
      sheet.forEach((c, slot) => c && drawCardPage(doc, c.laid, c.front, ...slots[slot]));
      if (marks) cutMarks(doc);
    }
    // Leere Rückseiten nur, damit beim Duplexdruck die folgenden Blätter stimmen.
    if (anyBack && sides !== 'front' && (hasBack || (sides === 'both' && si < sheets.length - 1))) {
      newPage();
      sheet.forEach((c, slot) => {
        if (!c || c.back === null) return;
        drawCardPage(doc, c.laid, c.back, ...slots[swapSlots ? 1 - slot : slot], rotateBack);
      });
      if (marks) cutMarks(doc);
    }
  });
  if (first) newPage();
  doc.setProperties({ title: 'Rezeptkarten', subject: embed(recipes), creator: 'Rezeptkartei' });
  return { doc, sheets, duplex: anyBack };
}

// Testbogen, um die Duplex-Einstellungen am eigenen Drucker zu prüfen.
export function duplexTestPdf(opts = {}) {
  const { swapSlots = false, rotateBack = false } = opts;
  const doc = sheetDoc();
  const slots = LAYOUT.sheet.slots;
  const card = (label, sub, slot, rotate) => {
    const p = painter(doc, ...slots[slot], rotate);
    p.text('OBEN', 8, 12, 'bold', 10, [0, 0, 0], 1);
    p.line(8, 14, 202, 14, [0, 0, 0], 0.4);
    p.text(label, 8, 45, 'bold', 36, [0, 0, 0]);
    p.text(sub, 8, 58, 'regular', 12, [100, 100, 100]);
  };
  card('Karte A', 'Vorderseite', 0, false);
  card('Karte B', 'Vorderseite', 1, false);
  doc.addPage(LAYOUT.sheet.format, LAYOUT.sheet.orientation);
  card('Karte A', 'Rückseite – muss hinter „Karte A" liegen, OBEN oben', swapSlots ? 1 : 0, rotateBack);
  card('Karte B', 'Rückseite – muss hinter „Karte B" liegen, OBEN oben', swapSlots ? 0 : 1, rotateBack);
  return doc;
}
