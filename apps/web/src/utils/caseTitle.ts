export const toTitleCase = (
  str: string
): string => {
  if (!str) return ''
  const lower = [
    'vs','v/s','and','the','of',
    'in','a','an','by','for','to'
  ]
  return str
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      const isLowerWord = i > 0 && lower.includes(word)
      if (isLowerWord) return word
      // Handle words with parentheses like "(dead)"
      if (word.startsWith('(') && word.endsWith(')')) {
        const inner = word.slice(1, -1)
        return '(' + inner.charAt(0).toUpperCase() + inner.slice(1) + ')'
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export const formatParty = (
  raw: string | null | undefined
): string => {
  if (!raw) return ''

  const cleaned = raw.trim()

  // Remove leading number prefix if present
  // "1 STATE OF..." → "STATE OF..."
  const withoutLeading = cleaned
    .replace(/^\d+\s+/, '')
    .trim()

  // Split on boundaries where a number
  // appears between text segments
  const splitPattern = cleaned
    // Handle "NAME2 NAME" format
    // digit between letter and uppercase
    .replace(
      /([a-zA-Z\)])(\d+)(\s+[A-Z])/g,
      '$1||$3'
    )
    // Handle "1 NAME 2 NAME" format  
    // standalone digit before uppercase
    .replace(
      /(?<!\d)(\s+)(\d+)(\s+)(?=[A-Z])/g,
      '||'
    )

  const parts = splitPattern
    .split('||')
    .map(p => p.trim())
    .filter(p => p.length > 1)
    // Remove sub-party entries (1.1, 1.2)
    .filter(p => !/^\d+\.\d/.test(p))
    // Remove standalone numbers
    .filter(p => !/^\d+$/.test(p))

  if (parts.length === 0) {
    return toTitleCase(withoutLeading)
  }

  // Get first party — clean it up
  const firstName = parts[0]
    .replace(/^\d+\s+/, '')
    // Remove any sub party text
    .replace(/\s+\d+\.\d+\s+.*/gs, '')
    .trim()

  const count = parts.length
  const formatted = toTitleCase(firstName)

  if (!formatted) return ''
  if (count === 1) return formatted
  if (count === 2) return formatted + ' & Anr'
  return formatted + ' & Ors'
}

export const listParties = (
  raw: string | null | undefined
): string[] => {
  if (!raw) return []

  const cleaned = raw.trim()

  // Split on number separators (e.g. "1 Name 2 Name" or "Name2 Name")
  const splitPattern = cleaned
    .replace(/([a-zA-Z\)])(\d+)(\s+[A-Z])/g, '$1||$3')
    .replace(/(?<!\d)(\s+)(\d+)(\s+)(?=[A-Z])/g, '||')

  let parts = splitPattern
    .split('||')
    .map(p => p.trim())
    .filter(p => p.length > 1)
    .filter(p => !/^\d+\.\d/.test(p))
    .filter(p => !/^\d+$/.test(p))
    .map(p => p.replace(/^\d+\s+/, '').replace(/\s+\d+\.\d+\s+.*/gs, '').trim())

  // If no number-based split found, try splitting on "@"
  if (parts.length <= 1) {
    parts = cleaned
      .split('@')
      .map(p => p.replace(/^\d+\s+/, '').trim())
      .filter(p => p.length > 1)
  }

  return parts.map(p => toTitleCase(p)).filter(Boolean)
}

export const formatCaseTitle = (
  caseData: any
): string => {
  const petRaw =
    caseData.petitioner ||
    caseData.petitioner_name ||
    caseData['Petitioner(s)'] ||
    ''

  const resRaw =
    caseData.respondent ||
    caseData.respondent_name ||
    caseData['Respondent(s)'] ||
    ''

  if (!petRaw && !resRaw && caseData.parties) {
    const parts = caseData.parties
      .split(/\svs?\.\s/i)
    if (parts.length >= 2) {
      return toTitleCase(parts[0].trim()) +
             ' vs ' +
             toTitleCase(parts[1].trim())
    }
    return toTitleCase(caseData.parties)
  }

  const pet = formatParty(petRaw)
  const res = formatParty(resRaw)

  if (!pet && !res) return 'Case Title Unavailable'
  if (!res) return pet
  if (!pet) return res
  return pet + ' vs ' + res
}

export const formatCaseTitleShort = (
  caseData: any,
  max: number = 55
): string => {
  const full = formatCaseTitle(caseData)
  return full.length <= max
    ? full
    : full.substring(0, max - 3) + '...'
}
