export interface VisionClient {
  analyzeBase64Image(params: {
    base64: string;
    mimeType: string;
    prompt: string;
  }): Promise<VisionAnalysis>;
}

export interface VisionAnalysis {
  description: string;
  elements_detected: string[];
  text_content: string;
  ui_components: string[];
}

export interface DescribedImage {
  markdown: string;
  available: boolean;
  analysis?: VisionAnalysis;
}
