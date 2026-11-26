import type { Advance } from './advances'
import { ADVANCE_STATUS } from './advances'

/*
  Advances as Excel for the Travel Desk (the user, 5 Nov: "they need excel download in approved tab, ie in good format
  and need download excel for each or total"). One row an advance with a total row — all of them, or one alone in the
  same columns ("better make single download also in column wise"). The cost centre it is from (the person's own) and
  the one it is charged to (te_0127); no Used or Left ("left not needed"). The grid and colours of the claims' export.
*/
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '')
const by = (name: string | null, iso: string | null) => (iso ? `${name ?? ''} · ${when(iso)}` : '')

export async function exportAdvances({ file, heading, rows }: { file: string; heading: string; rows: Array<Advance & { own_centre?: string | null }> }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

  const head = ['Advance', 'Name', 'E-code', 'From cost centre', 'To cost centre', 'From', 'To', 'Purpose', 'Reason', 'Requested',
    'Edited by the manager', 'Manager approved', 'Travel Desk approved', 'Status', 'Amount']
  const sumFrom = 14
  const ws = wb.addWorksheet('Advances', { views: [{ state: 'frozen', ySplit: 3 }] })
  ws.addRow([heading]); ws.mergeCells(1, 1, 1, head.length)
  ws.addRow([`${rows.length} ${rows.length === 1 ? 'advance' : 'advances'}`]); ws.mergeCells(2, 1, 2, head.length)
  ws.addRow(head)
  const body = rows.map(a => [a.number, a.name, a.ecode, a.own_centre ?? '', a.cost_centre ?? '', a.base_state, a.dest_name, a.purpose, a.reason,
    when(a.created_at), a.edited_at ? `${by(a.edited_name, a.edited_at)} — ${a.edit_note ?? ''}` : '', by(a.manager_name, a.manager_at),
    by(a.desk_name, a.desk_at), ADVANCE_STATUS[a.status]?.label ?? a.status, Number(a.amount)])
  for (const r of body) ws.addRow(r)
  const total = ws.addRow(head.map((_, i) => (i === 0 ? 'TOTAL' : i >= sumFrom ? body.reduce((t, r) => t + Number(r[i] ?? 0), 0) : null)))
  ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > head.length) return
    cell.font = { name: 'Calibri', size: 10, bold: rn <= 3 || row === total }
    cell.alignment = { vertical: 'middle', wrapText: false, horizontal: rn > 3 && cn > sumFrom ? 'right' : undefined }
    if (rn >= 3) cell.border = grid
    if (cn > sumFrom && typeof cell.value === 'number') cell.numFmt = '#,##0'
    if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF111111') }
    if (rn === 3) cell.fill = fill('FFF3F4F6')
    if (row === total) cell.fill = fill('FFF3F4F6')
  }))
  ws.getRow(1).height = 24
  ws.columns = head.map((h, i) => ({ width: Math.min(60, Math.max(h.length + 3, ...body.map(r => String(r[i] ?? '').length + 2), 8)) }))

  const buf = await wb.xlsx.writeBuffer()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  link.download = `${file}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ')
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}
