import { convertImage } from '@uselessworks/svgify';
import type { Request, Response } from './protocol';
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (message: Response, transfer?: Transferable[]) => void };
scope.onmessage = ({ data: { id, image, options } }) => {
  try {
    const start = performance.now(), result = convertImage(image, options);
    scope.postMessage({ id, result, elapsedMs: performance.now()-start }, [result.labels.buffer]);
  } catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
