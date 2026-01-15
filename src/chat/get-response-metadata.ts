export function getResponseMetadata(response: {
  id?: string;
  model?: string;
  created?: number;
}) {
  return {
    id: response.id,
    modelId: response.model,
    timestamp:
      response.created != null ? new Date(response.created * 1000) : undefined,
  };
}
