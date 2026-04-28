import type { HttpRequest, HttpResponse, HttpTransport } from "../orchestrator/types.ts";

export const realFetchTransport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method ?? "GET",
    headers: req.headers,
    body: req.body,
  });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
};
