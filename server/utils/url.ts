export const getBaseUrl = (c: { req: { url: string }; env?: { BASE_URL?: string } }) => {
  const configured = c.env?.BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
};
