// Cloudflare Email Workers types
interface EmailMessage {
  readonly from: string
  readonly to: string
  readonly headers: Headers
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number

  setReject(reason: string): void
  forward(to: string, headers?: Headers): Promise<void>
}
