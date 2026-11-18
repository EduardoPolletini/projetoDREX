// Seleciona o transporte estático no subcaminho do projeto no GitHub Pages.
export const isPages = new URL('.', import.meta.url).pathname !== '/';

export async function api(path, method = 'GET', data) {
  if (isPages) {
    const { simulate } = await import('./pages-api.js');
    return simulate(path, method, data);
  }

  // Envia JSON e o JWT à API Node.js na execução local.
  const response = await fetch('/api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + (sessionStorage.getItem('drexToken') ?? ''),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}
