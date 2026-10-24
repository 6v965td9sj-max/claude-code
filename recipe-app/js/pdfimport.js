// Text aus vorhandenen PDFs übernehmen.

import { readEmbedded } from './layout.js';
import { parseRecipe } from './parser.js';

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

export function openPdf(data) {
  return pdfjsLib.getDocument({ data }).promise;
}

// Textstücke einer Seite(nhälfte) zu Zeilen zusammensetzen.
function toLines(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) < Math.max(line.size, it.size) * 0.45) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
    } else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const it of l.items) {
      if (end !== null && it.x - end > it.size * 0.2 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    return { y: l.y, size: l.size, text: text.replace(/\s+/g, ' ').trim() };
  });
}

export async function importPdf(arrayBuffer) {
  const pdf = await openPdf(arrayBuffer);
  const meta = await pdf.getMetadata().catch(() => null);
  const embedded = readEmbedded(meta?.info?.Subject);
  if (embedded?.length) return embedded.map((r) => ({ ...r, id: undefined, _embedded: true }));

  // Querformat-Seiten (zwei A5 auf A4) werden in linke/rechte Hälfte geteilt.
  const blocks = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], size: Math.hypot(i.transform[2], i.transform[3]) || 10, w: i.width }));
    if (vp.width > vp.height * 1.2) {
      blocks.push(items.filter((i) => i.x < vp.width / 2));
      blocks.push(items.filter((i) => i.x >= vp.width / 2));
    } else blocks.push(items);
  }

  // Jede Seite(nhälfte) in Zeilen zerlegen. Beginnt sie mit der größten
  // Schrift (Titel), ist es ein neues Rezept, sonst eine Rückseite.
  const isNoise = (t) => /^\d+\/\d+$/.test(t) || /Fortsetzung/.test(t);
  const laid = blocks.filter((b) => b.length).map((b) => toLines(b).filter((l) => l.text && !isNoise(l.text)));
  const maxSize = Math.max(0, ...laid.flat().map((l) => l.size));
  const groups = [];
  for (const ls of laid) {
    if (!ls.length) continue;
    if (!groups.length || ls[0].size >= maxSize * 0.9) groups.push([]);
    const g = groups[groups.length - 1];
    ls.forEach((l, i) => {
      // größere Abstände als Absatz werten
      if (i > 0 && ls[i - 1].y - l.y > l.size * 1.9) g.push({ text: '', size: 0 });
      g.push(l);
    });
    g.push({ text: '', size: 0 });
  }

  return groups.map((g) => {
    const top = Math.max(...g.map((l) => l.size));
    let i = 0;
    while (i < g.length && !g[i].text) i++;
    const titleLines = [];
    while (i < g.length && g[i].text && g[i].size >= top * 0.95) titleLines.push(g[i++].text);
    const title = titleLines.join(' ');
    const text = [title, ...g.slice(i).map((l) => l.text)].join('\n');
    return parseRecipe(text, { title });
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
