import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { jwt } from '../utils/jwt'

type Bindings = {
  ADMIN_PASSWORD: string
  JWT_SECRET: string
}

const auth = new Hono<{ Bindings: Bindings }>()

auth.post('/login', async (c) => {
  const body = await c.req.json<{ password: string }>()

  if (!body.password || body.password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401)
  }

  const token = await jwt.sign({ role: 'admin' }, c.env.JWT_SECRET)

  setCookie(c, 'token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/',
  })

  return c.json({ success: true })
})

auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' })
  return c.json({ success: true })
})

export { auth }
