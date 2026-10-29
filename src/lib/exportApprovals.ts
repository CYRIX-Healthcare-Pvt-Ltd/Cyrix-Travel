import { STATUS, claimName, dayRange, rideAmount, useInbox, type ClaimData } from './claims'

type Row = NonNullable<ReturnType<typeof useInbox>['data']>[number]

/*
  Approvals as Excel (the user, 29 Oct: "need download excel also, total, inside each eng"): on the list, a sheet of
  people with their totals and a sheet of every claim; on a person's page, their claims and each day of them. A
  total row under each, the grid and colours of the claim's own export.
*/
export async function exportApprovals({ file, heading, rows, full }: {
  file: string; heading: string; rows: Row[]
  /** Each claim whole, for the day-by-day sheet (a person's page). */
  full?: Record<string, ClaimData | null>
}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const n = (v: unknown) => Math.round(Number(v ?? 0))

  const sheet = (name: string, head: string[], body: Array<Array<string | number | null>>, sumFrom: number, widths: number[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.addRow([heading]); ws.mergeCells(1, 1, 1, head.length)
    ws.addRow([name]); ws.mergeCells(2, 1, 2, head.length)
    ws.addRow(head)
    for (const r of body) ws.addRow(r)
    const total = ws.addRow(head.map((_, i) => (i === 0 ? 'TOTAL' : i >= sumFrom ? body.reduce((t, r) => t + Number(r[i] ?? 0), 0) : null)))
    ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
      if (cn > head.length) return
      cell.font = { name: 'Calibri', size: 10, bold: rn <= 3 || row === total }
      // Nothing wraps: each column is as wide as what it holds (the user, 29 Oct).
      cell.alignment = { vertical: 'middle', wrapText: false, horizontal: rn > 3 && cn > sumFrom ? 'right' : undefined }
      if (rn >= 3) cell.border = grid
      if (rn > 3 && cn > sumFrom && typeof cell.value === 'number') cell.numFmt = '#,##0'
      if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF1E293B') }
      if (rn === 3) cell.fill = fill('FFDBEAFE')
      if (row === total) cell.fill = fill('FFDCFCE7')
    }))
    ws.getRow(1).height = 24
    ws.columns = head.map((h, i) => ({ width: Math.min(70, Math.max(widths[i] ?? 8, h.length + 3, ...body.map(r => String(r[i] ?? '').length + 2), String(total.getCell(i + 1).value ?? '').length + 3)) }))
  }

  const money = ['Km', 'Travel', 'DA', 'Other', 'Hotel', 'Total']
  const moneyOf = (c: Row) => [Math.round(Number(c.km) * 10) / 10, n(c.travel), n(c.da), n(c.other), n(c.hotel), n(c.total)]

  if (!full) {
    const people = [...rows.reduce((m, c) => m.set(c.employee_id, [...(m.get(c.employee_id) ?? []), c]), new Map<string, Row[]>()).values()]
    sheet('People', ['Name', 'E-code', 'Cost centre', 'Months', 'Claims', 'Days', ...money],
      people.map(cs => [cs[0].name, cs[0].ecode, cs[0].cost_centre ?? '', [...new Set(cs.map(c => claimName(c.month, c.part)))].join(', '), cs.length, cs.reduce((t, c) => t + Number(c.days ?? 0), 0),
        ...money.map((_, i) => cs.reduce((t, c) => t + Number(moneyOf(c)[i]), 0))]),
      4, [26, 10, 18, 14, 9, 8, 10, 11, 10, 10, 10, 12])
  }
  sheet('Claims', ['Name', 'E-code', 'Claim', 'Month', 'Dates', 'From', 'To', 'Status', 'Days', ...money],
    rows.map(c => [c.name, c.ecode, c.number ?? '', claimName(c.month, c.part), dayRange(c.first_day, c.last_day), c.route_from ?? '', c.route_to ?? '', STATUS[c.status]?.label ?? c.status, Number(c.days ?? 0), ...moneyOf(c)]),
    8, [26, 10, 9, 9, 14, 20, 20, 18, 7, 10, 11, 10, 10, 10, 12])

  if (full) {
    const short = (s: string | null) => (s ? s.split(',')[0] : '')
    const days: Array<Array<string | number | null>> = []
    for (const c of rows) {
      const d = full[c.id]; if (!d) continue
      for (const x of [...d.days].sort((a, b) => a.day.localeCompare(b.day))) {
        const travel = x.rides.reduce((t, r) => t + rideAmount(r, d.rule), 0)
        const other = x.expenses.reduce((t, e) => t + Number(e.amount), 0)
        const hotel = x.hotel && !x.room_by ? Number(x.hotel.amount) : 0
        const stops = x.rides.length ? [short(x.rides[0].from_name), ...x.rides.map(r => short(r.to_name))] : []
        days.push([c.number ?? '', new Date(x.day + 'T00:00:00').toLocaleDateString('en-GB'), stops.join(' → ') || (x.place ?? ''), x.purpose ?? '', x.rides.length,
          Math.round(x.rides.reduce((t, r) => t + Number(r.claimed_km ?? 0), 0) * 10) / 10, n(travel), n(x.da_amount), n(other), n(hotel), n(travel + Number(x.da_amount) + other + hotel)])
      }
    }
    sheet('Days', ['Claim', 'Date', 'Where', 'Purpose', 'Rides', ...money], days, 4, [9, 11, 60, 18, 7, 10, 11, 10, 10, 10, 12])
  }

  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `${file}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
