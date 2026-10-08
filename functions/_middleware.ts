import { enforceSiteAccess } from "../server/site-access.ts";
export const onRequest = enforceSiteAccess;
