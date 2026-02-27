export function getResponseMetadata(response: {
  id?: string | null;
  model?: string | null;
  created?: number | null;
}) {
  return {
    id: response.id ?? undefined,
    modelId: response.model ?? undefined,
    timestamp:
      response.created != null ? new Date(response.created * 1000) : undefined,
  };
}
