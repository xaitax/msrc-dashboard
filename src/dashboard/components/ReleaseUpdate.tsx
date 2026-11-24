import { releaseUrl } from "../../shared/release";
import type { ReleaseUpdate } from "../useReleaseUpdate";
import { CaseIcon } from "./CaseIcon";

function ReleaseLink({ tag }: { tag: string }) {
  return <a href={releaseUrl(tag)} target="_blank" rel="noopener noreferrer">View GitHub release</a>;
}

export function ReleaseNotice({ update }: { update: ReleaseUpdate }) {
  if (!update.showNotice || !update.available) return null;
  return (
    <aside class="notice release-notice" aria-label="Dashboard update">
      <CaseIcon name="info" />
      <span class="notice__text">
        <strong>MSRC Dashboard {update.available} is available.</strong>{" "}
        <ReleaseLink tag={update.available} />
      </span>
      <button type="button" class="notice__x" aria-label="Dismiss update notice" title="Dismiss this release" onClick={update.dismiss}>×</button>
    </aside>
  );
}

export function ReleaseDetails({ update }: { update: ReleaseUpdate }) {
  let status = "";
  if (update.checking) status = "Checking GitHub…";
  else if (update.result?.unavailable) status = "Couldn’t check GitHub for updates. Try again later.";
  else if (update.available) status = `Version ${update.available.replace(/^v/i, "")} is available.`;
  else if (update.result?.latestTag) status = "You’re up to date.";
  else if (update.result) status = "No stable release found.";

  return (
    <div class="profile-release">
      <div class="profile-release__version">
        <span>Installed version <strong>{update.installed}</strong></span>
        <button type="button" class="link" disabled={update.checking} onClick={() => void update.check(true)}>Check for updates</button>
      </div>
      <p class="release-status muted" role="status">{status}</p>
      {update.available && (
        <>
          <p><ReleaseLink tag={update.available} /></p>
          <p class="muted">Download the extension ZIP. Copy the extracted folder’s contents into your existing extension folder, then click Reload on the browser’s Extensions page.</p>
        </>
      )}
    </div>
  );
}
