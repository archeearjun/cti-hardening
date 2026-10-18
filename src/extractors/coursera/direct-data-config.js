export const CTI_DIRECT_DATA_VERSION_V1 = "1.8.3";
export const CTI_DIRECT_DATA_BUILD_V1 = "v1.8.3-publisher-sections-original-images-20261018";
export function directRecoverablePublisherBuildV1(buildId) {
  return buildId === "v1.8.0-inline-widget-public-html-20261018" ||
    buildId === "v1.8.1-browser-publisher-api-20261018" ||
    buildId === "v1.8.2-historical-publisher-checkpoint-20261018";
}
export const CTI_DIRECT_DATA_EXPORT_BYTES_V1 = 128 * 1024 * 1024;
export const CTI_DIRECT_DATA_COMPRESSED_BYTES_V1 = 128 * 1024 * 1024;
export const CTI_DIRECT_DATA_MEDIA_BYTES_V1 = 512 * 1024 * 1024;
export const CTI_DIRECT_DATA_ARCHIVE_BYTES_V1 = 640 * 1024 * 1024;
export const CTI_DIRECT_DATA_MAX_ITEMS_V1 = 20000;
export const CTI_DIRECT_DATA_MAX_PARTS_V1 = 5000;
