import type { Workbook } from 'exceljs'
import { MODES, STATUS, claimName, dayRange, expenseRole, monthName, rideAmount, type ClaimData } from './claims'

/*
  The claim as the expense reimbursement Excel the team used (EXP REIMBURSEMENT FORMAT.xlsx), so
  accounts can keep working from the same sheet: a row per ride, the day's DA, hotel and other
  expense on its first row, then Total claimed, Advances, Net payable and the amount in words.
  My claims gives every claim it shows in the one sheet, each row with its claim, and a summary of them (the user,
  2 Nov: "download excel in my claims … all in single sheet … in this total and a summary sheet too", without who
  claimed and approved). Only the headings wrap, in rows tall enough for them; every column is as wide as what it
  holds (the user, 2 Nov: "see the wrapping is bad").
*/
const MODE_CODE: Record<string, string> = { bike: 'Bi', car: 'C', bus: 'B', train: 'T', metro: 'M', auto: 'A', taxi: 'Taxi car', taxi_bike: 'Taxi bike', flight: 'Flight' }
const HEAD = ['Date (DD-MM-YY)', 'Locations', null, 'Worked District', 'Mode of Trasp. {Train(T)/Bus (B) / Bike (Bi)/Car(C )/Metro(M)}', 'Distance in (KM)', 'TA (if mode is Train(T)/Bus (B) /Metro (M)) - Amount', 'Auto fare', 'D. A.', 'Local Spare Purch. Rate', 'Room stay', 'Other Expenses', null, 'Total', 'Purpose of Visit', 'Barcode/ Asset No. and Ticket No./MPT ID.', 'Service Rpt. No.', 'Remarks']
const SUB = [null, 'From', 'To', null, null, null, null, null, null, null, null, 'Description', 'Amount', null, null, null, null, null]
/** The narrowest each column of the form goes, whatever it holds. */
const MIN = [11, 12, 12, 11, 7, 9, 10, 8, 8, 9, 8, 12, 8, 9, 12, 12, 9, 12]
type Cell = string | number | null
type Sums = { km: number; ta: number; auto: number; da: number; spare: number; hotel: number; other: number; total: number }

/** A claim's rows as the form has them, and what they come to. */
function claimRows(data: ClaimData) {
  const rule = data.rule
  const sums: Sums = { km: 0, ta: 0, auto: 0, da: 0, spare: 0, hotel: 0, other: 0, total: 0 }
  const rows: Cell[][] = []
  for (const d of [...data.days].sort((a, b) => a.day.localeCompare(b.day))) {
    const hotel = d.room_by ? 0 : d.hotel?.amount ?? 0
    const spare = d.expenses.filter(x => expenseRole(x.category) === 'spare').reduce((t, x) => t + x.amount, 0)
    const others = d.expenses.filter(x => expenseRole(x.category) !== 'spare')
    const otherAmt = others.reduce((t, x) => t + x.amount, 0)
    const tickets = d.tickets.map(t => t.ticket_no).join(', ')
    const srs = d.tickets.map(t => t.service_report).filter(Boolean).join(', ')
    const rides = d.rides.length ? d.rides : [null]
    rides.forEach((r, i) => {
      const first = i === 0
      const perKm = r ? MODES[r.mode].perKm : false
      const ta = r && !perKm && r.mode !== 'auto' ? rideAmount(r, rule) : null
      const auto = r && r.mode === 'auto' ? rideAmount(r, rule) : null
      const rideMoney = r ? rideAmount(r, rule) : 0
      const line = rideMoney + (first ? d.da_amount + spare + hotel + otherAmt : 0)
      rows.push([
        new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB'),
        r?.from_name?.split(',')[0] ?? d.place, r?.to_name?.split(',')[0] ?? '', d.district ?? '',
        r ? MODE_CODE[r.mode] : '', perKm ? r!.claimed_km : null, ta, auto,
        first && d.da_amount ? d.da_amount : null, first && spare ? spare : null, first && hotel ? hotel : null,
        first ? others.map(x => x.description || x.category).join('; ') || null : null, first && otherAmt ? otherAmt : null,
        line, d.purpose ?? '', first ? tickets : '', first ? srs : '', [first ? d.remarks : null, r?.note, r?.company_booking ? `Booked by company ${r.company_booking}` : null].filter(Boolean).join(' · '),
      ])
      if (perKm) sums.km += r!.claimed_km ?? 0
      sums.ta += ta ?? 0; sums.auto += auto ?? 0; sums.total += line
      if (first) { sums.da += d.da_amount; sums.spare += spare; sums.hotel += hotel; sums.other += otherAmt }
    })
  }
  const late = Math.round(sums.total * ((data.claim.late_pct ?? 0) / 100))
  const advance = data.claim.advance ?? 0
  return { rows, sums, late, advance, net: sums.total - late - advance }
}

/*
  The form for one claim or several: with several, a Claim column first and every claim's rows one after another.
  Gives back the sheet, how wide it is and the bottom line, for what goes under it.
*/
function form(wb: Workbook, name: string, claims: ClaimData[], line3: string, several: boolean) {
  const ws = wb.addWorksheet(name)
  const o = several ? 1 : 0, W = 18 + o
  const c = claims[claims.length - 1].claim
  const at = (col: number) => col + o
  const head = several ? ['Claim', ...HEAD] : HEAD
  const sub = several ? [null, ...SUB] : SUB
  const longest = head.map(() => 0)
  const measure = (row: Cell[]) => row.forEach((v, i) => { if (v != null && v !== '') longest[i] = Math.max(longest[i], typeof v === 'number' ? v.toLocaleString('en-IN').length : String(v).length) })

  ws.addRow(['CYRIX - EXPENSES REIMBURSEMENT FORM']); ws.mergeCells(1, 1, 1, W)
  const info: Cell[] = Array(W).fill(null)
  info[0] = `Name : ${c.name}`; info[at(6) - 1] = `EECode: ${c.ecode}`; info[at(8) - 1] = `PROJECT: ${c.project ?? ''}`
  info[at(12) - 1] = `BASE LOCATION: ${c.base_location ?? ''}`; info[at(16) - 1] = `Designation: ${c.designation ?? ''}`; info[at(18) - 1] = `MOBILE: ${c.mobile ?? ''}`
  ws.addRow(info)
  ws.mergeCells(2, 1, 2, at(5)); ws.mergeCells(2, at(6), 2, at(7)); ws.mergeCells(2, at(8), 2, at(11)); ws.mergeCells(2, at(12), 2, at(15)); ws.mergeCells(2, at(16), 2, at(17))
  ws.addRow([line3]); ws.mergeCells(3, 1, 3, W)
  ws.addRow(head)
  ws.addRow(sub)
  ws.mergeCells(4, at(2), 4, at(3)); ws.mergeCells(4, at(12), 4, at(13))
  for (const col of [...(several ? [1] : []), ...[1, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18].map(at)]) ws.mergeCells(4, col, 5, col)

  const sums: Sums = { km: 0, ta: 0, auto: 0, da: 0, spare: 0, hotel: 0, other: 0, total: 0 }
  let late = 0, advance = 0
  for (const data of claims) {
    const part = claimRows(data)
    for (const r of part.rows) { const row = several ? [data.claim.number ?? 'Not sent yet', ...r] : r; ws.addRow(row); measure(row) }
    for (const k of Object.keys(sums) as Array<keyof Sums>) sums[k] += part.sums[k]
    late += part.late; advance += part.advance
  }
  const lead = (label: string) => [label, ...Array(4 + o).fill(null)]
  const label = (row: { number: number }) => ws.mergeCells(row.number, 1, row.number, at(5))
  const total = [...lead('TOTAL EXPENSE CLAIMED'), sums.km, sums.ta, sums.auto, sums.da, sums.spare, sums.hotel, null, sums.other, sums.total]
  label(ws.addRow(total)); measure([null, ...total.slice(1)])
  if (late) label(ws.addRow([...lead(several ? 'LATE SUBMISSION' : `LATE SUBMISSION ${c.late_pct}%`), ...Array(8).fill(null), -late]))
  label(ws.addRow([...lead('ADVANCES'), ...Array(8).fill(null), advance]))
  const net = sums.total - late - advance
  label(ws.addRow([...lead('NET PAYABLE'), ...Array(8).fill(null), net]))
  const wide = (text: string) => { const row = ws.addRow([text]); ws.mergeCells(row.number, 1, row.number, W); return row }
  wide(`Amount in words: ${words(Math.round(net))} only`)

  ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > W) return
    cell.font = { name: 'Calibri', size: 10, bold: rn <= 5 || /^(TOTAL|ADVANCES|NET|LATE)/.test(String(row.getCell(1).value ?? '')) }
    cell.alignment = { vertical: 'middle', wrapText: rn === 2 || rn === 4 || rn === 5, horizontal: rn === 1 ? 'center' : rn === 4 || rn === 5 ? 'center' : undefined }
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF111111') }
    if (rn === 4 || rn === 5) cell.fill = fill('FFF3F4F6')
    if (String(row.getCell(1).value ?? '').startsWith('NET PAYABLE')) cell.fill = fill('FFF3F4F6')
  }))
  // Each column as wide as what it holds; a heading may take up to three lines, and its row is as tall as the longest needs.
  const min = several ? [12, ...MIN] : MIN
  const widths = head.map((h, i) => Math.min(48, Math.max(min[i], longest[i] + 2, h ? Math.ceil(h.length / 3) + 2 : 0)))
  ws.columns = widths.map(width => ({ width }))
  const span = (i: number) => widths[i] + (head[i + 1] === null ? widths[i + 1] : 0)
  const lines = Math.max(1, ...head.map((h, i) => (h ? wrapLines(h, span(i) - 3) : 1)))
  ws.getRow(1).height = 26; ws.getRow(2).height = 28; ws.getRow(5).height = 16
  ws.getRow(4).height = Math.max(18, lines * 14 + 6 - 16)
  return { ws, W }
}

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } }
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
/** How many lines a heading takes at so many characters a line, broken between words as Excel does. */
const wrapLines = (text: string, cap: number) => {
  let n = 1, len = 0
  for (const w of text.split(' ')) {
    if (len && len + 1 + w.length > cap) { n++; len = w.length } else len += (len ? 1 : 0) + w.length
  }
  return n
}

export async function exportClaim(data: ClaimData) {
  const { default: ExcelJS } = await import('exceljs')
  const c = data.claim
  const wb = new ExcelJS.Workbook()
  const { ws, W } = form(wb, 'Monthly Expense', [data], `Month: ${monthName(c.month)}${c.number ? ' · ' + c.number : ''} · Grade ${c.grade ?? ''} · ${STATUS[c.status]?.label ?? c.status}`, false)
  const remarks = ws.addRow([`REMARKS: ${c.desk_note ?? c.coordinator_note ?? c.manager_note ?? ''}`]); ws.mergeCells(remarks.number, 1, remarks.number, W)
  // Who did each step, and when, from the claim's history (te_0025): the last time each was done.
  const at = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` }
  const last = (...actions: string[]) => [...(data.history ?? [])].reverse().find(e => actions.includes(e.action))
  const sent = last('submitted', 'resubmitted'), mgr = last('manager_approved'), coord = last('coordinator_approved'), desk = last('desk_approved'), paid = last('paid')
  const sign = ws.addRow([
    `Claimed by: ${c.name}${sent ? '\n' + at(sent.at) : ''}`, null, null, null, null,
    `Approved by (manager): ${mgr?.actor ?? c.manager ?? ''}${mgr ? '\n' + at(mgr.at) : ''}`, null, null, null, null,
    `Coordinator: ${coord?.actor ?? c.coordinator ?? '—'}${coord ? '\n' + at(coord.at) : ''}`, null, null, null,
    `Travel Desk: ${desk?.actor ?? ''}${desk ? '\n' + at(desk.at) : ''}${paid ? '\nPaid ' + (c.paid_on ? new Date(c.paid_on + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : at(paid.at)) + (c.paid_ref ? ' · UTR ' + c.paid_ref : '') : ''}`, null, null, null,
  ])
  ws.mergeCells(sign.number, 1, sign.number, 5); ws.mergeCells(sign.number, 6, sign.number, 10)
  ws.mergeCells(sign.number, 11, sign.number, 14); ws.mergeCells(sign.number, 15, sign.number, 18)
  for (const row of [remarks, sign]) row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > W) return
    cell.font = { name: 'Calibri', size: 10 }
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    cell.alignment = row === sign ? { vertical: 'top', wrapText: true } : { vertical: 'middle' }
  })
  sign.height = 58
  await save(wb, `${c.ecode} ${c.name} - ${monthName(c.month)} expenses`)
}

/** Every claim My claims shows, in one sheet, and a summary sheet of them; nobody's signature. */
export async function exportClaims(list: ClaimData[], period: string) {
  const { default: ExcelJS } = await import('exceljs')
  const claims = [...list].sort((a, b) => a.claim.month.localeCompare(b.claim.month) || a.claim.part - b.claim.part)
  const c = claims[claims.length - 1].claim
  const wb = new ExcelJS.Workbook()
  form(wb, 'Claims', claims, `${period} · ${claims.length} claim${claims.length > 1 ? 's' : ''}`, true)

  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3 }] })
  const head = ['Claim', 'Month', 'Dates', 'Status', 'Days', 'Km', 'TA', 'Auto fare', 'D. A.', 'Local spare', 'Room stay', 'Other', 'Total', 'Late deduction', 'Advance', 'Net payable']
  const body = claims.map(d => {
    const p = claimRows(d), days = d.days.map(x => x.day).sort()
    return [d.claim.number ?? 'Not sent yet', claimName(d.claim.month, d.claim.part), dayRange(days[0] ?? null, days[days.length - 1] ?? null), STATUS[d.claim.status]?.label ?? d.claim.status,
      d.days.length, Math.round(p.sums.km * 10) / 10, p.sums.ta, p.sums.auto, p.sums.da, p.sums.spare, p.sums.hotel, p.sums.other, p.sums.total, p.late ? -p.late : 0, p.advance ? -p.advance : 0, p.net]
  })
  ws.addRow([`${c.name} (${c.ecode}) · Travel claims · ${period}`]); ws.mergeCells(1, 1, 1, head.length)
  ws.addRow(['Summary']); ws.mergeCells(2, 1, 2, head.length)
  ws.addRow(head)
  for (const r of body) ws.addRow(r)
  const total = ws.addRow(head.map((_, i) => (i === 0 ? 'TOTAL' : i >= 4 ? body.reduce((t, r) => t + Number(r[i] ?? 0), 0) : null)))
  ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > head.length) return
    cell.font = { name: 'Calibri', size: 10, bold: rn <= 3 || row === total }
    cell.alignment = { vertical: 'middle', wrapText: false, horizontal: rn > 3 && cn > 4 ? 'right' : undefined }
    if (rn >= 3) cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    if (rn > 3 && cn > 4 && typeof cell.value === 'number') cell.numFmt = cn === 6 ? '#,##0.0' : '#,##0'
    if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF111111') }
    if (rn === 3) cell.fill = fill('FFF3F4F6')
    if (row === total) cell.fill = fill('FFF3F4F6')
  }))
  ws.getRow(1).height = 24
  ws.columns = head.map((h, i) => ({ width: Math.min(40, Math.max(h.length + 3, ...body.map(r => String(r[i] ?? '').length + 3), String(total.getCell(i + 1).value ?? '').length + 4)) }))
  await save(wb, `${c.ecode} ${c.name} - travel claims ${period}`)
}

async function save(wb: Workbook, file: string) {
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `${file}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** Rupees in words, Indian style: Five Thousand Seven Hundred Twenty Six. */
function words(n: number): string {
  if (n === 0) return 'Zero'
  if (n < 0) return 'Minus ' + words(-n)
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const two = (x: number) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''))
  const parts: string[] = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  const hundred = Math.floor(n / 100); n %= 100
  if (crore) parts.push(two(crore) + ' Crore')
  if (lakh) parts.push(two(lakh) + ' Lakh')
  if (thousand) parts.push(two(thousand) + ' Thousand')
  if (hundred) parts.push(ones[hundred] + ' Hundred')
  if (n) parts.push(two(n))
  return parts.join(' ')
}
