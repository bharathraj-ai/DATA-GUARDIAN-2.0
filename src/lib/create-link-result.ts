export type CreateSecureLinkResult = {
    success: boolean;
    shareUrl?: string;
    ownerUrl?: string;
    expiresAt?: string;
    purpose?: string;
    error?: string;
};
