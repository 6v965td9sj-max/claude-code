// Kartenlayout (DIN A5) und Druckbogen (2 × A5 auf DIN A4 quer).
//
// Alles, was das Aussehen der Karte bestimmt, steht in LAYOUT. Wenn euer
// eigenes Papier-Layout (InDesign) übernommen wird, werden hier Maße,
// Schriften, Größen und Farben angepasst – der Rest der App bleibt gleich.

const { jsPDF } = window.jspdf;

const PT = 25.4 / 72; // mm pro Punkt

export const LAYOUT = {
  name: 'Minimal (Platzhalter)',
  page: { width: 148, height: 210 }, // mm, DIN A5 hochkant
  margin: { top: 15, right: 14, bottom: 12, left: 14 }, // mm, ≥ 5 mm wegen Druckrand
  fonts: {
    title: ['times', 'bold'],
    info: ['helvetica', 'normal'],
    heading: ['helvetica', 'bold'],
    body: ['helvetica', 'normal'],
    amount: ['helvetica', 'bold'],
    group: ['helvetica', 'bold'],
    note: ['helvetica', 'italic'],
    footer: ['helvetica', 'normal'],
  },
  size: { title: 22, info: 8.5, heading: 8, body: 9.5, group: 8.5, note: 8.5, footer: 6.5, stepNo: 9.5 }, // pt
  lineHeight: 1.38,
  headingCharSpace: 0.45, // mm Sperrung der Überschriften
  color: {
    text: [28, 28, 28],
    muted: [120, 120, 120],
    accent: [150, 110, 70],
    rule: [190, 190, 190],
  },
  labels: {
    ingredients: 'ZUTATEN',
    steps: 'ZUBEREITUNG',
    notes: 'TIPPS',
    continued: 'Fortsetzung auf der Rückseite',
    backHeader: 'Fortsetzung',
  },
  ingredientColumns: 'auto', // 1, 2 oder 'auto'
  stepNumbers: true,
  footerHeight: 6, // mm
  // Eigene Schriften (TTF) für später, z. B.:
  // customFonts: [{ name: 'Lora', style: 'bold', url: 'fonts/Lora-Bold.ttf' }],
  customFonts: [],
};

// ---------------------------------------------------------------------------
// Schriften & Text

let fontData = null; // geladene customFonts als [{name, style, file, base64}]

export async function loadFonts() {
  if (fontData || !LAYOUT.customFonts.length) return;
  fontData = await Promise.all(
    LAYOUT.customFonts.map(async (f) => {
      const buf = await (await fetch(f.url)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
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
  if (fontData) return str;
  let out = '';
  for (const ch of str.normalize('NFC')) {
    if (ch in REPLACE) out += REPLACE[ch];
    else if (ch.codePointAt(0) < 256 || WINANSI_EXTRA.includes(ch)) out += ch;
  }
  return out;
}

function setFont(doc, key, size) {
  const [family, style] = LAYOUT.fonts[key];
  doc.setFont(family, style);
  doc.setFontSize(size);
}

function lineH(sizePt) {
  return sizePt * LAYOUT.lineHeight * PT;
}

function wrap(doc, text, width) {
  return doc.splitTextToSize(text, width);
}

// ---------------------------------------------------------------------------
// Rezepttext → Struktur

const AMOUNT_RE = new RegExp(
  '^((?:ca\\.?\\s*|etwa\\s*|je\\s*)?[\\d½¼¾⅓⅔⅛][\\d½¼¾⅓⅔⅛.,/\\-–\\s]*' +
    '(?:\\s*(?:kg|g|mg|ml|cl|dl|l|EL|TL|el|tl|Msp\\.?|Prisen?|Pck\\.?|Päckchen|Packungen?|Pkg\\.?|Stk\\.?|Stück|Bund|Dosen?|Becher|Tassen?|Gläser|Glas|Scheiben?|Zehen?|Handvoll|Spritzer|Schuss|Zweige?|Blätter|Blatt|Würfel|Tropfen|cups?|tbsp|tsp|oz|lb)\\.?)?)' +
    '(?=\\s)\\s+(.+)$',
);

export function parseIngredients(text) {
  const items = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/:$/.test(line) || /^#+\s*/.test(line)) {
      items.push({ group: line.replace(/^#+\s*/, '').replace(/:$/, '') });
      continue;
    }
    const m = line.match(AMOUNT_RE);
    if (m) items.push({ amount: m[1].trim().replace(/\s+/g, ' '), name: m[2].trim() });
    else items.push({ amount: '', name: line });
  }
  return items;
}

export function parseSteps(text) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Satz einer Karte

// Ein "Unit" ist eine unteilbare Zeile/Block im Textfluss:
// { h, before, keep (mit nächstem zusammenhalten), draw(p, y) }

function buildUnits(doc, recipe, s) {
  const L = LAYOUT;
  const W = L.page.width - L.margin.left - L.margin.right;
  const x0 = L.margin.left;
  const units = [];
  const sz = (k) => L.size[k] * s;

  const heading = (label) => {
    const size = sz('heading');
    const h = lineH(size) + 1.2 * s;
    units.push({
      h,
      before: 5.5 * s,
      keep: true,
      draw(p, y) {
        p.text(label, x0, y + lineH(size) * 0.78, 'heading', size, L.color.accent, L.headingCharSpace * s);
        p.line(x0, y + h - 0.6 * s, x0 + W, y + h - 0.6 * s, L.color.rule, 0.2);
      },
    });
  };

  // Zutaten
  const ingredients = parseIngredients(sanitize(recipe.ingredients || ''));
  if (ingredients.length) {
    heading(L.labels.ingredients);
    const bodySize = sz('body');
    const lh = lineH(bodySize);
    setFont(doc, 'amount', bodySize);
    const amountW = Math.min(
      W * 0.3,
      Math.max(0, ...ingredients.filter((i) => i.amount).map((i) => doc.getTextWidth(i.amount))),
    );
    const gap = amountW ? 2.5 * s : 0;

    const measureItem = (item, colW) => {
      if (item.group) {
        setFont(doc, 'group', sz('group'));
        return { lines: wrap(doc, item.group, colW), h: lineH(sz('group')) };
      }
      setFont(doc, 'body', bodySize);
      return { lines: wrap(doc, item.name, colW - amountW - gap), h: lh };
    };

    const drawItem = (p, item, m, x, y) => {
      if (item.group) {
        m.lines.forEach((ln, i) => p.text(ln, x, y + m.h * (i + 0.78), 'group', sz('group'), L.color.text));
        return;
      }
      if (item.amount) p.text(item.amount, x, y + lh * 0.78, 'amount', bodySize, L.color.text);
      m.lines.forEach((ln, i) => p.text(ln, x + amountW + gap, y + lh * (i + 0.78), 'body', bodySize, L.color.text));
    };

    const colGap = 6 * s;
    const halfW = (W - colGap) / 2;
    let cols = L.ingredientColumns;
    if (cols === 'auto') {
      const fitsHalf = ingredients.every((i) => measureItem(i, halfW).lines.length === 1);
      cols = ingredients.length >= 7 && fitsHalf ? 2 : 1;
    }

    if (cols === 2) {
      // Spaltenweise füllen, Gruppenüberschriften nicht ans Spaltenende.
      const measured = ingredients.map((i) => ({ item: i, m: measureItem(i, halfW) }));
      const rowH = (e) => e.m.h * e.m.lines.length + (e.item.group ? 1 * s : 0);
      const total = measured.reduce((a, e) => a + rowH(e), 0);
      let split = 0;
      let acc = 0;
      while (split < measured.length && acc + rowH(measured[split]) / 2 < total / 2) acc += rowH(measured[split++]);
      if (split > 0 && measured[split - 1].item.group) split--;
      // Gibt es Gruppen ("Für den Teig:"), lieber an einer Gruppengrenze umbrechen.
      const heightAt = (k) => measured.reduce((a, e, i) => a + (i < k ? rowH(e) : 0), 0);
      const maxCol = (k) => Math.max(heightAt(k), total - heightAt(k));
      const groupSplits = measured.map((e, i) => (e.item.group && i > 0 ? i : -1)).filter((i) => i > 0);
      const bestGroup = groupSplits.sort((a, b) => maxCol(a) - maxCol(b))[0];
      if (bestGroup && maxCol(bestGroup) <= maxCol(split) * 1.35) split = bestGroup;
      const colsData = [measured.slice(0, split), measured.slice(split)];
      const colH = colsData.map((c) => c.reduce((a, e) => a + rowH(e), 0));
      units.push({
        h: Math.max(...colH),
        before: 2 * s,
        draw(p, y) {
          colsData.forEach((c, ci) => {
            let yy = y;
            for (const e of c) {
              if (e.item.group && yy > y) yy += 1 * s;
              drawItem(p, e.item, e.m, x0 + ci * (halfW + colGap), yy);
              yy += e.m.h * e.m.lines.length;
            }
          });
        },
      });
    } else {
      ingredients.forEach((item, idx) => {
        const m = measureItem(item, W);
        units.push({
          h: m.h * m.lines.length,
          before: idx === 0 ? 2 * s : item.group ? 2.2 * s : 0.3 * s,
          keep: !!item.group,
          draw: (p, y) => drawItem(p, item, m, x0, y),
        });
      });
    }
  }

  // Zubereitung
  const steps = parseSteps(sanitize(recipe.steps || ''));
  if (steps.length) {
    heading(L.labels.steps);
    const size = sz('body');
    const lh = lineH(size);
    const numbered = L.stepNumbers && steps.length > 1;
    const gutter = numbered ? 6 * s : 0;
    setFont(doc, 'body', size);
    steps.forEach((step, si) => {
      const lines = wrap(doc, step, W - gutter);
      lines.forEach((ln, li) => {
        units.push({
          h: lh,
          before: li === 0 ? (si === 0 ? 2 * s : 2.4 * s) : 0,
          // Keine einzelne Zeile am Seitenende/-anfang (Schusterjunge/Hurenkind)
          keep: lines.length > 1 && (li === 0 || li === lines.length - 2),
          draw(p, y) {
            if (li === 0 && numbered) p.text(String(si + 1), x0, y + lh * 0.78, 'amount', sz('stepNo'), L.color.accent);
            p.text(ln, x0 + gutter, y + lh * 0.78, 'body', size, L.color.text);
          },
        });
      });
    });
  }

  // Tipps
  const notes = parseSteps(sanitize(recipe.notes || ''));
  if (notes.length) {
    heading(L.labels.notes);
    const size = sz('note');
    const lh = lineH(size);
    setFont(doc, 'note', size);
    notes.forEach((n, ni) => {
      wrap(doc, n, W).forEach((ln, li) => {
        units.push({
          h: lh,
          before: li === 0 ? (ni === 0 ? 2 * s : 1.6 * s) : 0,
          draw: (p, y) => p.text(ln, x0, y + lh * 0.78, 'note', size, L.color.text),
        });
      });
    });
  }

  return units;
}

function titleBlock(doc, recipe, s) {
  const L = LAYOUT;
  const W = L.page.width - L.margin.left - L.margin.right;
  const tSize = L.size.title * s;
  setFont(doc, 'title', tSize);
  const tLines = wrap(doc, sanitize(recipe.title || 'Ohne Titel'), W);
  const tLh = tSize * 1.12 * PT;
  const info = sanitize(recipe.info || '').trim();
  const iSize = L.size.info * s;
  let h = tLh * tLines.length;
  if (info) h += 1.5 * s + lineH(iSize);
  return {
    h,
    draw(p, y) {
      tLines.forEach((ln, i) => p.text(ln, L.margin.left, y + tLh * (i + 0.8), 'title', tSize, L.color.text));
      if (info) p.text(info, L.margin.left, y + tLh * tLines.length + 1.5 * s + lineH(iSize) * 0.78, 'info', iSize, L.color.muted);
    },
  };
}

export function layoutRecipe(doc, recipe, s = 1) {
  const L = LAYOUT;
  const units = buildUnits(doc, recipe, s);
  const title = titleBlock(doc, recipe, s);
  const bottom = L.page.height - L.margin.bottom - L.footerHeight;
  const backTop = L.margin.top + lineH(L.size.info) + 4;

  const pages = [{ items: [] }];
  let y = L.margin.top + title.h + 3 * s;
  let pageStart = true;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    let need = (pageStart ? 0 : u.before) + u.h;
    for (let j = i; units[j].keep && j + 1 < units.length && j < i + 3; j++) need += units[j + 1].before + units[j + 1].h;
    if (y + need > bottom + 0.01 && !pageStart) {
      pages.push({ items: [] });
      y = backTop;
      pageStart = true;
    }
    if (!pageStart) y += u.before;
    pages[pages.length - 1].items.push({ u, y });
    y += u.h;
    pageStart = false;
  }
  return { recipe, scale: s, title, pages };
}

// Wählt die Schriftgröße so, dass das Rezept auf eine Seite (oder notfalls
// Vorder- + Rückseite) passt.
export function fitRecipe(doc, recipe) {
  const at = (s) => layoutRecipe(doc, recipe, s);
  const full = at(1);
  if (full.pages.length === 1) return full;
  for (const s of [0.95, 0.9]) {
    const r = at(s);
    if (r.pages.length === 1) return r;
  }
  if (full.pages.length === 2) return full;
  for (const s of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
    const r = at(s);
    if (r.pages.length <= 2) return r;
  }
  const r = at(0.7);
  r.overflow = true;
  return r;
}

// ---------------------------------------------------------------------------
// Zeichnen

// Ein "Painter" zeichnet in Kartenkoordinaten (mm, oben links = 0/0) und
// verschiebt bzw. dreht (180°) die Karte auf dem Zielblatt.
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
    textRight(str, xRight, y, font, size, color) {
      setFont(doc, font, size);
      this.text(str, xRight - doc.getTextWidth(str), y, font, size, color);
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
  const page = laid.pages[pageIndex];
  const total = laid.pages.length;
  const right = L.page.width - L.margin.right;

  if (pageIndex === 0) {
    laid.title.draw(p, L.margin.top);
  } else {
    const size = L.size.info;
    p.text(
      sanitize(`${laid.recipe.title || ''} – ${L.labels.backHeader}`),
      L.margin.left,
      L.margin.top + lineH(size) * 0.78,
      'info',
      size,
      L.color.muted,
    );
    p.line(L.margin.left, L.margin.top + lineH(size) + 1.2, right, L.margin.top + lineH(size) + 1.2, L.color.rule, 0.2);
  }

  for (const { u, y } of page.items) u.draw(p, y);

  // Fußzeile
  const fy = L.page.height - L.margin.bottom;
  const fSize = L.size.footer;
  const tags = (laid.recipe.tags || []).join(' · ');
  if (tags) p.text(sanitize(tags), L.margin.left, fy, 'footer', fSize, L.color.muted);
  let tail = total > 1 ? `${pageIndex + 1}/${total}` : '';
  if (pageIndex < total - 1) tail = `${L.labels.continued}  ${tail}`;
  if (tail) p.textRight(tail, right, fy, 'footer', fSize, L.color.muted);
}

// ---------------------------------------------------------------------------
// PDF-Ausgabe

const MAGIC = 'rezeptkartei:v1:';

function embed(recipes) {
  const data = recipes.map(({ id, title, info, ingredients, steps, notes, tags }) => ({ id, title, info, ingredients, steps, notes, tags }));
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

// Einzelne Karte als A5-PDF (für Vorschau, Teilen, Archiv)
export function cardPdf(recipe) {
  const doc = newDoc({ format: [LAYOUT.page.width, LAYOUT.page.height] });
  const laid = fitRecipe(doc, recipe);
  laid.pages.forEach((_, i) => {
    if (i > 0) doc.addPage([LAYOUT.page.width, LAYOUT.page.height], 'portrait');
    drawCardPage(doc, laid, i);
  });
  doc.setProperties({ title: recipe.title || 'Rezept', subject: embed([recipe]), creator: 'Rezeptkartei' });
  return { doc, laid };
}

export function pageCount(recipe) {
  const doc = newDoc({ format: [LAYOUT.page.width, LAYOUT.page.height] });
  const laid = fitRecipe(doc, recipe);
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

// Druckbogen: DIN A4 quer, links und rechts je eine A5-Karte.
// opts.swapBack: Rückseiten links/rechts tauschen (Wenden an der kurzen Kante)
// opts.rotateBack: Rückseiten um 180° drehen (falls sie auf dem Kopf stehen)
// opts.cutMarks: Schnittmarken in der Mitte
// opts.sides: 'both' | 'front' | 'back'
export function sheetsPdf(recipes, opts = {}) {
  const { swapBack = true, rotateBack = false, cutMarks = true, sides = 'both' } = opts;
  const doc = newDoc({ orientation: 'landscape', format: 'a4' });
  const laidList = recipes.map((r) => fitRecipe(doc, r));
  const sheets = planSheets(laidList);
  const anyBack = sheets.some((sh) => sh.some((c) => c && c.back !== null));
  const half = 297 / 2;
  const offX = LAYOUT.page.width < half ? (half - LAYOUT.page.width) / 2 : 0;
  let first = true;

  const newPage = () => {
    if (!first) doc.addPage('a4', 'landscape');
    first = false;
  };
  const marks = () => {
    if (!cutMarks) return;
    doc.setDrawColor(160);
    doc.setLineWidth(0.15);
    doc.line(half, 0, half, 5);
    doc.line(half, 205, half, 210);
  };

  sheets.forEach((sheet, si) => {
    const hasBack = sheet.some((c) => c && c.back !== null);
    if (sides !== 'back') {
      newPage();
      sheet.forEach((c, slot) => c && drawCardPage(doc, c.laid, c.front, slot * half + offX, 0));
      marks();
    }
    // Leere Rückseiten nur, damit beim Duplexdruck die folgenden Blätter stimmen.
    if (anyBack && sides !== 'front' && (hasBack || (sides === 'both' && si < sheets.length - 1))) {
      newPage();
      sheet.forEach((c, slot) => {
        if (!c || c.back === null) return;
        const pos = swapBack ? 1 - slot : slot;
        drawCardPage(doc, c.laid, c.back, pos * half + offX, 0, rotateBack);
      });
      marks();
    }
  });
  if (first) newPage();
  doc.setProperties({ title: 'Rezeptkarten', subject: embed(recipes), creator: 'Rezeptkartei' });
  return { doc, sheets, duplex: anyBack };
}

// Testbogen, um die Duplex-Einstellungen am eigenen Drucker zu prüfen.
export function duplexTestPdf(opts = {}) {
  const { swapBack = true, rotateBack = false } = opts;
  const doc = newDoc({ orientation: 'landscape', format: 'a4' });
  const half = 297 / 2;
  const card = (label, sub, slot, rotate) => {
    const p = painter(doc, slot * half, 0, rotate);
    p.text(label, 20, 40, 'title', 40, [30, 30, 30]);
    p.text(sub, 20, 55, 'body', 12, [100, 100, 100]);
    p.text('OBEN', 20, 20, 'heading', 10, [150, 110, 70], 1);
    p.line(14, 14, 134, 14, [150, 110, 70], 0.5);
  };
  card('Karte A', 'Vorderseite', 0, false);
  card('Karte B', 'Vorderseite', 1, false);
  doc.addPage('a4', 'landscape');
  card('Karte A', 'Rückseite – muss hinter "Karte A" stehen', swapBack ? 1 : 0, rotateBack);
  card('Karte B', 'Rückseite – muss hinter "Karte B" stehen', swapBack ? 0 : 1, rotateBack);
  return doc;
}
