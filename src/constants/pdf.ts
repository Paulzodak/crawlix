export const DEFAULT_PDF_VIEWPORT = {
  width: 1280,
  height: 720,
  scale: 2,
  maxScale: 3,
  minScale: 1,
} as const;

export const PDF_WAIT_UNTIL = [
  "load",
  "domcontentloaded",
  "networkidle0",
  "networkidle2",
] as const;
