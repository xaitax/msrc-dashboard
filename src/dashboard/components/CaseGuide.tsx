import { useEffect, useState } from "preact/hooks";
import { bannerMarkdown } from "../../core/portalConfig";
import { statusGuide } from "../../core/statusGuide";
import type { CaseBanner, ReportApi } from "../reportApi";
import { Markdown } from "./Markdown";

// MSRC's word on a case: its banner for this case (read live, as the portal
// does) and the portal's explanation of the status, with "Action required"
// when MSRC has put the case on hold until the researcher replies. MSRC's
// words for the case replace the generic summary, except when action is needed.

const TTL_MS = 10 * 60_000;
const TONES = new Set(["info", "warning", "error", "success"]);
// Per API instance, so moving between cases (j/k) doesn't refetch every time.
const cache = new WeakMap<ReportApi, Map<string, { at: number; banners: CaseBanner[] }>>();

interface Row {
  reportNumber: string;
  status: string | null;
  statusReason: string | null;
}

export function CaseGuide({ api, row, onReply }: { api: ReportApi; row: Row; onReply: () => void }) {
  const [banners, setBanners] = useState<CaseBanner[]>([]);

  useEffect(() => {
    let live = true;
    let byCase = cache.get(api);
    if (!byCase) cache.set(api, (byCase = new Map()));
    const hit = byCase.get(row.reportNumber);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setBanners(hit.banners);
      return;
    }
    setBanners([]);
    api
      .portalBanners(row.reportNumber)
      .then((b) => {
        byCase.set(row.reportNumber, { at: Date.now(), banners: b });
        if (live) setBanners(b);
      })
      .catch(() => {}); // the explanation below stands on its own
    return () => {
      live = false;
    };
  }, [api, row.reportNumber]);

  const guide = statusGuide(row.status, row.statusReason);
  if (!guide && !banners.length) return null;
  const urgent = !!guide?.urgent;

  return (
    <section class={`guide${urgent ? " guide--urgent" : ""}`} aria-label={urgent ? "Action required" : "Where this case stands"}>
      {urgent && <p class="guide__flag">Action required</p>}
      {banners.map((b) => {
        const tone = b.tone?.toLowerCase();
        return (
          <div key={b.id} class={`guide__banner guide__banner--${TONES.has(tone) ? tone : "info"}`}>
            <Markdown src={bannerMarkdown(b.body ?? "")} />
          </div>
        );
      })}
      {guide && (urgent || !banners.length) && <Markdown class="guide__summary" src={guide.summary} />}
      {guide?.next && <Markdown class="guide__next" src={`**${urgent ? "What to do" : "Next"}:** ${guide.next}`} />}
      {urgent && (
        <button type="button" class="btn btn--primary" onClick={onReply}>
          Reply to MSRC
        </button>
      )}
    </section>
  );
}
