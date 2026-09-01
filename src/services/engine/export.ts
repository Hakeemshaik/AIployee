import * as XLSX from "xlsx";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { money } from "@/lib/format";
import { buildCampaignReport, buildWorklists, WORKLISTS, type CampaignReport } from "./complete";

// ---------------------------------------------------------------------------
// The files that leave the building.
//
// Worklists: one sheet per list, every phone written as TEXT with its +27 —
// Excel strips the + from anything it treats as a number, and a worklist whose
// numbers cannot be pasted back into a dialler is a printout, not a worklist.
//
// Report: the client-facing .docx. Every rate on it is per ACCOUNT, and the
// page says so, because "we made 2,300 calls" and "we spoke to 131 people" are
// different sentences and only one of them is the truth about people.
// ---------------------------------------------------------------------------

export async function worklistsWorkbook(
  organizationId: string,
  campaignId: string,
): Promise<{ buffer: Buffer; reconciled: boolean }> {
  const [lists, report] = await Promise.all([
    buildWorklists(organizationId, campaignId),
    buildCampaignReport(organizationId, campaignId),
  ]);
  if (!report.reconciled) {
    throw new Error(
      "Worklists do not reconcile to the campaign totals — export refused. Row counts and arrears must sum exactly.",
    );
  }

  const workbook = XLSX.utils.book_new();
  for (const list of WORKLISTS) {
    const rows = lists[list.key].map((row) => ({
      full_name: row.fullName,
      greeting_name: row.greetingName,
      phone: row.phone,
      unit_number: row.unitNumber,
      building_name: row.buildingName,
      tenant_code: row.tenantCode,
      total_due: row.totalDue,
      attempts: row.attempts,
      outcome: row.outcome,
      note: row.note,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ full_name: "" }]);
    // Phones as text, cell by cell. `z: "@"` alone is not enough — the value
    // itself must be a string or Excel re-parses it on open.
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
      const address = XLSX.utils.encode_cell({ r, c: 2 }); // phone column
      const cell = sheet[address];
      if (cell) {
        cell.t = "s";
        cell.v = String(cell.v ?? "");
        cell.z = "@";
      }
    }
    // Sheet names cap at 31 characters.
    XLSX.utils.book_append_sheet(workbook, sheet, list.title.slice(0, 31));
  }

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, reconciled: report.reconciled };
}

function row(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 55, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, size: 21 })] })],
      }),
      new TableCell({
        width: { size: 45, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: value, bold: true, size: 21 })],
          }),
        ],
      }),
    ],
  });
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export async function reportDocx(report: CampaignReport): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: `${report.campaign.name} — Campaign Report` })],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Every figure on this report is counted per account, never per call. ${report.campaign.rounds} calling round${report.campaign.rounds === 1 ? "" : "s"}.`,
                italics: true,
                size: 20,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("The book")] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              row("Accounts", String(report.accounts)),
              row("Book value", money(report.bookValue)),
              row("Accounts dialled", String(report.dialled)),
              row("Calls placed", String(report.calls)),
              row("Attempts per account", report.attemptsPerAccount.toFixed(1)),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Contact")] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              row("Right-party contacts (accounts reached)", String(report.reached)),
              row("Right-party contact rate", pct(report.rightPartyContactRate)),
              row("Substantive conversations (≥15 tenant words)", String(report.substantive)),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Commitments")] }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Two figures, deliberately not conflated: what the committing tenants owe in total, and what they actually agreed to pay.",
                italics: true,
                size: 20,
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              row("Promises to pay (accounts)", String(report.ptpCount)),
              row("PTP rate — share of accounts reached", pct(report.ptpRate)),
              row("Arrears under commitment (what they owe)", money(report.arrearsUnderCommitment)),
              row("Cash committed (what they agreed to pay)", money(report.cashCommitted)),
              row("Commitments with no stated amount", String(report.commitmentsWithoutAmount)),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Where every account landed")],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: report.worklists.map((list) =>
              row(list.title, `${list.count} · ${money(list.arrears)}`),
            ),
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Switch channel")],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${report.switchChannel.count} account(s) holding ${money(report.switchChannel.arrears)} have exhausted automated calling. Measured decay across real runs: attempt five produced zero conversations. These belong on WhatsApp, SMS or written notice — not on another dialling round.`,
                size: 21,
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
