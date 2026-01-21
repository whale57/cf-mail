/**
 * 验证码提取逻辑
 * 借鉴 freemail 的三层优先级策略
 */

// 多语言关键词
const KEYWORDS =
  '(?:verification|one[-\\s]?time|two[-\\s]?factor|2fa|security|auth|login|confirm|code|otp|pin|验证码|校验码|驗證碼|確認碼|認證碼|認証コード|인증코드|코드)'

// 支持各类分隔符（空格、破折号、点号等）
const SEP_CLASS = "[\\u00A0\\s\\-–—_.·•∙‧'']"

// 4-8 位数字，允许分隔符
const CODE_CHUNK = `([0-9](?:${SEP_CLASS}?[0-9]){3,7})`

// 清理 HTML 标签
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 清理数字中的分隔符
function cleanDigits(raw: string): string {
  return raw.replace(new RegExp(SEP_CLASS, 'g'), '')
}

// 判断是否可能是非验证码数字（年份、邮编、地址）
function isLikelyNonVerificationCode(digits: string, context: string): boolean {
  // 排除年份 2000-2099
  if (digits.length === 4) {
    const year = parseInt(digits, 10)
    if (year >= 2000 && year <= 2099) return true
  }

  // 排除邮编格式（5位数字 + 地址相关词汇）
  if (digits.length === 5) {
    const addressPattern = /\b(street|st|avenue|ave|road|rd|address|zip|postal)\b/i
    if (addressPattern.test(context)) return true
  }

  // 排除地址中的数字（如 "123 Main Street"）
  const addressNumberPattern = new RegExp(`\\b${digits}\\s+[A-Z][a-z]+\\s+(street|st|avenue|ave|road|rd)`, 'i')
  if (addressNumberPattern.test(context)) return true

  return false
}

// 尝试匹配验证码
function tryMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const digits = cleanDigits(match[1])
      // 获取匹配位置的上下文（前后50字符）
      const matchIndex = text.indexOf(match[0])
      const context = text.substring(Math.max(0, matchIndex - 50), matchIndex + match[0].length + 50)

      if (!isLikelyNonVerificationCode(digits, context)) {
        return digits
      }
    }
  }
  return null
}

/**
 * 从邮件中提取验证码
 * 优先级：Subject > 正文邻近 > 宽松匹配
 */
export function extractVerificationCode(subject: string, text: string, html: string): string | null {
  const subjectText = subject || ''
  const textBody = text || ''
  const htmlBody = stripHtml(html || '')

  // 合并正文
  const bodyText = textBody || htmlBody

  // 优先级 1：Subject 中关键词邻近代码（距离 20 字符）
  const subjectPatterns = [
    new RegExp(`${KEYWORDS}[^\\n\\r\\d]{0,20}(?<!\\d)${CODE_CHUNK}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${CODE_CHUNK}(?!\\d)[^\\n\\r\\d]{0,20}${KEYWORDS}`, 'i'),
  ]

  let code = tryMatch(subjectText, subjectPatterns)
  if (code) return code

  // 优先级 2：正文中关键词邻近代码（距离 30 字符）
  const bodyPatterns = [
    new RegExp(`${KEYWORDS}[^\\n\\r\\d]{0,30}(?<!\\d)${CODE_CHUNK}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${CODE_CHUNK}(?!\\d)[^\\n\\r\\d]{0,30}${KEYWORDS}`, 'i'),
  ]

  code = tryMatch(bodyText, bodyPatterns)
  if (code) return code

  // 优先级 3：宽松匹配（距离 80 字符）
  const loosePatterns = [
    new RegExp(`${KEYWORDS}[^\\n\\r\\d]{0,80}(?<!\\d)${CODE_CHUNK}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${CODE_CHUNK}(?!\\d)[^\\n\\r\\d]{0,80}${KEYWORDS}`, 'i'),
  ]

  code = tryMatch(bodyText, loosePatterns)
  if (code) return code

  return null
}
