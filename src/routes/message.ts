import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  R2: R2Bucket
}

const message = new Hono<{ Bindings: Bindings }>()

// GET /api/mailboxes/:mailboxId/messages - 邮件列表
message.get('/mailboxes/:mailboxId/messages', async (c) => {
  const mailboxId = c.req.param('mailboxId')

  // 验证邮箱存在
  const mailboxRow = await c.env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?')
    .bind(mailboxId)
    .first()

  if (!mailboxRow) {
    return c.json({ error: 'Mailbox not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT id, sender, subject, preview, verification_code, received_at, is_read
     FROM messages
     WHERE mailbox_id = ?
     ORDER BY received_at DESC`
  )
    .bind(mailboxId)
    .all()

  return c.json({ messages: result.results })
})

// GET /api/messages/:id - 邮件详情
message.get('/messages/:id', async (c) => {
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.sender, m.subject, m.preview, m.verification_code,
            m.r2_key, m.received_at, m.is_read, mb.address as mailbox_address
     FROM messages m
     JOIN mailboxes mb ON m.mailbox_id = mb.id
     WHERE m.id = ?`
  )
    .bind(id)
    .first()

  if (!row) {
    return c.json({ error: 'Message not found' }, 404)
  }

  // 获取附件列表
  const attachments = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size, hash FROM attachments WHERE message_id = ?'
  )
    .bind(id)
    .all()

  // 从 R2 读取邮件内容
  const emlObject = await c.env.R2.get(row.r2_key as string)
  let htmlContent = ''
  let textContent = ''

  if (emlObject) {
    if (emlObject) {
      const emlText = await emlObject.text()

      // 使用统一的邮件解析器
      const { parseEmail } = await import('../services/parser')
      const parsed = parseEmail(emlText)

      htmlContent = parsed.html || ''
      textContent = parsed.text || ''
    }
  }

  // 标记为已读
  if (!row.is_read) {
    await c.env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(id).run()
  }

  return c.json({
    message: {
      ...row,
      html: htmlContent,
      text: textContent,
      attachments: attachments.results,
    },
  })
})

// GET /api/messages/:id/raw - 原始 EML
message.get('/messages/:id/raw', async (c) => {
  const id = c.req.param('id')

  const row = await c.env.DB.prepare('SELECT r2_key FROM messages WHERE id = ?').bind(id).first()

  if (!row) {
    return c.json({ error: 'Message not found' }, 404)
  }

  const emlObject = await c.env.R2.get(row.r2_key as string)

  if (!emlObject) {
    return c.json({ error: 'EML file not found' }, 404)
  }

  return new Response(emlObject.body, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="message-${id}.eml"`,
    },
  })
})

// DELETE /api/messages/:id - 删除邮件
message.delete('/messages/:id', async (c) => {
  const id = c.req.param('id')

  const row = await c.env.DB.prepare('SELECT r2_key FROM messages WHERE id = ?').bind(id).first()

  if (!row) {
    return c.json({ error: 'Message not found' }, 404)
  }

  // 获取附件的 R2 keys（需要检查是否被其他邮件引用）
  const attachments = await c.env.DB.prepare(
    `SELECT a.hash, a.r2_key, COUNT(*) as ref_count
     FROM attachments a
     WHERE a.hash IN (SELECT hash FROM attachments WHERE message_id = ?)
     GROUP BY a.hash`
  )
    .bind(id)
    .all()

  // 删除数据库记录（级联删除附件记录）
  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run()

  // 删除 R2 中的 EML 文件
  await c.env.R2.delete(row.r2_key as string)

  // 删除不再被引用的附件文件
  for (const att of attachments.results || []) {
    if ((att.ref_count as number) === 1) {
      await c.env.R2.delete(att.r2_key as string)
    }
  }

  return c.json({ success: true })
})

export { message }
