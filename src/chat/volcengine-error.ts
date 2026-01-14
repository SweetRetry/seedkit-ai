import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils";
import { z } from "zod";

const volcengineErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    param: z.string().nullable().optional(),
    code: z.string().nullable().optional()
  })
});

export const volcengineFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: volcengineErrorSchema,
  errorToMessage: (data) => data.error.message
});
