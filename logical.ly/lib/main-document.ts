export type MainDocumentRequest = {
  title: string;
  content: string;
  description?: string;
  schema?: string | Record<string, unknown>;
  projectInfo?: Record<string, unknown>;
};

export async function postMainDocument({
  title,
  content,
  description = '',
  schema = '',
  projectInfo = {},
}: MainDocumentRequest) {
  const body = {
    title,
    content,
    description,
    schema,
    project_info: projectInfo,
  };

  const response = await fetch('http://localhost:8000/api/main-document/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? 'Failed to create main document');
  }

  const responseText = await response.text();
  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

