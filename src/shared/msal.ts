/** Which sessionStorage entries belong to the portal's MSAL cache. */
export function isMsalKey(key: string): boolean {
  return key.startsWith("msal") || /refreshtoken|accesstoken|idtoken/i.test(key);
}
