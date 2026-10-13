import puppeteer from "puppeteer";
import type { PdfRenderInput } from "../../parsers/pdf.js";
import { getPuppeteerLaunchOptions } from "../../utils/puppeteer-launch.js";

export type RenderedDocument = {
  contentType: string;
  filename: string;
  body: Buffer;
};

export async function renderHtmlDocument(input: PdfRenderInput): Promise<RenderedDocument> {
  const browser = await puppeteer.launch(getPuppeteerLaunchOptions());
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: input.viewportWidth,
      height: input.viewportHeight,
      deviceScaleFactor: input.scale,
    });

    await page.setContent(input.html, {
      waitUntil: input.waitUntil,
    });

    if (input.output === "pdf") {
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
      });
      return {
        contentType: "application/pdf",
        filename: input.outFilename,
        body: Buffer.from(pdf),
      };
    }

    const image = await page.screenshot(
      input.output === "jpeg"
        ? { type: "jpeg", fullPage: input.fullPage, quality: 100 }
        : { type: "png", fullPage: input.fullPage },
    );

    return {
      contentType: input.output === "png" ? "image/png" : "image/jpeg",
      filename: input.outFilename,
      body: Buffer.from(image),
    };
  } finally {
    await browser.close();
  }
}
