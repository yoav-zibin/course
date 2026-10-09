// Uses the shared course accounts and existing /games API. Builder metadata lives
// in a comment in the runnable HTML package, preserving the public game schema.
window.GameBuilderCloud = (() => {
  let settings = null;
  const ids = new Map();
  const session = () => {
    const user = Auth.current();
    return user ? { id: user.id, name: user.display_name } : null;
  };
  const account = () => {
    const user = Auth.current();
    if (!user) throw new Error('Log in to the course platform first.');
    return user;
  };
  const key = (user, id) => user.id + ':' + id;
  function fromGame(game) {
    const doc = CoursePackage.unpack(game.code);
    if (!doc) return null;
    return { ...doc, id: doc.localId, title: game.name, description: game.description,
      allowedPlayers: game.allowed_player_counts, updatedAt: Date.parse(game.updated_at) };
  }
  return {
    backend: 'course',
    configure(value) { settings = value; },
    configured() { return !!settings; },
    session: async () => session(),
    onSession(listener) {
      const changed = () => { settings = null; listener(session()); };
      document.addEventListener('auth-changed', changed);
      return () => document.removeEventListener('auth-changed', changed);
    },
    async list() {
      const user = account();
      const games = await apiRequest('GET', '/games?owner_user_id=' + encodeURIComponent(user.id));
      return games.flatMap(game => {
        const doc = fromGame(game);
        if (!doc) return [];
        ids.set(key(user, doc.id), game.id);
        return [doc];
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async save(id, document) {
      const user = account();
      const counts = document.allowedPlayers;
      if (!Array.isArray(counts) || !counts.length ||
          counts.some(n => !Number.isInteger(n) || n < 2 || n > 10)) {
        throw new Error('The course portal supports 2 to 10 players.');
      }
      // Resolve logical ids from server data as well as this tab's cache.
      if (!ids.has(key(user, id))) {
        const games = await apiRequest('GET', '/games?owner_user_id=' + encodeURIComponent(user.id));
        const existing = games.find(game => CoursePackage.unpack(game.code)?.localId === id);
        if (existing) ids.set(key(user, id), existing.id);
      }
      const body = { name: document.title, description: document.description || '',
        allowed_player_counts: counts, allows_leave_mid_match: false,
        allows_join_mid_match: false,
        code: CoursePackage.pack({ ...document, localId: id }) };
      const backendId = ids.get(key(user, id));
      const game = await apiRequest(backendId ? 'PATCH' : 'POST',
        backendId ? '/games/' + encodeURIComponent(backendId) : '/games', { body, user });
      ids.set(key(user, id), game.id);
      return { saved: true, gameId: game.id, version: game.version };
    },
    async remove(id) {
      const user = account();
      if (!ids.has(key(user, id))) await this.list();
      const backendId = ids.get(key(user, id));
      if (!backendId) throw new Error('Refresh your games before deleting this game.');
      await apiRequest('DELETE', '/games/' + encodeURIComponent(backendId), { user });
      ids.delete(key(user, id));
    },
    async sample(prompt, options = {}) {
      account();
      if (!settings) throw new Error('Enter your OpenAI API key in AI settings first.');
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
        body: JSON.stringify({ model: settings.model, input: prompt, max_output_tokens: 14000, store: false }),
        signal: options.signal
      });
      if (!response.ok) throw new Error(response.status === 429
        ? 'OpenAI billing quota or rate limit reached. Check billing and retry.'
        : 'OpenAI rejected the request. Check your API key and model ID.');
      const reply = await response.json();
      const text = (reply.output || []).flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('\n');
      if (!text) throw new Error('OpenAI returned no game code. Try again.');
      options.onText?.({ text });
      return { text, truncated: reply.status === 'incomplete' };
    }
  };
})();
