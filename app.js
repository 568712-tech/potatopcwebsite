(() => {
  const supabaseConfig = window.POTATO_CHARGER_SUPABASE || {};
  const hasSupabase = Boolean(window.supabase && supabaseConfig.url && supabaseConfig.anonKey);
  const supabaseClient = hasSupabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      })
    : null;

  const state = {
    categories: [],
    filters: {
      category: 'all',
      query: '',
      sort: 'recent',
    },
    loading: false,
    postsByThread: new Map(),
    profile: null,
    selectedThreadId: null,
    session: null,
    threadAuthors: new Map(),
    threads: [],
  };

  const getToast = () => {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = '<i>✓</i><span></span>';
      document.body.appendChild(toast);
    }
    return toast;
  };

  let toastTimer;
  const showToast = (message) => {
    const toast = getToast();
    toast.querySelector('span').textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4200);
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const formatTime = (value) => {
    if (!value) return 'just now';
    const date = new Date(value);
    const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (Number.isNaN(diffMinutes)) return 'just now';
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  };

  const initials = (value) =>
    String(value || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?';

  const profileLabel = (profile) => profile?.display_name || profile?.username || 'Potato player';

  const threadTitle = (thread) => thread?.title || 'Untitled thread';

  const ensureAuthModal = () => {
    let modal = document.querySelector('.auth-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="auth-modal__backdrop" data-auth-close></div>
      <section class="auth-modal__card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <button class="auth-modal__close" type="button" aria-label="Close sign in dialog" data-auth-close>×</button>
        <p class="section-label">JOIN THE FORUM</p>
        <h2 id="auth-modal-title">Sign in with your email.</h2>
        <p class="auth-modal__lede">Supabase will send a magic link to your inbox. After that, your profile appears in the corner and you can post for real.</p>
        <form class="auth-form" novalidate>
          <label class="auth-field">
            <span>Email address</span>
            <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required />
          </label>
          <button class="button button--primary auth-form__submit" type="submit">Send sign-in link <span>→</span></button>
        </form>
        <p class="auth-modal__note">You need to confirm email sign-in in Supabase and allow the site URL in your auth redirect settings.</p>
      </section>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.hidden = true;
      modal.classList.remove('show');
    };

    modal.querySelectorAll('[data-auth-close]').forEach((button) => {
      button.addEventListener('click', close);
    });

    modal.querySelector('.auth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!supabaseClient) {
        showToast('Supabase is not configured yet.');
        return;
      }

      const emailInput = modal.querySelector('input[name="email"]');
      const email = emailInput?.value.trim();
      if (!email) {
        showToast('Enter the email address you want to sign in with.');
        return;
      }

      const submit = modal.querySelector('.auth-form__submit');
      submit?.setAttribute('disabled', 'disabled');

      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });

      submit?.removeAttribute('disabled');
      if (error) {
        showToast(error.message);
        return;
      }

      showToast('Check your inbox for the Supabase sign-in link.');
      close();
    });

    return modal;
  };

  const openAuthModal = () => {
    const modal = ensureAuthModal();
    modal.hidden = false;
    modal.classList.add('show');
    const input = modal.querySelector('input[name="email"]');
    window.requestAnimationFrame(() => input?.focus());
  };

  const ensureHeaderAccount = (header) => {
    if (header.querySelector('.header-account')) return header.querySelector('.header-account');

    const account = document.createElement('div');
    account.className = 'header-account';
    account.innerHTML = `
      <div class="header-account__status js-header-account-status">
        <span class="header-account__avatar">P</span>
        <div>
          <strong>Sign in</strong>
          <small>Supabase auth</small>
        </div>
      </div>
      <div class="header-account__actions">
        <button class="button button--small button--dark js-auth-toggle" type="button">Sign in <span>↗</span></button>
      </div>
    `;

    const button = header.querySelector('.button--small, .back-link');
    if (button?.parentNode === header) {
      header.insertBefore(account, button);
    } else {
      header.appendChild(account);
    }

    account.querySelector('.js-auth-toggle')?.addEventListener('click', () => {
      if (state.session) {
        void signOut();
        return;
      }
      openAuthModal();
    });

    return account;
  };

  const updateHeaderAccount = () => {
    const accounts = document.querySelectorAll('.header-account');
    accounts.forEach((account) => {
      const status = account.querySelector('.js-header-account-status');
      const actions = account.querySelector('.header-account__actions');

      if (!state.session || !state.profile) {
        if (status) {
          status.innerHTML = `
            <span class="header-account__avatar">P</span>
            <div>
              <strong>Sign in</strong>
              <small>Supabase auth</small>
            </div>
          `;
        }
        if (actions) {
          actions.innerHTML = '<button class="button button--small button--dark js-auth-toggle" type="button">Sign in <span>↗</span></button>';
          actions.querySelector('.js-auth-toggle')?.addEventListener('click', openAuthModal);
        }
        return;
      }

      if (status) {
        status.innerHTML = `
          <span class="header-account__avatar">${escapeHtml(initials(profileLabel(state.profile)))}</span>
          <div>
            <strong>${escapeHtml(profileLabel(state.profile))}</strong>
            <small>@${escapeHtml(state.profile.username || 'player')}</small>
          </div>
        `;
      }
      if (actions) {
        actions.innerHTML = '<button class="button button--small button--dark js-auth-toggle" type="button">Sign out <span>↗</span></button>';
        actions.querySelector('.js-auth-toggle')?.addEventListener('click', () => {
          void signOut();
        });
      }
    });
  };

  const signOut = async () => {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      showToast(error.message);
      return;
    }
    state.session = null;
    state.profile = null;
    updateHeaderAccount();
    refreshForumUI();
    showToast('Signed out.');
  };

  const getProfile = (id) => state.threadAuthors.get(id) || state.profile || null;

  const ensurePageHeaderControls = () => {
    document.querySelectorAll('.site-header').forEach((header) => {
      ensureHeaderAccount(header);
    });
  };

  const fetchProfiles = async (ids) => {
    if (!supabaseClient || !ids.length) return new Map();
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', ids);

    if (error) throw error;

    return new Map((data || []).map((profile) => [profile.id, profile]));
  };

  const loadCurrentProfile = async () => {
    if (!supabaseClient || !state.session?.user) {
      state.profile = null;
      updateHeaderAccount();
      return;
    }

    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, bio, avatar_url')
      .eq('id', state.session.user.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      showToast('Could not load your profile yet.');
      return;
    }

    state.profile = data || {
      id: state.session.user.id,
      username: state.session.user.email?.split('@')[0] || 'player',
      display_name: state.session.user.user_metadata?.full_name || state.session.user.email?.split('@')[0] || 'Potato player',
      bio: '',
      avatar_url: null,
    };
    updateHeaderAccount();
  };

  const loadPosts = async (threadId) => {
    if (!threadId || !supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from('forum_posts')
      .select('id, thread_id, author_id, body, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      return [];
    }

    const ids = [...new Set((data || []).map((post) => post.author_id).filter(Boolean))];
    const profiles = await fetchProfiles(ids);
    return (data || []).map((post) => ({ ...post, profile: profiles.get(post.author_id) }));
  };

  const renderReplyCard = (post) => {
    const author = post.profile || getProfile(post.author_id);
    return `
      <article class="reply-card">
        <div class="reply-card__avatar">${escapeHtml(initials(profileLabel(author)))}</div>
        <div class="reply-card__content">
          <div class="reply-card__meta">
            <strong>${escapeHtml(profileLabel(author))}</strong>
            <span>${escapeHtml(formatTime(post.created_at))}</span>
          </div>
          <p>${escapeHtml(post.body)}</p>
        </div>
      </article>
    `;
  };

  const getCategoryById = (categoryId) => state.categories.find((category) => String(category.id) === String(categoryId));

  const getFilteredThreads = () => {
    const query = state.filters.query.trim().toLowerCase();
    const threads = [...state.threads].filter((thread) => {
      const category = getCategoryById(thread.category_id);
      const matchesCategory = state.filters.category === 'all' || category?.slug === state.filters.category;
      const haystack = `${thread.title} ${thread.body} ${category?.name || ''}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesCategory && matchesSearch;
    });

    threads.sort((a, b) => {
      if (state.filters.sort === 'replies') return Number(b.reply_count || 0) - Number(a.reply_count || 0);
      if (state.filters.sort === 'title') return threadTitle(a).localeCompare(threadTitle(b));
      return new Date(b.last_activity_at || b.created_at || 0) - new Date(a.last_activity_at || a.created_at || 0);
    });

    return threads;
  };

  const renderTopicCard = (thread) => {
    const category = getCategoryById(thread.category_id);
    const author = getProfile(thread.author_id);
    const preview = thread.body.length > 140 ? `${thread.body.slice(0, 137).trimEnd()}...` : thread.body;
    const isActive = state.selectedThreadId === thread.id;

    return `
      <article class="topic topic--live${isActive ? ' is-active' : ''}" data-thread-id="${escapeHtml(thread.id)}">
        <div class="topic-avatar" style="background:${escapeHtml(category?.accent || '#c7f25e')}">${escapeHtml(initials(profileLabel(author)))}</div>
        <div class="topic-main">
          <button class="topic-title js-open-thread" type="button">${escapeHtml(threadTitle(thread))}${thread.reply_count ? ` <span class="topic-tag">${escapeHtml(thread.reply_count)} replies</span>` : ''}</button>
          <div class="topic-meta">${escapeHtml(category?.name || 'General')} · ${escapeHtml(profileLabel(author))} · ${escapeHtml(formatTime(thread.last_activity_at || thread.created_at))}</div>
          <p class="topic-body">${escapeHtml(preview)}</p>
        </div>
        <div class="topic-last"><b>${escapeHtml((thread.reply_count || 0).toString())}</b>replies</div>
      </article>
    `;
  };

  const renderThreadPane = async () => {
    const pane = document.querySelector('.js-thread-pane');
    if (!pane) return;

    const thread = state.threads.find((item) => item.id === state.selectedThreadId) || state.threads[0];
    if (!thread) {
      pane.innerHTML = `
        <div class="thread-empty">
          <h3>No threads yet.</h3>
          <p>Use the composer to start the first real discussion. Nothing fake is seeded here.</p>
        </div>
      `;
      return;
    }

    const category = getCategoryById(thread.category_id);
    const author = getProfile(thread.author_id);
    const posts = await loadPosts(thread.id);

    pane.innerHTML = `
      <section class="thread-detail">
        <div class="thread-detail__header">
          <span class="thread-detail__category" style="--accent:${escapeHtml(category?.accent || '#f16632')}">${escapeHtml(category?.name || 'General')}</span>
          <div class="thread-detail__meta">${escapeHtml(profileLabel(author))} · ${escapeHtml(formatTime(thread.last_activity_at || thread.created_at))}</div>
        </div>
        <h3>${escapeHtml(threadTitle(thread))}</h3>
        <p class="thread-detail__body">${escapeHtml(thread.body)}</p>
        <div class="thread-detail__stats">
          <span>${escapeHtml((thread.reply_count || 0).toString())} replies</span>
          <span>Thread updated ${escapeHtml(formatTime(thread.last_activity_at || thread.created_at))}</span>
        </div>
      </section>
      <section class="reply-list">
        <div class="reply-list__head">
          <h4>Replies</h4>
          <span>${escapeHtml(posts.length.toString())} post${posts.length === 1 ? '' : 's'}</span>
        </div>
        ${posts.length ? posts.map((post) => renderReplyCard(post)).join('') : '<div class="thread-empty thread-empty--compact">No replies yet.</div>'}
      </section>
      <section class="reply-composer">
        <h4>Reply to this thread</h4>
        ${state.session ? `
          <form class="reply-form js-reply-form">
            <textarea name="body" rows="5" maxlength="10000" placeholder="Share a fix, a test result, or the one detail everyone needs to know." required></textarea>
            <button class="button button--lime" type="submit">Post reply <span>→</span></button>
          </form>
        ` : '<p>Sign in to post replies.</p>'}
      </section>
    `;

    pane.querySelector('.js-reply-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.session) {
        openAuthModal();
        return;
      }

      const form = event.currentTarget;
      const body = form.querySelector('textarea[name="body"]')?.value.trim();
      if (!body) {
        showToast('Write a reply first.');
        return;
      }

      const submit = form.querySelector('button[type="submit"]');
      submit?.setAttribute('disabled', 'disabled');
      const { error } = await supabaseClient.from('forum_posts').insert({
        author_id: state.session.user.id,
        body,
        thread_id: thread.id,
      });
      submit?.removeAttribute('disabled');

      if (error) {
        showToast(error.message);
        return;
      }

      showToast('Reply posted.');
      await loadForumState();
      state.selectedThreadId = thread.id;
      await refreshForumUI();
    });
  };

  const renderForumSidebar = () => {
    const categoryButtons = [...document.querySelectorAll('.js-category')];
    categoryButtons.forEach((button) => {
      const slug = button.dataset.category || 'all';
      button.classList.toggle('active', slug === state.filters.category);
      const category = slug === 'all' ? null : state.categories.find((item) => item.slug === slug);
      if (category) {
        const count = state.threads.filter((thread) => String(thread.category_id) === String(category.id)).length;
        const small = button.querySelector('small');
        if (small) small.textContent = String(count);
      } else if (slug === 'all') {
        const small = button.querySelector('small');
        if (small) small.textContent = String(state.threads.length);
      }
    });
  };

  const renderForumList = () => {
    const topicList = document.querySelector('.js-topic-list');
    const heading = document.querySelector('.js-topic-heading');
    const count = document.querySelector('.js-topic-count');
    const emptyState = document.querySelector('.js-empty-topics');
    if (!topicList) return;

    const filtered = getFilteredThreads();
    topicList.innerHTML = filtered.map(renderTopicCard).join('');
    if (emptyState) {
      emptyState.hidden = filtered.length > 0;
      emptyState.textContent = filtered.length > 0 ? '' : 'No threads match that filter yet. Try a different category or search term.';
    }
    if (heading) {
      const label = state.categories.find((category) => category.slug === state.filters.category)?.name;
      heading.textContent = state.filters.category === 'all' ? 'Latest discussions' : label || 'Latest discussions';
    }
    if (count) {
      count.textContent = `${filtered.length} conversation${filtered.length === 1 ? '' : 's'}`;
    }

    topicList.querySelectorAll('.js-open-thread').forEach((button) => {
      button.addEventListener('click', () => {
        const threadId = button.closest('.topic')?.dataset.threadId;
        if (!threadId) return;
        state.selectedThreadId = threadId;
        refreshForumUI();
      });
    });
  };

  const loadForumState = async () => {
    if (!supabaseClient) return;

    state.loading = true;
    refreshForumUI();

    const [{ data: categories, error: categoryError }, { data: threads, error: threadError }] = await Promise.all([
      supabaseClient.from('forum_categories').select('id, slug, name, description, accent, position').order('position', { ascending: true }),
      supabaseClient
        .from('forum_threads')
        .select('id, category_id, author_id, title, body, reply_count, last_activity_at, created_at')
        .order('last_activity_at', { ascending: false })
        .limit(120),
    ]);

    if (categoryError) throw categoryError;
    if (threadError) throw threadError;

    state.categories = categories || [];
    state.threads = threads || [];
    state.threadAuthors = await fetchProfiles([...new Set(state.threads.map((thread) => thread.author_id).filter(Boolean))]);

    if (!state.selectedThreadId && state.threads.length) {
      state.selectedThreadId = state.threads[0].id;
    }
    if (state.selectedThreadId && !state.threads.some((thread) => thread.id === state.selectedThreadId)) {
      state.selectedThreadId = state.threads[0]?.id || null;
    }

    state.loading = false;
    refreshForumUI();
  };

  const ensureForumComposer = () => {
    const forumContent = document.querySelector('.forum-content');
    if (!forumContent || forumContent.querySelector('.forum-composer')) return;

    const composer = document.createElement('section');
    composer.className = 'forum-composer';
    composer.innerHTML = `
      <div class="forum-composer__head">
        <div>
          <p class="section-label">START A THREAD</p>
          <h3>Post something useful.</h3>
        </div>
        <button class="button button--small button--dark js-composer-toggle" type="button">${state.session ? 'Close' : 'Sign in to post'} <span>↗</span></button>
      </div>
      <form class="forum-composer__form js-thread-form" ${state.session ? '' : 'hidden'}>
        <label>
          <span>Category</span>
          <select name="category" required>
            ${state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Title</span>
          <input name="title" maxlength="140" minlength="5" placeholder="What did you fix, test, or discover?" required />
        </label>
        <label>
          <span>Body</span>
          <textarea name="body" rows="6" maxlength="10000" minlength="1" placeholder="Give people enough detail to reproduce the fix." required></textarea>
        </label>
        <button class="button button--lime" type="submit">Publish thread <span>→</span></button>
      </form>
      <p class="forum-composer__note">No fake topics are seeded here. New posts only appear after a real Supabase insert.</p>
    `;

    forumContent.prepend(composer);

    composer.querySelector('.js-composer-toggle')?.addEventListener('click', () => {
      if (!state.session) {
        openAuthModal();
        return;
      }
      const form = composer.querySelector('.js-thread-form');
      if (form) {
        form.hidden = !form.hidden;
        composer.querySelector('.js-composer-toggle').innerHTML = `${form.hidden ? 'Open' : 'Close'} <span>↗</span>`;
      }
    });

    composer.querySelector('.js-thread-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.session) {
        openAuthModal();
        return;
      }

      const form = event.currentTarget;
      const categoryId = form.category?.value;
      const title = form.title?.value.trim();
      const body = form.body?.value.trim();
      if (!categoryId || !title || !body) {
        showToast('Fill out the thread before posting.');
        return;
      }

      const submit = form.querySelector('button[type="submit"]');
      submit?.setAttribute('disabled', 'disabled');
      const { data, error } = await supabaseClient.from('forum_threads').insert({
        author_id: state.session.user.id,
        body,
        category_id: categoryId,
        title,
      }).select('id').single();
      submit?.removeAttribute('disabled');

      if (error) {
        showToast(error.message);
        return;
      }

      showToast('Thread published.');
      form.reset();
      state.selectedThreadId = data?.id || null;
      await loadForumState();
      refreshForumUI();
    });
  };

  const ensureForumThreadPane = () => {
    const forumContent = document.querySelector('.forum-content');
    if (!forumContent || forumContent.querySelector('.js-thread-pane')) return;

    const threadPane = document.createElement('section');
    threadPane.className = 'thread-pane js-thread-pane';
    forumContent.appendChild(threadPane);
  };

  const refreshForumUI = async () => {
    updateHeaderAccount();
    renderForumSidebar();
    renderForumList();
    ensureForumThreadPane();
    ensureForumComposer();
    await renderThreadPane();
  };

  const hydrateForumPage = () => {
    const topicList = document.querySelector('.js-topic-list');
    if (!topicList) return;

    const search = document.querySelector('.js-topic-search');
    const sort = document.querySelector('.js-topic-sort');
    const categoryButtons = [...document.querySelectorAll('.js-category')];

    search?.addEventListener('input', () => {
      state.filters.query = search.value;
      renderForumList();
    });

    sort?.addEventListener('change', () => {
      state.filters.sort = sort.value;
      renderForumList();
    });

    categoryButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.filters.category = button.dataset.category || 'all';
        categoryButtons.forEach((item) => item.classList.toggle('active', item === button));
        renderForumList();
      });
    });

    document.querySelectorAll('.js-new-post').forEach((button) => {
      button.addEventListener('click', () => {
        const composer = document.querySelector('.forum-composer');
        if (!composer) return;
        const form = composer.querySelector('.js-thread-form');
        if (!state.session) {
          openAuthModal();
          return;
        }
        if (form?.hidden) {
          form.hidden = false;
          composer.querySelector('.js-composer-toggle').innerHTML = 'Close <span>↗</span>';
        }
        form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    loadForumState().catch((error) => {
      console.error(error);
      showToast('Could not load the forum from Supabase.');
    });
  };

  const hydratePreviewCards = async () => {
    const previewFeeds = document.querySelectorAll('.community-feed');
    if (!previewFeeds.length || !supabaseClient) return;

    const { data: categories, error: categoryError } = await supabaseClient
      .from('forum_categories')
      .select('id, slug, name, accent')
      .order('position', { ascending: true });
    if (categoryError) {
      console.error(categoryError);
      return;
    }

    const { data: threads, error: threadError } = await supabaseClient
      .from('forum_threads')
      .select('id, category_id, author_id, title, body, reply_count, last_activity_at, created_at')
      .order('last_activity_at', { ascending: false })
      .limit(3);
    if (threadError) {
      console.error(threadError);
      return;
    }

    const authorProfiles = await fetchProfiles([...new Set((threads || []).map((thread) => thread.author_id).filter(Boolean))]);
    const threadList = threads || [];

    previewFeeds.forEach((feed) => {
      feed.innerHTML = `
        <div class="forum-head"><span><i></i> community forum</span><span class="online-dot">${escapeHtml((state.threads.length || threadList.length || 0).toString())} live threads</span></div>
        ${threadList.length
          ? threadList.map((thread) => {
              const category = categories?.find((item) => String(item.id) === String(thread.category_id));
              const author = authorProfiles.get(thread.author_id);
              return `
                <article class="forum-preview forum-preview--live">
                  <div class="forum-avatar" style="background:${escapeHtml(category?.accent || '#c7f25e')}">${escapeHtml(initials(profileLabel(author)))}</div>
                  <div>
                    <p><b>${escapeHtml(threadTitle(thread))}</b></p>
                    <small>${escapeHtml(category?.name || 'General')} · by ${escapeHtml(profileLabel(author))} · ${escapeHtml(thread.reply_count || 0)} replies · ${escapeHtml(formatTime(thread.last_activity_at || thread.created_at))}</small>
                  </div>
                  <span class="reply-count">${escapeHtml((thread.reply_count || 0).toString())}</span>
                </article>
              `;
            }).join('')
          : '<div class="forum-preview forum-preview--empty"><div><p><b>No forum threads yet.</b></p><small>Sign in and post the first real topic.</small></div></div>'}
        <a href="community.html" class="forum-more">Join the conversation <span>→</span></a>
      `;
    });
  };

  const hydrateDownloadButton = () => {
    document.querySelectorAll('.js-download').forEach((button) => {
      button.addEventListener('click', () => {
        showToast('Your official installer link can be connected to this button when the Windows release is ready.');
      });
    });
  };

  const hydrateDemoCheck = () => {
    const demoCheck = document.querySelector('.js-demo-check');
    if (!demoCheck) return;

    demoCheck.addEventListener('click', () => {
      const panel = demoCheck.closest('.game-check-panel');
      panel?.classList.add('show-result');
      demoCheck.innerHTML = 'Comparison complete <span>✓</span>';
      demoCheck.disabled = true;
    });
  };

  const hydratePreviewLoadButtons = () => {
    document.querySelectorAll('.js-load-topics').forEach((button) => {
      button.addEventListener('click', () => {
        showToast('The preview is now powered by live Supabase content.');
        button.textContent = 'Live preview connected ✓';
        button.disabled = true;
      });
    });
  };

  const hydrateAuth = async () => {
    ensurePageHeaderControls();
    ensureAuthModal();

    if (!supabaseClient) {
      updateHeaderAccount();
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    state.session = data.session || null;
    await loadCurrentProfile();
    updateHeaderAccount();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      await loadCurrentProfile();
      updateHeaderAccount();
      if (document.querySelector('.js-topic-list')) {
        await loadForumState();
      }
      await hydratePreviewCards();
      refreshForumUI();
    });
  };

  hydrateDownloadButton();
  hydrateDemoCheck();
  hydratePreviewLoadButtons();
  void hydrateAuth();
  if (document.querySelector('.js-topic-list')) {
    hydrateForumPage();
  } else {
    void hydratePreviewCards();
  }
})();
