export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Qlarety web scraper",
    version: "1.0.0",
    description:
      "Local service that finds a requested page on a website and returns normalized content for legal-document analysis.",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Health" }, { name: "Website" }, { name: "Render" }],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        operationId: "health",
        responses: {
          "200": {
            description: "The process is running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", example: "ok" } },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
    },
    "/api/website/page": {
      post: {
        tags: ["Website"],
        summary: "Find a website page",
        operationId: "findWebsitePage",
        description:
          "Given a website URL and a page request, locate the most relevant page and return its content. URL validation, page classification, and candidate URL generation are active. Fetching and verification land in later steps.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WebsitePageRequest" },
              examples: {
                privacy: {
                  value: {
                    websiteUrl: "https://example.com",
                    pageRequest: "privacy policy",
                  },
                },
                terms: {
                  value: {
                    websiteUrl: "https://example.com",
                    pageRequest: "terms and conditions",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "A matching page was found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebsitePageSuccess" },
              },
            },
          },
          "400": {
            description: "The body or URL is invalid",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebsitePageFailure" },
              },
            },
          },
          "404": {
            description:
              "No matching page was found (`PAGE_NOT_FOUND`) or extracted pages were not relevant (`PAGE_NOT_RELEVANT`)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebsitePageFailure" },
                example: {
                  success: false,
                  error: {
                    code: "PAGE_NOT_FOUND",
                    message: "Could not find a page matching the requested content.",
                  },
                },
              },
            },
          },
          "502": {
            description:
              "The website, extraction, or LLM verification step failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebsitePageFailure" },
              },
            },
          },
        },
      },
    },
    "/api/pdf/render": {
      post: {
        tags: ["Render"],
        summary: "Render HTML as a PDF or image",
        operationId: "renderHtml",
        description:
          "Renders the provided HTML in Chrome and returns a PDF, PNG, or JPEG file.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HtmlRenderRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Rendered file",
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
            },
          },
          "400": {
            description: "The body is invalid",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HtmlRenderError" },
              },
            },
          },
          "500": {
            description: "Chrome failed to render the HTML",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HtmlRenderError" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      WebsitePageRequest: {
        type: "object",
        required: ["websiteUrl", "pageRequest"],
        properties: {
          websiteUrl: {
            type: "string",
            format: "uri",
            maxLength: 2048,
            example: "https://example.com",
          },
          pageRequest: {
            type: "string",
            maxLength: 500,
            example: "privacy policy",
            description: "Description of the page to find",
          },
        },
      },
      WebsitePageSuccess: {
        type: "object",
        required: ["success", "page"],
        properties: {
          success: { type: "boolean", enum: [true] },
          page: {
            type: "object",
            required: ["title", "url", "type", "content", "confidence"],
            properties: {
              title: { type: "string", example: "Privacy Policy" },
              url: {
                type: "string",
                example: "https://example.com/privacy-policy",
              },
              type: {
                type: "string",
                example: "privacy_policy",
              },
              content: { type: "string" },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                example: 0.97,
              },
            },
          },
        },
      },
      HtmlRenderRequest: {
        type: "object",
        required: ["html"],
        properties: {
          html: { type: "string" },
          output: { type: "string", enum: ["pdf", "png", "jpeg", "jpg"] },
          filename: { type: "string" },
          waitUntil: {
            type: "string",
            enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
          },
          viewportWidth: { type: "number" },
          viewportHeight: { type: "number" },
          fullPage: { type: "boolean" },
          scale: { type: "number" },
        },
      },
      HtmlRenderError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
      WebsitePageFailure: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: { type: "boolean", enum: [false] },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                example: "PAGE_NOT_FOUND",
              },
              message: {
                type: "string",
                example: "Could not find a page matching the requested content.",
              },
            },
          },
        },
      },
    },
  },
};
