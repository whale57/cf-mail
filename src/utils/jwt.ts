const encoder = new TextEncoder()

async function sign(payload: object, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days

  const headerB64 = btoa(JSON.stringify(header))
  const payloadB64 = btoa(JSON.stringify({ ...payload, exp }))
  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return `${data}.${signatureB64}`
}

async function verify(token: string, secret: string): Promise<object | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !signatureB64) return null

    const data = `${headerB64}.${payloadB64}`

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Restore base64 padding
    const sig = signatureB64.replace(/-/g, '+').replace(/_/g, '/')
    const sigPadded = sig + '='.repeat((4 - (sig.length % 4)) % 4)
    const signatureBytes = Uint8Array.from(atob(sigPadded), (c) => c.charCodeAt(0))

    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data))
    if (!valid) return null

    const payload = JSON.parse(atob(payloadB64))

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export const jwt = { sign, verify }
