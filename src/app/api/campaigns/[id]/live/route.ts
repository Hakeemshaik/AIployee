import { apiContext } from "@/lib/auth";
import { getCampaignLiveState } from "@/services/campaign-live";

// GET /api/campaigns/:id/live
//
// Server-Sent Events stream of campaign state. Sends a frame only when the
// revision changes, so an idle campaign costs nothing and the page never
// does a full reload. Falls back gracefully: any client can also GET
// ?snapshot=1 for a single JSON payload.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  const { id } = await params;
  const url = new URL(request.url);

  const first = await getCampaignLiveState(ctx.organizationId, id);
  if (!first) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });

  if (url.searchParams.get("snapshot")) {
    return Response.json(first);
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("state", first);
      let revision = first.revision;
      const started = Date.now();

      const tick = async () => {
        if (closed) return;
        try {
          const next = await getCampaignLiveState(ctx.organizationId, id);
          if (next && next.revision !== revision) {
            revision = next.revision;
            send("state", next);
          } else {
            // Comment frame keeps proxies from closing an idle connection.
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch {
          // transient database error — keep the stream open and retry
        }
        // Serverless functions have an execution ceiling; end the stream
        // cleanly after 4 minutes and let EventSource reconnect.
        if (Date.now() - started > 4 * 60_000) {
          closed = true;
          controller.close();
          return;
        }
        setTimeout(tick, 3000);
      };
      setTimeout(tick, 3000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
