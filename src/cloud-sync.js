/* Cloud tournament sync. The login token stays in localStorage and is sent only to this API. */
(function (root) {
  function endpoint(path) {
    const configured = localStorage.getItem('ranking-auth-api') || '';
    if (!configured) return new URL(path, document.baseURI).href;
    return configured.replace(/\/$/, '') + '/' + path;
  }

  async function request(method, body) {
    const user = root.currentUser?.();
    if (!user?.token) return {ok: false, message: '请先登录。'};
    let response;
    try {
      response = await fetch(endpoint('api/tournament'), {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + user.token
        },
        body: method === 'GET' ? undefined : JSON.stringify(body || {})
      });
    } catch {
      return {ok: false, message: '网络异常，赛事仍保存在本机。'};
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return {ok: false, message: '云端同步暂时不可用。'};
    return data;
  }

  root.RankingCloud = {
    pull() {
      return request('GET');
    },
    push(body) {
      return request('POST', body);
    }
  };
})(typeof window === 'undefined' ? globalThis : window);
