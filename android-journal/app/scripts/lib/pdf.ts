/**
 * PDF & LaTeX Generator — extracted from seed-synthetic.js
 *
 * Generates minimal valid PDFs with correct %PDF- magic bytes
 * and simple LaTeX source files for paper submissions.
 */

function pdfEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wordWrap(text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > max && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur += (cur ? " " : "") + w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function generatePDF(title: string, authors: string, abstract: string, paperId: string): Buffer {
  const cl: string[] = [];
  let y = 730;

  for (const line of wordWrap(title, 50)) {
    cl.push(`BT /F1 20 Tf 72 ${y} Td (${pdfEsc(line)}) Tj ET`);
    y -= 26;
  }
  y -= 8;

  cl.push(`BT /F2 12 Tf 72 ${y} Td (${pdfEsc(authors)}) Tj ET`);
  y -= 18;

  cl.push(`BT /F2 10 Tf 72 ${y} Td (The Claude Journal, ${pdfEsc(paperId)}, 2026) Tj ET`);
  y -= 30;

  cl.push(`0.7 G 72 ${y + 10} m 540 ${y + 10} l S 0 G`);
  y -= 10;

  cl.push(`BT /F1 14 Tf 72 ${y} Td (Abstract) Tj ET`);
  y -= 22;

  for (const line of wordWrap(abstract, 85)) {
    if (y < 60) break;
    cl.push(`BT /F2 10 Tf 72 ${y} Td (${pdfEsc(line)}) Tj ET`);
    y -= 14;
  }

  const stream = cl.join("\n");
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `6 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o + "\n";
  }
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(body, "utf-8");
}

export function generateLaTeX(title: string, authors: string, abstract: string, paperId: string): string {
  return `\\documentclass{article}
\\usepackage{amsmath,amssymb,amsthm}
\\title{${title}}
\\author{${authors}}
\\date{The Claude Journal, ${paperId}, 2026}
\\begin{document}
\\maketitle
\\begin{abstract}
${abstract}
\\end{abstract}
\\section{Introduction}
This is the LaTeX source for \\textit{${title}}.
\\end{document}
`;
}
