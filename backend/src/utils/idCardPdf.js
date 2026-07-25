import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';

const AVATAR_TINTS = ['#7A1F2B', '#2c6049', '#4a5e8c', '#946312', '#43434c', '#8a2f3a'];

function tintFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function initialsFor(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
}

/**
 * Streams a simple, real, credit-card-proportioned ID card PDF to `res`.
 * No external template/asset dependency — everything is drawn with pdfkit
 * primitives from live student/enrollment data.
 */
export function renderIdCardPdf(res, { studentName, admissionNo, className, rollNo, dob, gender, academicYear }) {
  const doc = new PDFDocument({ size: [280, 440], margin: 0 });
  doc.pipe(res);

  const tint = tintFor(studentName);

  // Header band
  doc.rect(0, 0, 280, 96).fill(tint);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(env.SCHOOL_NAME, 18, 22, { width: 244, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#ffffffcc').text('Student Identity Card', 18, 44, { width: 244, align: 'center' });

  // Avatar (initials disc)
  const cx = 140, cy = 150, r = 40;
  doc.circle(cx, cy, r).fill(tint + '22');
  doc.fillColor(tint).font('Helvetica-Bold').fontSize(28).text(initialsFor(studentName), cx - r, cy - 16, { width: r * 2, align: 'center' });

  // Name + core details
  doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(16).text(studentName, 18, 206, { width: 244, align: 'center' });
  doc.fillColor('#666').font('Helvetica').fontSize(10.5).text(className || 'Unassigned Class', 18, 227, { width: 244, align: 'center' });

  const rows = [
    ['Admission No.', admissionNo || '—'],
    ['Roll No.', rollNo != null ? String(rollNo) : '—'],
    ['Date of Birth', dob ? new Date(dob).toLocaleDateString('en-IN') : '—'],
    ['Gender', gender || '—'],
    ['Academic Year', academicYear || '—'],
  ];

  let y = 262;
  doc.moveTo(24, y).lineTo(256, y).strokeColor('#e5e5e5').stroke();
  y += 14;
  for (const [label, value] of rows) {
    doc.fillColor('#8a8a8a').font('Helvetica').fontSize(8.5).text(label.toUpperCase(), 24, y);
    doc.fillColor('#222').font('Helvetica-Bold').fontSize(10.5).text(value, 130, y - 1, { width: 126, align: 'right' });
    y += 20;
  }

  doc.moveTo(24, y + 4).lineTo(256, y + 4).strokeColor('#e5e5e5').stroke();
  doc.fillColor('#999').font('Helvetica-Oblique').fontSize(7.5)
    .text('This card is the property of the school. If found, please return to the school office.', 20, y + 14, { width: 240, align: 'center' });

  doc.end();
}
