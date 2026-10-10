export interface Health {
  status: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const getHealth = () => getJson<Health>("/health");
