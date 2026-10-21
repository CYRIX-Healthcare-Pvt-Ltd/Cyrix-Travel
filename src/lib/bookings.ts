/*
  The company's bookings from the Travel Desk's MakeMyTrip (myBiz) report (te_0042; the user, 21 Oct:
  "travel desk person will update this raw data excel in their account"). Each mode has its own sheet;
  a sheet's columns are found by their headings, not by where they stand, so a report with a column more
  or less still reads. A booking's lines (booking, date change, cancellation, refund) are all kept: its
  cost is what they add up to.
*/
export interface BookingLine {
  booking_id: string; mode: string; action: string | null; pnr: string | null; created: string | null
  travel_date: string | null; end_date: string | null; from: string | null; to: string | null; hotel: string | null
  passengers: string | null; passenger_ids: string | null; booker: string | null; amount: number | null
}

type Cols = { [K in keyof Omit<BookingLine, 'mode'>]?: string[] }
const COMMON: Cols = { booking_id: ['booking_id'], action: ['booking_action'], created: ['created'], booker: ['booker_name'] }
const SHEETS: Array<{ sheet: string; mode: string; cols: Cols }> = [
  { sheet: 'flight', mode: 'flight', cols: { pnr: ['pnr_no'], travel_date: ['departure_date'], end_date: ['arrival_date'], from: ['from_city'], to: ['to_city'],
    passengers: ['passenger_name'], passenger_ids: ['passenger_employee_id'], amount: ['net_amount_charged'] } },
  { sheet: 'hotel', mode: 'hotel', cols: { travel_date: ['checkin_date'], end_date: ['checkout_date'], to: ['hotelcityname'], hotel: ['hotelname'],
    passengers: ['guest_name'], passenger_ids: ['guest_employee_id'], amount: ['net_amount_charged'] } },
  { sheet: 'bus', mode: 'bus', cols: { pnr: ['pnr_no'], travel_date: ['journey_date'], from: ['departure_city'], to: ['arrival_city'],
    passengers: ['passenger_names'], passenger_ids: ['passenger_employee_ids'], amount: ['net_amount_charged'] } },
  { sheet: 'rail', mode: 'train', cols: { pnr: ['pnr_no'], travel_date: ['departure_date'], end_date: ['arrival_date'], from: ['source_station'], to: ['destination_station'],
    passengers: ['passenger_names'], passenger_ids: ['passenger_employee_ids'], amount: ['net_amount_charged'] } },
  { sheet: 'cab', mode: 'cab', cols: { travel_date: ['travel_date'], from: ['departure_city'], to: ['arrival_city'],
    passengers: ['passenger_name'], passenger_ids: ['passenger_employee_id'], amount: ['net_amount_charged'] } },
  { sheet: 'offline', mode: 'other', cols: { booking_id: ['booking_id'], created: ['booking_date'], pnr: ['pnr_no'], travel_date: ['travel_date'], end_date: ['arrival_date'],
    to: ['sector'], passengers: ['customer_name'], amount: ['amount'] } },
]

type Cell = { value: unknown }
const plain = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> }
    if ('result' in o) return o.result
    if (o.richText) return o.richText.map(x => x.text).join('')
    if ('text' in o) return o.text
  }
  return v
}
const asText = (v: unknown) => { const p = plain(v); if (p == null) return null; const s = String(p).trim(); return s === '' ? null : s }
const asDate = (v: unknown): string | null => {
  const p = plain(v)
  if (p instanceof Date) return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`
  const s = asText(p); if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return null
}
const asNumber = (v: unknown) => { const p = plain(v); const n = typeof p === 'number' ? p : Number(String(p ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(n) && String(p ?? '').trim() !== '' ? n : null }

export async function readBookings(file: File): Promise<{ lines: BookingLine[]; bySheet: Record<string, number> }> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const lines: BookingLine[] = [], bySheet: Record<string, number> = {}
  for (const ws of wb.worksheets) {
    const def = SHEETS.find(x => x.sheet === ws.name.trim().toLowerCase())
    if (!def) continue
    // The heading row is the one with a booking id column, among the first few.
    let head = 0, names: string[] = []
    for (let i = 1; i <= 5 && !head; i++) {
      const v = (ws.getRow(i).values as unknown[]).slice(1).map(x => String(plain(x) ?? '').trim().toLowerCase())
      if (v.includes('booking_id')) { head = i; names = v }
    }
    if (!head) continue
    const cols: Cols = { ...COMMON, ...def.cols }
    const at = (k: keyof Cols) => { for (const n of cols[k] ?? []) { const i = names.indexOf(n); if (i >= 0) return i + 1 } return 0 }
    const ix = Object.fromEntries((Object.keys(cols) as Array<keyof Cols>).map(k => [k, at(k)])) as Record<keyof Cols, number>
    let n = 0
    ws.eachRow((row, i) => {
      if (i <= head) return
      const get = (k: keyof Cols) => (ix[k] ? (row.getCell(ix[k]) as Cell).value : null)
      const id = asText(get('booking_id'))
      if (!id) return
      lines.push({
        booking_id: id.toUpperCase(), mode: def.mode, action: asText(get('action')) ?? 'BOOKING', pnr: asText(get('pnr')),
        created: asDate(get('created')), travel_date: asDate(get('travel_date')), end_date: asDate(get('end_date')),
        from: asText(get('from')), to: asText(get('to')), hotel: asText(get('hotel')), passengers: asText(get('passengers')),
        passenger_ids: asText(get('passenger_ids')), booker: asText(get('booker')), amount: asNumber(get('amount')),
      })
      n++
    })
    if (n) bySheet[ws.name.trim()] = n
  }
  return { lines, bySheet }
}
