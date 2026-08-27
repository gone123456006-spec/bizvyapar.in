/**
 * Minimal .xlsx writer (no external deps) + user export helper.
 */

import { deflateRawSync } from 'node:zlib'
import { exportUsersRows } from './db/analyticsStore.js'
import {
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './analyticsUtils.js'

function rangeForPreset(preset, from, to) {
  const now = new Date()
  if (preset === 'today') {
    return { from: startOfDay(now), to: endOfDay(now), label: 'today' }
  }
  if (preset === 'week') {
    return { from: startOfWeek(now), to: endOfDay(now), label: 'this-week' }
  }
  if (preset === 'month') {
    return { from: startOfMonth(now), to: endOfDay(now), label: 'this-month' }
  }
  const fromDate = from ? new Date(from) : startOfMonth(now)
  const toDate = to ? new Date(to) : endOfDay(now)
  return {
    from: startOfDay(fromDate),
    to: endOfDay(toDate),
    label: 'custom',
  }
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    }
  }
  return ~c >>> 0
}

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

function zipStore(files) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ])

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])

    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralDir = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ])

  return Buffer.concat([...locals, centralDir, end])
}

function sheetXml(headers, rows) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  ]

  const all = [headers, ...rows]
  all.forEach((row, rowIndex) => {
    lines.push(`<row r="${rowIndex + 1}">`)
    row.forEach((cell, colIndex) => {
      const col = String.fromCharCode(65 + colIndex)
      const ref = `${col}${rowIndex + 1}`
      lines.push(
        `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`,
      )
    })
    lines.push('</row>')
  })

  lines.push('</sheetData></worksheet>')
  return lines.join('')
}

function buildXlsxBuffer(headers, rows) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Registered Users" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(headers, rows) },
  ])
}

export async function buildUsersExcelBuffer({ preset = 'month', from, to } = {}) {
  const range = rangeForPreset(preset, from, to)
  const rows = await exportUsersRows({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  })

  const headers = [
    'Name',
    'Email',
    'Phone',
    'Registration Date',
    'Last Login',
    'Account Status',
    'Activity Status',
    'Login Count',
    'Session Count',
    'Device',
    'Browser',
    'Subscription Status',
    'Subscription Type',
  ]

  const sheetRows = rows.map((row) => [
    row.name,
    row.email,
    row.phone,
    row.registrationDate,
    row.lastLogin,
    row.accountStatus,
    row.activityStatus,
    row.loginCount,
    row.sessionCount,
    row.device,
    row.browser,
    row.subscriptionStatus,
    row.subscriptionType,
  ])

  const buffer = buildXlsxBuffer(headers, sheetRows)
  const filename = `tredsdash-users-${range.label}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return { buffer, filename, count: rows.length }
}
