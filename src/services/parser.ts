/**
 * 简单的 MIME 邮件解析器
 * 支持：多部分邮件、Base64/Quoted-Printable 编码、附件提取
 */

export interface ParsedEmail {
  from: string
  to: string[]
  subject: string
  text: string
  html: string
  attachments: Attachment[]
}

export interface Attachment {
  filename: string
  contentType: string
  content: Uint8Array
}

// 解析邮件头部的编码（=?UTF-8?B?xxx?= 或 =?UTF-8?Q?xxx?=）
function decodeHeaderValue(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64
        const binary = atob(encoded)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        return new TextDecoder(charset).decode(bytes)
      } else {
        // Quoted-Printable
        const decoded = encoded.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        )
        return decoded
      }
    } catch {
      return encoded
    }
  })
}

// 解码 Base64
function decodeBase64(str: string): Uint8Array {
  const binary = atob(str.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// 解码 Quoted-Printable（返回字节数组，由调用方决定字符集）
function decodeQuotedPrintableBytes(str: string): Uint8Array {
  const cleaned = str.replace(/=\r?\n/g, '') // 软换行
  const bytes: number[] = []
  let i = 0
  while (i < cleaned.length) {
    if (cleaned[i] === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.substring(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16))
        i += 3
        continue
      }
    }
    bytes.push(cleaned.charCodeAt(i))
    i++
  }
  return new Uint8Array(bytes)
}

// 从 Content-Type 提取 charset
function getCharset(contentType: string): string {
  const match = contentType.match(/charset=["']?([^"';\s]+)["']?/i)
  return match ? match[1].toLowerCase() : 'utf-8'
}

// 解析邮件头部
function parseHeaders(headerSection: string): Map<string, string> {
  const headers = new Map<string, string>()
  const lines = headerSection.split(/\r?\n/)
  let currentKey = ''
  let currentValue = ''

  for (const line of lines) {
    if (/^\s/.test(line)) {
      // 折叠行，继续上一个头部
      currentValue += ' ' + line.trim()
    } else {
      // 保存上一个头部
      if (currentKey) {
        headers.set(currentKey.toLowerCase(), decodeHeaderValue(currentValue))
      }
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        currentKey = line.substring(0, colonIndex).trim()
        currentValue = line.substring(colonIndex + 1).trim()
      }
    }
  }
  // 保存最后一个头部
  if (currentKey) {
    headers.set(currentKey.toLowerCase(), decodeHeaderValue(currentValue))
  }

  return headers
}

// 提取 boundary
function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=["']?([^"';\s]+)["']?/i)
  return match ? match[1] : null
}

// 解析单个 MIME 部分
function parsePart(
  part: string,
  result: { text: string; html: string; attachments: Attachment[] }
) {
  const divider = part.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n'
  const dividerIndex = part.indexOf(divider)
  if (dividerIndex === -1) return

  const headerSection = part.substring(0, dividerIndex)
  const bodySection = part.substring(dividerIndex + divider.length)
  const headers = parseHeaders(headerSection)

  const contentType = headers.get('content-type') || 'text/plain'
  const contentTransferEncoding = headers.get('content-transfer-encoding') || ''
  const contentDisposition = headers.get('content-disposition') || ''

  // 递归处理嵌套的 multipart
  if (contentType.includes('multipart/')) {
    const boundary = getBoundary(contentType)
    if (boundary) {
      parseMultipart(bodySection, boundary, result)
    }
    return
  }

  // 解码内容
  let decodedBody: string | Uint8Array = bodySection
  const charset = getCharset(contentType)

  if (contentTransferEncoding.toLowerCase() === 'base64') {
    if (contentType.startsWith('text/')) {
      const bytes = decodeBase64(bodySection)
      decodedBody = new TextDecoder(charset).decode(bytes)
    } else {
      decodedBody = decodeBase64(bodySection)
    }
  } else if (contentTransferEncoding.toLowerCase() === 'quoted-printable') {
    const bytes = decodeQuotedPrintableBytes(bodySection)
    if (contentType.startsWith('text/')) {
      decodedBody = new TextDecoder(charset).decode(bytes)
    } else {
      decodedBody = bytes
    }
  }

  // 判断是附件还是正文
  const isAttachment =
    contentDisposition.includes('attachment') ||
    (contentDisposition.includes('filename') && !contentType.startsWith('text/'))

  if (isAttachment || (!contentType.startsWith('text/') && typeof decodedBody !== 'string')) {
    // 附件
    let filename = 'attachment'
    const filenameMatch = contentDisposition.match(/filename=["']?([^"';\n]+)["']?/i)
    if (filenameMatch) {
      filename = decodeHeaderValue(filenameMatch[1])
    }

    const content = typeof decodedBody === 'string' ? new TextEncoder().encode(decodedBody) : decodedBody

    result.attachments.push({
      filename,
      contentType: contentType.split(';')[0].trim(),
      content,
    })
  } else if (contentType.includes('text/html')) {
    result.html = typeof decodedBody === 'string' ? decodedBody : new TextDecoder().decode(decodedBody)
  } else if (contentType.includes('text/plain')) {
    result.text = typeof decodedBody === 'string' ? decodedBody : new TextDecoder().decode(decodedBody)
  }
}

// 解析 multipart 邮件
function parseMultipart(
  body: string,
  boundary: string,
  result: { text: string; html: string; attachments: Attachment[] }
) {
  const parts = body.split(`--${boundary}`)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === '--') continue
    parsePart(trimmed, result)
  }
}

// 提取邮箱地址
function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/) || str.match(/([^\s<>]+@[^\s<>]+)/)
  return match ? match[1] : str
}

// 主解析函数
export function parseEmail(rawEmail: string): ParsedEmail {
  const divider = rawEmail.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n'
  const dividerIndex = rawEmail.indexOf(divider)

  const headerSection = rawEmail.substring(0, dividerIndex)
  const bodySection = rawEmail.substring(dividerIndex + divider.length)

  const headers = parseHeaders(headerSection)

  const result = {
    from: extractEmail(headers.get('from') || ''),
    to: (headers.get('to') || '').split(',').map((s) => extractEmail(s.trim())),
    subject: headers.get('subject') || '(No Subject)',
    text: '',
    html: '',
    attachments: [] as Attachment[],
  }

  const contentType = headers.get('content-type') || 'text/plain'
  const contentTransferEncoding = headers.get('content-transfer-encoding') || ''

  if (contentType.includes('multipart/')) {
    const boundary = getBoundary(contentType)
    if (boundary) {
      parseMultipart(bodySection, boundary, result)
    }
  } else {
    // 单体邮件
    let decodedBody = bodySection
    const charset = getCharset(contentType)

    if (contentTransferEncoding.toLowerCase() === 'base64') {
      const bytes = decodeBase64(bodySection)
      decodedBody = new TextDecoder(charset).decode(bytes)
    } else if (contentTransferEncoding.toLowerCase() === 'quoted-printable') {
      const bytes = decodeQuotedPrintableBytes(bodySection)
      decodedBody = new TextDecoder(charset).decode(bytes)
    }

    if (contentType.includes('text/html')) {
      result.html = decodedBody
    } else {
      result.text = decodedBody
    }
  }

  return result
}
