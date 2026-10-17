import { MODES, dayTotal, monthName, rideAmount, type ClaimData } from './claims'

/*
  The claim as the expense reimbursement Excel the team used (EXP REIMBURSEMENT FORMAT.xlsx), so
  accounts can keep working from the same sheet: a row per ride, the day's DA, hotel and other
  expense on its first row, then Total claimed, Advances, Net payable and the amount in words.
*/
const MODE_CODE: Record<string, string> = { bike: 'Bi', car: 'C', bus: 'B', train: 'T', metro: 'M', auto: 'A', taxi: 'Taxi', flight: 'Flight' }

export async function exportClaim(data: ClaimData) {
  const { default: ExcelJS } = await import('exceljs')
  const c = data.claim, rule = data.rule
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Monthly Expense')
  const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const W = 18
  ws.addRow(['CYRIX - EXPENSES REIMBURSEMENT FORM']); ws.mergeCells(1, 1, 1, W)
  ws.addRow([`Name : ${c.name}`, null, null, null, null, `EECode: ${c.ecode}`, null, `PROJECT: ${c.project ?? ''}`, null, null, null, `BASE LOCATION: ${c.base_location ?? ''}`, null, null, null, `Designation: ${c.designation ?? ''}`, null, `MOBILE: ${c.mobile ?? ''}`])
  ws.mergeCells(2, 1, 2, 5); ws.mergeCells(2, 6, 2, 7); ws.mergeCells(2, 8, 2, 11); ws.mergeCells(2, 12, 2, 15); ws.mergeCells(2, 16, 2, 17)
  ws.addRow([`Month: ${monthName(c.month)}${c.number ? ' · ' + c.number : ''} · Grade ${c.grade ?? ''}`]); ws.mergeCells(3, 1, 3, W)
  ws.addRow(['Date (DD-MM-YY)', 'Locations', null, 'Worked District', 'Mode of Trasp. {Train(T)/Bus (B) / Bike (Bi)/Car(C )/Metro(M)}', 'Distance in (KM)', 'TA (if mode is Train(T)/Bus (B) /Metro (M)) - Amount', 'Auto fare', 'D. A.', 'Local Spare Purch. Rate', 'Hotel', 'Other Expenses', null, 'Total', 'Purpose of Visit', 'Barcode/ Asset No. and Ticket No./MPT ID.', 'Service Rpt. No.', 'Remarks'])
  ws.addRow([null, 'From', 'To', null, null, null, null, null, null, null, null, 'Description', 'Amount', null, null, null, null, null])
  ws.mergeCells(4, 2, 4, 3); ws.mergeCells(4, 12, 4, 13)
  for (const col of [1, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18]) ws.mergeCells(4, col, 5, col)
  const sums = { km: 0, ta: 0, auto: 0, da: 0, spare: 0, hotel: 0, other: 0, total: 0 }
  for (const d of data.days) {
    const hotel = d.room_by ? 0 : d.hotel?.amount ?? 0
    const spare = d.expenses.filter(x => x.category === 'Spare purchase').reduce((t, x) => t + x.amount, 0)
    const others = d.expenses.filter(x => x.category !== 'Spare purchase')
    const otherAmt = others.reduce((t, x) => t + x.amount, 0)
    const tickets = d.tickets.map(t => t.ticket_no).join(', ')
    const srs = d.tickets.map(t => t.service_report).filter(Boolean).join(', ')
    const rows = d.rides.length ? d.rides : [null]
    rows.forEach((r, i) => {
      const first = i === 0
      const perKm = r ? MODES[r.mode].perKm : false
      const ta = r && !perKm && r.mode !== 'auto' ? rideAmount(r, rule) : null
      const auto = r && r.mode === 'auto' ? rideAmount(r, rule) : null
      const rideMoney = r ? rideAmount(r, rule) : 0
      const line = rideMoney + (first ? d.da_amount + spare + hotel + otherAmt : 0)
      ws.addRow([
        new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB'),
        r?.from_name?.split(',')[0] ?? d.place, r?.to_name?.split(',')[0] ?? '', d.district ?? '',
        r ? MODE_CODE[r.mode] : '', perKm ? r!.claimed_km : null, ta, auto,
        first && d.da_amount ? d.da_amount : null, first && spare ? spare : null, first && hotel ? hotel : null,
        first ? others.map(x => x.description || x.category).join('; ') || null : null, first && otherAmt ? otherAmt : null,
        line, d.purpose ?? '', first ? tickets : '', first ? srs : '', first ? d.remarks ?? '' : '',
      ])
      if (perKm) sums.km += r!.claimed_km ?? 0
      sums.ta += ta ?? 0; sums.auto += auto ?? 0; sums.total += line
      if (first) { sums.da += d.da_amount; sums.spare += spare; sums.hotel += hotel; sums.other += otherAmt }
    })
    void dayTotal
  }
  const late = Math.round(sums.total * (c.late_pct / 100))
  ws.addRow(['TOTAL EXPENSE CLAIMED', null, null, null, null, sums.km, sums.ta, sums.auto, sums.da, sums.spare, sums.hotel, null, sums.other, sums.total])
  if (late) ws.addRow([`LATE SUBMISSION ${c.late_pct}%`, null, null, null, null, null, null, null, null, null, null, null, null, -late])
  ws.addRow(['ADVANCES', null, null, null, null, null, null, null, null, null, null, null, null, c.advance ?? 0])
  const net = sums.total - late - (c.advance ?? 0)
  ws.addRow(['NET PAYABLE', null, null, null, null, null, null, null, null, null, null, null, null, net])
  ws.addRow([`Amount in words: ${words(Math.round(net))} only`])
  ws.addRow([`REMARKS: ${c.desk_note ?? c.coordinator_note ?? c.manager_note ?? ''}`])
  ws.addRow([`Claimed By: ${c.name}`, null, null, null, null, null, null, `Approved By: ${c.manager ?? ''}`, null, null, null, null, `Coordinator: ${c.coordinator ?? ''}`, null, null, null, 'Travel Desk'])
  ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > W) return
    cell.font = { name: 'Calibri', size: 10, bold: rn <= 5 || /^(TOTAL|ADVANCES|NET|LATE)/.test(String(row.getCell(1).value ?? '')) }
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: rn === 1 ? 'center' : undefined }
    cell.border = grid
    if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF1E293B') }
    if (rn === 4 || rn === 5) cell.fill = fill('FFDBEAFE')
    if (String(row.getCell(1).value ?? '').startsWith('NET PAYABLE')) cell.fill = fill('FFDCFCE7')
  }))
  ws.columns = [12, 18, 18, 14, 12, 10, 14, 10, 8, 10, 10, 22, 10, 10, 16, 18, 12, 30].map(width => ({ width }))
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `${c.ecode} ${c.name} - ${monthName(c.month)} expenses.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ')
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
