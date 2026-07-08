export interface AttachmentsConfig {
  enabled: boolean;
  maxSizeBytes: number;
  imageVisionEager: boolean;
  imageVisionBatchCap: number;
  garage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}
