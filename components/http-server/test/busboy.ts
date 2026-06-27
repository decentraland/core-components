import { IHttpServerComponent } from '@dcl/core-commons'
import busboy, { FieldInfo, FileInfo } from 'busboy'
import { Readable } from 'stream'

export type FormDataContext = IHttpServerComponent.DefaultContext & {
  formData: {
    fields: Record<
      string,
      FieldInfo & {
        fieldname: string
        value: string
      }
    >
    files: Record<
      string,
      FileInfo & {
        fieldname: string
        value: Buffer
      }
    >
  }
}

export function multipartParserWrapper<Ctx extends FormDataContext, T extends IHttpServerComponent.IResponse>(
  handler: (ctx: Ctx) => Promise<T>
): (ctx: IHttpServerComponent.DefaultContext) => Promise<T> {
  return async function (ctx): Promise<T> {
    const formDataParser = busboy({
      headers: {
        'content-type': ctx.request.headers.get('content-type') || undefined
      }
    })

    const fields: FormDataContext['formData']['fields'] = {}
    const files: FormDataContext['formData']['files'] = {}

    const finished = new Promise((ok, err) => {
      formDataParser.on('error', err)
      formDataParser.on('finish', ok)
    })

    /**
     * Emitted for each new non-file field found.
     */
    formDataParser.on('field', function (name: string, value: string, info: FieldInfo): void {
      fields[name] = {
        fieldname: name,
        value,
        ...info
      }
    })
    formDataParser.on('file', function (name: string, stream: Readable, info: FileInfo) {
      const chunks: any[] = []
      stream.on('data', function (data) {
        chunks.push(data)
      })
      stream.on('end', function () {
        files[name] = {
          ...info,
          fieldname: name,
          value: Buffer.concat(chunks)
        }
      })
    })

    // The native `Request` body is a web `ReadableStream`; adapt it to a Node stream to pipe to busboy.
    if (ctx.request.body) {
      const body = Readable.fromWeb(ctx.request.body as unknown as Parameters<typeof Readable.fromWeb>[0])
      // `pipe` does not forward *source* errors to the destination. Without this, a body-stream error
      // — a client abort, or the server's `maxBodySize` limiter emitting its `413` — lands on a stream
      // with no listener and surfaces as an unhandled error. Forward it so the parser (and thus the
      // `finished` promise) rejects with the original error, which the error middleware maps to a `413`.
      body.on('error', (err) => formDataParser.destroy(err))
      body.pipe(formDataParser)
    } else {
      formDataParser.end()
    }

    const newContext: Ctx = Object.assign(Object.create(ctx), { formData: { fields, files } })

    await finished

    return handler(newContext)
  }
}
