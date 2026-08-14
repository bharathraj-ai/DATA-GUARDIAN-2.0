export type CreateLinkVendor = {
    email: string;
    level: number;
};

/** JSON body for POST /api/create-link after files are staged. */
export type CreateLinkJson = {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    gender?: string;
    age?: number;
    expiryMode?: string;
    expiryAmount?: number;
    purpose: string;
    purposeDetail?: string;
    notificationEmail?: string;
    allowEditing?: boolean;
    allowDownload?: boolean;
    vendors: CreateLinkVendor[];
    stagedGridFsIds: string[];
};
