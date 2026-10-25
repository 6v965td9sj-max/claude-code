// Text aus vorhandenen PDFs übernehmen – zugeschnitten auf die
// Kochkartei-Vorlage (A5 quer, Zutaten links, Anleitung rechts), mit einem
// allgemeinen Fallback für andere PDFs.

import { LAYOUT, readEmbedded } from './layout.js';
import { parseRecipe, parseMeta, joinWrapped } from './parser.js';

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const MM = 25.4 / 72;
const HEADINGS = /^(ZUTATEN|ANLEITUNG|ZUBEREITUNG|TIPPS?|NOTIZEN|HINWEISE?)( \(FORTSETZUNG\))?$/;

export function openPdf(data) {
  return pdfjsLib.getDocument({ data }).promise;
}

// Textstücke zu Zeilen zusammensetzen (Koordinaten in mm, y = Grundlinie von oben).
function toLines(items) {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 0.9);
    if (line) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
    } else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  lines.sort((a, b) => a.y - b.y);
  return lines
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const it of l.items) {
        if (end !== null && it.x - end > it.size * MM * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
        text += it.str;
        end = it.x + it.w;
      }
      return { y: l.y, size: l.size, x0: l.items[0].x, x1: end, text: text.replace(/\s+/g, ' ').trim() };
    })
    .filter((l) => l.text);
}

// Zeilen einer Spalte zu Absätzen zusammenführen: Eine Zeile, die (fast) bis
// zum Spaltenrand reicht, wird mit der nächsten verbunden.
function paragraphs(lines, colRight) {
  const out = [];
  let open = false;
  for (const l of lines) {
    const full = l.x1 > colRight - 12;
    if (open && out.length) {
      const prev = out[out.length - 1];
      out[out.length - 1] = /[a-zäöüß]-$/.test(prev) && /^[a-zäöüß]/.test(l.text) ? prev.slice(0, -1) + l.text : `${prev} ${l.text}`;
    } else out.push(l.text);
    open = (full && !/[.!?:]$/.test(l.text)) || /[a-zäöüß]-$/.test(l.text);
  }
  return out;
}

// Eine Karte (oder Kartenrückseite) im Kochkartei-Layout auslesen.
function readCard(items) {
  const head = toLines(items.filter((i) => i.y < LAYOUT.rule.y + 4));
  // Spalten nach der Trennlinie aufteilen
  const cols = [[], []];
  for (const it of items.filter((i) => i.y >= LAYOUT.rule.y + 4)) cols[it.x < LAYOUT.divider.x ? 0 : 1].push(it);
  if (!cols.flat().some((i) => HEADINGS.test(i.str.trim()))) return null; // nicht unser Layout
  const sections = { ingredients: [], steps: [], notes: [] };
  const kindOf = (t) => (/^ZUTATEN/.test(t) ? 'ingredients' : /^(ANLEITUNG|ZUBEREITUNG)/.test(t) ? 'steps' : 'notes');

  cols.forEach((colItems, ci) => {
    const col = LAYOUT.columns[ci];
    let kind = ci === 0 ? 'ingredients' : 'steps';
    let buf = [];
    const flush = () => {
      if (buf.length) sections[kind].push(...paragraphs(buf, col.x + col.width));
      buf = [];
    };
    for (const l of toLines(colItems)) {
      if (HEADINGS.test(l.text)) {
        flush();
        kind = kindOf(l.text);
      } else buf.push(l);
    }
    flush();
  });

  const titleSize = Math.max(0, ...head.map((l) => l.size));
  const titleLine = head.find((l) => l.size === titleSize);
  const rest = head.filter((l) => l !== titleLine);
  const metaLine = rest.find((l) => Object.keys(parseMeta(l.text)).length);
  const descLines = rest.filter((l) => l !== metaLine).map((l) => l.text);
  const continuation = descLines[0] === LAYOUT.labels.back || titleSize < 12;

  return {
    continuation,
    title: titleLine ? titleCase(titleLine.text) : '',
    description: continuation ? '' : descLines.join(' '),
    ...(metaLine ? parseMeta(metaLine.text) : {}),
    ingredients: sections.ingredients,
    steps: sections.steps,
    notes: sections.notes,
  };
}

// "PAVLOVA" → "Pavlova" (die Vorlage setzt Titel in Großbuchstaben)
function titleCase(t) {
  // Gesperrter Titel kommt als "PAV L O VA" aus dem PDF
  if (/(^| )\S \S( |$)/.test(t) && /^(\S{1,3} )+\S{1,3}$/.test(t)) t = t.replace(/ /g, '');
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-(„"])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// Seitenbereiche: A4 hochkant → zwei Karten übereinander, A4 quer → zwei
// nebeneinander, sonst die ganze Seite.
function regions(widthMm, heightMm) {
  const near = (a, b) => Math.abs(a - b) < 6;
  if (near(widthMm, 210) && near(heightMm, 297)) return [[0, 0, 210, 148.5], [0, 148.5, 210, 148.5]];
  if (near(widthMm, 297) && near(heightMm, 210)) return [[0, 0, 148.5, 210], [148.5, 0, 148.5, 210]];
  return [[0, 0, widthMm, heightMm]];
}

export async function importPdf(arrayBuffer) {
  const pdf = await openPdf(arrayBuffer);
  const meta = await pdf.getMetadata().catch(() => null);
  const embedded = readEmbedded(meta?.info?.Subject);
  if (embedded?.length) {
    pdf.destroy();
    return embedded.map((r) => ({ ...r, _embedded: true }));
  }

  const blocks = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width * MM;
    const H = vp.height * MM;
    const content = await page.getTextContent();
    const all = content.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({
        str: i.str,
        x: i.transform[4] * MM,
        y: H - i.transform[5] * MM,
        size: Math.abs(i.transform[3]) || Math.hypot(i.transform[2], i.transform[3]) || 10,
        w: i.width * MM,
      }));
    for (const [rx, ry, rw, rh] of regions(W, H)) {
      const items = all
        .filter((i) => i.x >= rx - 1 && i.x < rx + rw && i.y >= ry && i.y < ry + rh)
        .map((i) => ({ ...i, x: i.x - rx, y: i.y - ry }));
      if (items.length) blocks.push(items);
    }
  }
  pdf.destroy();

  const recipes = [];
  for (const items of blocks) {
    const card = readCard(items);
    if (card) {
      const prev = recipes[recipes.length - 1];
      if (card.continuation && prev?._parts) {
        for (const k of ['ingredients', 'steps', 'notes']) prev._parts[k].push(...card[k]);
        continue;
      }
      const { ingredients, steps, notes, ...fields } = card;
      delete fields.continuation;
      recipes.push({ ...fields, _parts: { ingredients, steps, notes } });
      continue;
    }
    // Fremdes Layout: Zeilen von oben nach unten, größte Schrift = Titel
    const lines = toLines(items);
    const maxSize = Math.max(...lines.map((l) => l.size));
    const title = lines.filter((l) => l.size >= maxSize * 0.95).map((l) => l.text).join(' ');
    const text = lines.filter((l) => l.size < maxSize * 0.95).map((l) => l.text).join('\n');
    recipes.push(parseRecipe(`${title}\n${text}`, { title: titleCase(title) }));
  }

  return recipes.map((r) => {
    if (!r._parts) return r;
    const { _parts, ...rest } = r;
    return {
      ...rest,
      ingredients: _parts.ingredients.join('\n'),
      steps: joinWrapped(_parts.steps).join('\n'),
      notes: _parts.notes.join('\n'),
    };
  });
}

// Seiten eines PDFs als Bilder in einen Container zeichnen (Vorschau).
export async function renderPdf(container, arrayBuffer, { maxWidth } = {}) {
  const pdf = await openPdf(arrayBuffer);
  const canvases = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const width = Math.min(maxWidth || container.clientWidth || 360, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vp = page.getViewport({ scale: (width / base.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = `${width}px`;
    canvas.className = 'page';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    canvases.push(canvas);
  }
  container.replaceChildren(...canvases);
  pdf.destroy();
}
