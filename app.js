(() => {
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

  document.querySelectorAll('.js-download').forEach((button) => {
    button.addEventListener('click', () => {
      showToast('Your official installer link can be connected to this button when the Windows release is ready.');
    });
  });

  const demoCheck = document.querySelector('.js-demo-check');
  if (demoCheck) {
    demoCheck.addEventListener('click', () => {
      const panel = demoCheck.closest('.game-check-panel');
      panel?.classList.add('show-result');
      demoCheck.innerHTML = 'Comparison complete <span>✓</span>';
      demoCheck.disabled = true;
    });
  }

  const topicList = document.querySelector('.js-topic-list');
  if (topicList) {
    const search = document.querySelector('.js-topic-search');
    const sort = document.querySelector('.js-topic-sort');
    const heading = document.querySelector('.js-topic-heading');
    const count = document.querySelector('.js-topic-count');
    const emptyState = document.querySelector('.js-empty-topics');
    const categoryButtons = [...document.querySelectorAll('.js-category')];
    const labels = {
      all: 'Latest discussions',
      builds: 'Getting Started & PC Builds',
      games: 'Game Optimizations',
      configs: 'Configs, Patches & Fixes',
      upgrades: 'Budget Hardware Upgrades',
      efficiency: 'Lighter Apps & Windows Efficiency',
    };
    let activeCategory = 'all';

    const topics = () => [...topicList.querySelectorAll('.topic')];
    const applyFilters = () => {
      const query = (search?.value || '').trim().toLowerCase();
      let visible = 0;
      topics().forEach((topic) => {
        const matchesCategory = activeCategory === 'all' || topic.dataset.category === activeCategory;
        const matchesSearch = !query || topic.dataset.title.includes(query) || topic.textContent.toLowerCase().includes(query);
        const show = matchesCategory && matchesSearch;
        topic.hidden = !show;
        if (show) visible += 1;
      });
      if (heading) heading.textContent = labels[activeCategory];
      if (count) count.textContent = `${visible} conversation${visible === 1 ? '' : 's'}`;
      if (emptyState) emptyState.style.display = visible ? 'none' : 'block';
    };

    const applySort = () => {
      const items = topics();
      const mode = sort?.value || 'recent';
      items.sort((a, b) => {
        if (mode === 'replies') return Number(b.dataset.replies) - Number(a.dataset.replies);
        if (mode === 'title') return a.dataset.title.localeCompare(b.dataset.title);
        return Number(b.dataset.order) - Number(a.dataset.order);
      });
      items.forEach((topic) => topicList.insertBefore(topic, emptyState));
    };

    categoryButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activeCategory = button.dataset.category;
        categoryButtons.forEach((item) => item.classList.toggle('active', item === button));
        applyFilters();
      });
    });
    search?.addEventListener('input', applyFilters);
    sort?.addEventListener('change', () => {
      applySort();
      applyFilters();
    });
    applyFilters();
  }

  document.querySelectorAll('.js-new-post').forEach((button) => {
    button.addEventListener('click', () => {
      showToast('Post creation is ready to connect to your sign-in and community backend.');
    });
  });

  document.querySelectorAll('.js-load-topics').forEach((button) => {
    button.addEventListener('click', () => {
      showToast('You’re all caught up in this forum preview.');
      button.textContent = 'You’re all caught up ✓';
      button.disabled = true;
    });
  });
})();
