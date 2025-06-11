function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function normalizeOrganizationId(orgId: string, merchantId?: string): string {
  if (!orgId || !orgId.includes('_') || orgId.length <= 20) {
    return orgId;
  }
  
  const baseOrgId = orgId.split('_')[0];
  
  if (merchantId) {
    const merchantHash = hashString(merchantId).substring(0, 8);
    return `${baseOrgId}_${merchantHash}`;
  }
  
  return baseOrgId;
}