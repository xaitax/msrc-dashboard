// MSRC addresses used by the service worker, the content script and the page.
export const MSRC_ORIGIN = "https://msrc.microsoft.com";
export const PORTAL_REPORTS = `${MSRC_ORIGIN}/report/vulnerability`;
export const API_ROOT = "https://api.msrc.microsoft.com";
export const GRAPHQL_URL = `${API_ROOT}/portalgraphql/v2.0`;

export const portalCaseUrl = (reportNumber: string) => `${PORTAL_REPORTS}/${reportNumber}`;
export const portalDraftUrl = (reportNumber: string) => `${PORTAL_REPORTS}/edit/${reportNumber}`;
