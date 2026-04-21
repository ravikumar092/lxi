import { parseListingData, toTitleCase, formatDateForDisplay } from '../caseHelpers'

export interface IAItem {
  number: string
  description: string
  filedBy: string
  filedOn: string
}

export interface OfficeReportData {
  jurisdiction: string
  caseTypeLabel: string
  caseNumberClean: string
  caseYear: string
  diaryNo: string
  diaryYear: string
  petitioner: string
  respondent: string
  petitionerAdvocate: string
  respondentAdvocate: string
  iaList: IAItem[]
  highCourtName: string | null
  highCourtCaseNo: string | null
  highCourtOrderDate: string | null
  trialCourtName: string | null
  trialCourtCaseNo: string | null
  trialCourtOrderDate: string | null
  serviceComplete: boolean
  respondentCount: number
  nlpaIssued: boolean
  statementOfCaseFiled: boolean
  isCriminalCase: boolean
  custodyPeriod: string | null
  custodyLocation: string | null
  delayDays: number | null
  admissionDate: string | null
  reportDate: string
  scOfficeReportDate: string | null
  lastOrderDate: string | null
  isDraft: boolean
}

function cleanAdvocate(raw: string | string[] | null | undefined): string {
  if (!raw) return 'Not on Record'
  // petitionerAdvocates is often stored as an array — take first element
  const str = Array.isArray(raw) ? (raw[0] || '') : String(raw)
  if (!str.trim()) return 'Not on Record'
  return toTitleCase(str.replace(/^\d+\s+/, '').trim())
}

function detectJurisdiction(caseNumber: string): string {
  if (/crl|criminal|cr\b/i.test(caseNumber)) {
    return 'CRIMINAL APPELLATE JURISDICTION'
  }
  if (/writ|wp/i.test(caseNumber)) {
    return 'ORIGINAL JURISDICTION'
  }
  return 'CIVIL APPELLATE JURISDICTION'
}

function detectCaseTypeLabel(caseNumber: string): string {
  const map: Record<string, string> = {
    'SLP\\(Crl': 'SPECIAL LEAVE PETITION (CRIMINAL)',
    'SLP\\(C\\)': 'SPECIAL LEAVE PETITION (CIVIL)',
    'CrA': 'CRIMINAL APPEAL',
    'CA': 'CIVIL APPEAL',
    'WP\\(Crl': 'WRIT PETITION (CRIMINAL)',
    'WP\\(C\\)': 'WRIT PETITION (CIVIL)',
    'TP\\(C\\)': 'TRANSFER PETITION (CIVIL)',
    'TP\\(Crl': 'TRANSFER PETITION (CRIMINAL)',
    'ConC': 'CONTEMPT PETITION (CIVIL)',
    'ConCr': 'CONTEMPT PETITION (CRIMINAL)',
  }
  for (const [pattern, label] of Object.entries(map)) {
    if (new RegExp(pattern, 'i').test(caseNumber)) return label
  }
  return 'SPECIAL LEAVE PETITION'
}

function extractCaseNumberClean(caseNumber: string): string {
  // "SLP(Crl) No. 003073 - / 2026 Registered on..." → "003073"
  const match = caseNumber.match(/No\.\s*([\d\-\/\s]+)/i)
  if (match) {
    return match[1].replace(/[^\d]/g, '').replace(/^0+/, '') || caseNumber
  }
  const numMatch = caseNumber.match(/\d{4,}/)
  return numMatch ? numMatch[0] : caseNumber
}

function estimateDelayDays(iaList: IAItem[]): number | null {
  for (const ia of iaList) {
    if (/delay|condonation/i.test(ia.description)) {
      const match = ia.description.match(/(\d+)\s*days?/i)
      if (match) return parseInt(match[1])
    }
  }
  return null
}

export function buildOfficeReportData(
  selected: any,
  apiData?: any
): OfficeReportData {
  const parsed = parseListingData(selected)
  const caseNumber = selected.caseNumber || ''

  const isCriminalCase = /crl|criminal|cr\b/i.test(caseNumber)

  const iaList: IAItem[] = parsed.iaNumbers.map(num => {
    // Try to find description from officeReport if available
    const apiIA = apiData?.iaList?.find((a: any) =>
      (a.iaNo || '').replace(/\D/g, '') === num.replace(/\D/g, '')
    )
    return {
      number: num,
      description: apiIA?.description || 'Interlocutory Application',
      filedBy: apiIA?.aorName
        ? toTitleCase(apiIA.aorName)
        : cleanAdvocate(selected.petitionerAdvocates),
      filedOn: apiIA?.filedOn
        ? formatDateForDisplay(apiIA.filedOn)
        : (parsed.orderDate ? formatDateForDisplay(parsed.orderDate) : '')
    }
  })

  // Extract delay from IA descriptions if available
  const delayDays = estimateDelayDays(iaList)

  // API overrides — when paid API activates these will be real values
  const serviceComplete = apiData?.serviceComplete ?? false
  const respondentCount = apiData?.respondentCount ?? 1
  const nlpaIssued = apiData?.nlpaIssued ?? false
  const statementOfCaseFiled = apiData?.statementOfCaseFiled ?? false
  const custodyPeriod = apiData?.custodyPeriod ?? null
  const custodyLocation = apiData?.custodyLocation ?? null
  const highCourtName = apiData?.highCourtName ?? null
  const highCourtCaseNo = apiData?.highCourtCaseNo ?? null
  const highCourtOrderDate = apiData?.highCourtOrderDate
    ? formatDateForDisplay(apiData.highCourtOrderDate)
    : null
  const trialCourtName = apiData?.trialCourtName ?? null
  const trialCourtCaseNo = apiData?.trialCourtCaseNo ?? null
  const trialCourtOrderDate = apiData?.trialCourtOrderDate
    ? formatDateForDisplay(apiData.trialCourtOrderDate)
    : null
  const scOfficeReportDate = apiData?.scOfficeReportDate ?? null
  const lastOrderDate = apiData?.lastOrderDate ?? null
  const admissionDate = apiData?.admissionDate
    ? formatDateForDisplay(apiData.admissionDate)
    : null

  // Format today's date as "03rd day of September, 2024"
  const today = new Date()
  const day = today.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd' : 'th'
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December']
  const reportDate = `${day}${suffix} day of ${months[today.getMonth()]}, ${today.getFullYear()}`

  return {
    jurisdiction: detectJurisdiction(caseNumber),
    caseTypeLabel: detectCaseTypeLabel(caseNumber),
    caseNumberClean: extractCaseNumberClean(caseNumber),
    caseYear: selected.diaryYear || new Date().getFullYear().toString(),
    diaryNo: selected.diaryNo || '',
    diaryYear: selected.diaryYear || '',
    petitioner: toTitleCase(
      String(Array.isArray(selected.petitioner) ? selected.petitioner[0] : (selected.petitioner || selected.petitioners?.[0] || 'Petitioner')).replace(/^\d+\s+/, '').trim()
    ),
    respondent: toTitleCase(
      String(Array.isArray(selected.respondent) ? selected.respondent[0] : (selected.respondent || selected.respondents?.[0] || 'Respondent')).replace(/^\d+\s+/, '').trim()
    ),
    petitionerAdvocate: cleanAdvocate(selected.petitionerAdvocates),
    respondentAdvocate: cleanAdvocate(selected.respondentAdvocates),
    iaList,
    highCourtName,
    highCourtCaseNo,
    highCourtOrderDate,
    trialCourtName,
    trialCourtCaseNo,
    trialCourtOrderDate,
    scOfficeReportDate,
    lastOrderDate,
    serviceComplete,
    respondentCount,
    nlpaIssued,
    statementOfCaseFiled,
    isCriminalCase,
    custodyPeriod,
    custodyLocation,
    delayDays,
    admissionDate,
    reportDate,
    isDraft: !apiData || (!apiData.highCourtName && !apiData.trialCourtName)
  }
}

// ── HTML RENDERER — Supreme Court office report format ─────────────────────────
export function renderOfficeReportHtml(d: OfficeReportData): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const parts: string[] = []

  // ── Case title block ──────────────────────────────────────────────────────
  if (d.iaList.length > 0) {
    parts.push(`<p class="sc-center sc-bold">INTERLOCUTORY APPLICATION NO.&nbsp;${esc(d.iaList[0].number)}</p>`)
    parts.push(`<p class="sc-center sc-italic">(${esc(d.iaList[0].description)})</p>`)
    parts.push(`<p class="sc-center sc-bold">IN</p>`)
  }
  parts.push(`<p class="sc-center sc-bold">${esc(d.caseTypeLabel)}&nbsp;NO.&nbsp;${esc(d.caseNumberClean)}&nbsp;OF&nbsp;${esc(d.caseYear)}</p>`)

  for (let i = 1; i < d.iaList.length; i++) {
    parts.push(`<p class="sc-center">WITH</p>`)
    parts.push(`<p class="sc-center sc-bold">INTERLOCUTORY APPLICATION NO.&nbsp;${esc(d.iaList[i].number)}</p>`)
    parts.push(`<p class="sc-center sc-italic">(${esc(d.iaList[i].description)})</p>`)
  }

  parts.push(`<div class="sc-gap"></div>`)

  // ── Parties ───────────────────────────────────────────────────────────────
  parts.push(`<table class="sc-parties"><tbody>`)
  parts.push(`<tr><td class="sc-party-name">${esc(d.petitioner.toUpperCase())}</td><td class="sc-party-role">…Petitioner(s)</td></tr>`)
  parts.push(`<tr><td class="sc-versus" colspan="2">— VERSUS —</td></tr>`)
  parts.push(`<tr><td class="sc-party-name">${esc(d.respondent.toUpperCase())}</td><td class="sc-party-role">…Respondent(s)</td></tr>`)
  parts.push(`</tbody></table>`)

  parts.push(`<div class="sc-gap"></div>`)
  parts.push(`<p class="sc-center sc-bold sc-underline sc-title">OFFICE REPORT</p>`)
  parts.push(`<div class="sc-gap-sm"></div>`)

  // ── Opening ───────────────────────────────────────────────────────────────
  if (d.admissionDate) {
    parts.push(`<p class="sc-body">The instant appeal is by Special Leave granted vide this Court's order dated ${esc(d.admissionDate)}.</p>`)
  } else {
    const hcRef = d.highCourtName
      ? ` against the judgment and order dated <strong>${esc(d.highCourtOrderDate || '___')}</strong> passed by <strong>${esc(d.highCourtName)}</strong> in <strong>${esc(d.highCourtCaseNo || '___')}</strong>`
      : ''
    parts.push(`<p class="sc-body">The instant petition is filed seeking Special Leave to Appeal${hcRef}.</p>`)
  }

  // ── Earlier courts table ──────────────────────────────────────────────────
  if (d.trialCourtName || d.highCourtName) {
    parts.push(`<p class="sc-body sc-bold">1.&nbsp; The details of the case before the earlier Court(s) are as follows:</p>`)
    parts.push(`<table class="sc-table"><thead><tr><th>Court</th><th>Case No.</th><th>Order Date</th></tr></thead><tbody>`)
    if (d.trialCourtName) {
      parts.push(`<tr><td>${esc(d.trialCourtName)}</td><td>${esc(d.trialCourtCaseNo || '—')}</td><td>${esc(d.trialCourtOrderDate || '—')}</td></tr>`)
    }
    if (d.highCourtName) {
      parts.push(`<tr><td>${esc(d.highCourtName)}</td><td>${esc(d.highCourtCaseNo || '—')}</td><td>${esc(d.highCourtOrderDate || '—')}</td></tr>`)
    }
    parts.push(`</tbody></table>`)
  }

  if (d.scOfficeReportDate) {
    parts.push(`<p class="sc-body sc-italic">[Last SC Office Report dated: ${esc(d.scOfficeReportDate)}]</p>`)
  }
  if (d.lastOrderDate) {
    parts.push(`<p class="sc-body sc-italic">[Last Order passed on: ${esc(d.lastOrderDate)}]</p>`)
  }

  // ── Service position ──────────────────────────────────────────────────────
  parts.push(`<p class="sc-body sc-bold">Detailed Service Position is as under:</p>`)
  parts.push(`<table class="sc-table"><thead><tr><th>Case No.</th><th>Vakalatnama / Appearance</th><th>Service</th></tr></thead><tbody>`)
  parts.push(`<tr><td>${esc(d.caseNumberClean)}/${esc(d.caseYear)}</td><td>RR No.1 — ${esc(d.respondentAdvocate)}, Adv.</td><td>${d.serviceComplete ? 'Service is complete.' : 'Service pending.'}</td></tr>`)
  parts.push(`</tbody></table>`)

  // ── Numbered paragraphs ───────────────────────────────────────────────────
  let n = d.trialCourtName || d.highCourtName ? 2 : 1

  parts.push(`<p class="sc-para"><span class="sc-para-no">${n++}.</span> It is submitted that NLPA has ${d.nlpaIssued ? '<strong>been</strong>' : '<strong>not yet been</strong>'} issued for the record of the Hon'ble Court.</p>`)

  if (!d.statementOfCaseFiled) {
    parts.push(`<p class="sc-para"><span class="sc-para-no">${n++}.</span> It is further submitted that Counsel for the Petitioner/Appellant as well as Counsel for the Respondent(s) have <strong>not</strong> filed Statement of Case so far.</p>`)
  }

  if (d.delayDays && d.delayDays > 0) {
    parts.push(`<p class="sc-para"><span class="sc-para-no">${n++}.</span> It is submitted that there is a delay of <strong>${d.delayDays} days</strong> in filing the petition. An application for condonation of delay has been filed.</p>`)
  }

  for (const ia of d.iaList) {
    parts.push(`<p class="sc-para"><span class="sc-para-no">${n++}.</span> It is further submitted that <strong>${esc(ia.filedBy)}</strong> has${ia.filedOn ? ' on <strong>' + esc(ia.filedOn) + '</strong>' : ''} filed <em>${esc(ia.description)}</em> (Registered as I.A. No.&nbsp;${esc(ia.number)}).</p>`)
  }

  if (d.isCriminalCase && d.custodyPeriod) {
    parts.push(`<p class="sc-para"><span class="sc-para-no">${n++}.</span> It is submitted that the petitioner has been in custody for a period of <strong>${esc(d.custodyPeriod)}</strong>${d.custodyLocation ? ' and is lodged at <strong>' + esc(d.custodyLocation) + '</strong>' : ''}.</p>`)
  }

  parts.push(`<div class="sc-gap-sm"></div>`)
  parts.push(`<p class="sc-body">The ${d.iaList.length > 0 ? 'application' : 'petition'} in the ${esc(d.caseTypeLabel.toLowerCase())} above-mentioned is listed before the Hon'ble Court with this Office Report.</p>`)

  // ── Signature block ───────────────────────────────────────────────────────
  parts.push(`<div class="sc-gap"></div>`)
  parts.push(`<table class="sc-sig"><tbody><tr>`)
  parts.push(`<td class="sc-sig-date">Dated this the ${esc(d.reportDate)}.</td>`)
  parts.push(`<td class="sc-sig-name">ASSISTANT REGISTRAR</td>`)
  parts.push(`</tr></tbody></table>`)

  if (d.isDraft) {
    parts.push(`<div class="sc-draft-banner">⚠ LEX TIGRESS DRAFT — Not an official SC document. For preparation purposes only.</div>`)
  }

  return parts.join('\n')
}

// ── PLAIN TEXT RENDERER ────────────────────────────────────────────────────────
export function renderOfficeReportText(d: OfficeReportData): string {
  const lines: string[] = []
  const center = (s: string) => s
  lines.push(center('IN THE SUPREME COURT OF INDIA'))
  lines.push(center(d.jurisdiction))
  lines.push('')

  if (d.iaList.length > 0) {
    lines.push(center(`INTERLOCUTORY APPLICATION NO.${d.iaList[0].number}`))
    lines.push(center(`(${d.iaList[0].description})`))
    lines.push(center('IN'))
    lines.push('')
  }

  lines.push(center(`${d.caseTypeLabel} NO. ${d.caseNumberClean} OF ${d.caseYear}`))
  lines.push('')

  if (d.iaList.length > 1) {
    for (let i = 1; i < d.iaList.length; i++) {
      lines.push(center('WITH'))
      lines.push(center(`INTERLOCUTORY APPLICATION NO.${d.iaList[i].number}`))
      lines.push(center(`(${d.iaList[i].description})`))
    }
    lines.push('')
  }

  lines.push(`${d.petitioner.toUpperCase()}          ...Petitioner(s)`)
  lines.push('          -VERSUS-')
  lines.push(`${d.respondent.toUpperCase()}          ...Respondent(s)`)
  lines.push('')
  lines.push('OFFICE REPORT')
  lines.push('')

  if (d.admissionDate) {
    lines.push(`The instant appeal is by Special Leave granted vide this Court's order dated ${d.admissionDate}.`)
  } else {
    lines.push(`The instant petition is filed seeking Special Leave to Appeal${d.highCourtName ? ` against the judgment and order dated ${d.highCourtOrderDate || '___'} passed by ${d.highCourtName} in ${d.highCourtCaseNo || '___'}` : ''}.`)
  }
  lines.push('')

  // Earlier court details section (populated from SC website)
  if (d.trialCourtName || d.highCourtName) {
    lines.push('1. The details of the case before the Trial Court/High Court are as follows:')
    lines.push('')
    const col1 = 32, col2 = 24
    lines.push(`${'Court'.padEnd(col1)} ${'Case No.'.padEnd(col2)} Order Date`)
    lines.push('─'.repeat(72))
    if (d.trialCourtName) {
      lines.push(`${d.trialCourtName.padEnd(col1)} ${(d.trialCourtCaseNo || '—').padEnd(col2)} ${d.trialCourtOrderDate || '—'}`)
    }
    if (d.highCourtName) {
      lines.push(`${d.highCourtName.padEnd(col1)} ${(d.highCourtCaseNo || '—').padEnd(col2)} ${d.highCourtOrderDate || '—'}`)
    }
    lines.push('')
  }

  if (d.scOfficeReportDate) {
    lines.push(`[Last SC Office Report dated: ${d.scOfficeReportDate}]`)
    lines.push('')
  }

  if (d.lastOrderDate) {
    lines.push(`[Last Order passed on: ${d.lastOrderDate}]`)
    lines.push('')
  }

  lines.push('Detailed Service Position is as under:')
  lines.push('')
  lines.push('Case No. | Vakalatnama/Appearance | Service')
  lines.push(`${d.caseNumberClean}/${d.caseYear} | RR No.1-${d.respondentAdvocate}, Adv. | ${d.serviceComplete ? 'Service is complete.' : 'Service pending.'}`)
  lines.push('')

  let paraNum = 1
  lines.push(`${paraNum++}. It is submitted that NLPA has ${d.nlpaIssued ? 'been' : 'not yet been'} issued for the record of the Hon'ble Court.`)
  lines.push('')

  if (!d.statementOfCaseFiled) {
    lines.push(`${paraNum++}. It is further submitted that Counsel for the Petitioner/Appellant as well as Counsel for the Respondent(s) have not filed Statement of Case so far.`)
    lines.push('')
  }

  if (d.delayDays && d.delayDays > 0) {
    lines.push(`${paraNum++}. It is submitted that there is a delay of ${d.delayDays} days in filing the petition. An application for condonation of delay has been filed.`)
    lines.push('')
  }

  for (const ia of d.iaList) {
    lines.push(`${paraNum++}. It is further submitted that ${ia.filedBy} has${ia.filedOn ? ' on ' + ia.filedOn : ''} filed ${ia.description} (Registered as I.A. No.${ia.number}).`)
    lines.push('')
  }

  if (d.isCriminalCase && d.custodyPeriod) {
    lines.push(`${paraNum++}. It is submitted that the petitioner has been in custody for a period of ${d.custodyPeriod}${d.custodyLocation ? ' and is lodged at ' + d.custodyLocation : ''}.`)
    lines.push('')
  }

  lines.push(`The ${d.iaList.length > 0 ? 'application' : 'petition'} in the ${d.caseTypeLabel.toLowerCase()} above-mentioned is listed before the Hon'ble Court with this Office Report.`)
  lines.push('')
  lines.push(`Dated this the ${d.reportDate}.`)
  lines.push('')
  lines.push('                              ASSISTANT REGISTRAR')

  if (d.isDraft) {
    lines.push('')
    lines.push('[LEX TIGRESS DRAFT — NOT AN OFFICIAL SC DOCUMENT]')
  }

  return lines.join('\n')
}
