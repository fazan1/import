import { esc } from './html';

/* One print / save-as-PDF page for the NG screens: house style, a title, a sub line, one or more tables.
   Every value is esc()-ed by the caller or here; numbers are passed as already-formatted strings. */
export interface PrintTable { title?: string; head: string[]; rows: string[][]; right?: number[]; total?: string[] }

export function ngPrint(title: string, sub: string, tables: PrintTable[], note?: string) {
  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) { alert('Allow pop-ups for this site to print or save as PDF.'); return; }
  const cell = (v: string, i: number, right: number[] | undefined, tag: 'td' | 'th') => `<${tag} class="${right?.includes(i) ? 'r' : ''}">${esc(v)}</${tag}>`;
  const html = tables.map((t) => `${t.title ? `<h3>${esc(t.title)}</h3>` : ''}<table><thead><tr>${t.head.map((h, i) => cell(h, i, t.right, 'th')).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => cell(v, i, t.right, 'td')).join('')}</tr>`).join('')}${t.total ? `<tr class="tot">${t.total.map((v, i) => cell(v, i, t.right, 'td')).join('')}</tr>` : ''}</tbody></table>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><title>${esc(title)}</title><style>
    body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#000;margin:0;padding:26px;font-size:15.5px;font-weight:500;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:28px;margin:0;font-weight:700}.sub{color:#111;font-size:16px;font-weight:600;margin:4px 0 16px}
    h3{font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#111;font-weight:700;margin:20px 0 8px;font-family:'IBM Plex Mono',monospace}
    table{width:100%;border-collapse:collapse;font-size:15px;page-break-inside:auto;table-layout:auto;word-break:break-word}th{background:#000;color:#fff;text-align:left;padding:10px 8px;font-weight:700;font-size:14px}
    td{padding:8px 8px;border-bottom:1px solid #999;vertical-align:top;color:#000;font-weight:500}.r{text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:600}th.r{text-align:right}
    tr.tot td{font-weight:700;border-top:2px solid #111;border-bottom:0}.note{margin-top:14px;font-size:14px;color:#000}.foot{margin-top:24px;font-size:13px;color:#000;display:flex;justify-content:space-between}
    .bar{position:fixed;top:0;right:0;padding:8px;background:#fff}.bar button{font:inherit;padding:6px 12px;border:1px solid #111;background:#111;color:#fff;border-radius:6px;cursor:pointer}@page{size:A4 landscape;margin:12mm}@media print{body{padding:0}.bar{display:none}}
  </style></head><body><div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${html}${note ? `<div class="note">${esc(note)}</div>` : ''}
  <div class="foot"><div>NG — Nigeria business · printed ${new Date().toLocaleString('en-GB')}</div><div>Import CRM</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print();},400);}</script></body></html>`);
  w.document.close();
}
