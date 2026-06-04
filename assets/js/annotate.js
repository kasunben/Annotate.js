(function () {
  console.log('Annotate.js loaded');

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    #annotate-sidebar {
      position: absolute;
      top: 0;
      right: 0;
      width: 320px;
      min-height: 100%;
      background: #fff;
      border-left: 1px solid #e0e0e0;
      box-shadow: -2px 0 8px rgba(0,0,0,0.08);
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      transition: transform 0.25s ease;
    }

    #annotate-sidebar.collapsed {
      transform: translateX(320px);
    }

    #annotate-sidebar-header {
      position: sticky;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
      font-weight: 600;
      color: #1a1a1a;
      background: #fff;
      z-index: 1;
    }

    #annotate-sidebar-body {
      position: relative;
      color: #666;
    }

    #annotate-empty {
      position: absolute;
      top: 16px;
      left: 16px;
      color: #999;
      font-size: 13px;
    }

    .annotate-card {
      position: absolute;
      left: 12px;
      right: 12px;
      border: 1px solid #e8e8e8;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }

    .annotate-card-quote {
      background: #f9f6f0;
      border-left: 3px solid #d4a843;
      padding: 8px 10px;
      font-size: 12px;
      color: #555;
      font-style: italic;
      line-height: 1.5;
    }

    .annotate-card-body {
      padding: 10px;
    }

    .annotate-card-composer {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      resize: none;
      outline: none;
      color: #1a1a1a;
      min-height: 64px;
    }

    .annotate-card-composer:focus {
      border-color: #1a1a1a;
    }

    .annotate-card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }

    .annotate-btn-cancel {
      background: none;
      border: 1px solid #e0e0e0;
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      color: #555;
    }

    .annotate-btn-save {
      background: #1a1a1a;
      border: none;
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      color: #fff;
      font-weight: 600;
    }

    .annotate-btn-save:hover { background: #333; }
    .annotate-btn-cancel:hover { background: #f5f5f5; }

    .annotate-highlight {
      background: #fde68a;
      border-radius: 2px;
    }

    .annotate-note-text {
      font-size: 13px;
      color: #1a1a1a;
      line-height: 1.5;
      margin: 0;
    }

    .annotate-replies {
      border-top: 1px solid #f0f0f0;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .annotate-reply {
      padding: 8px 10px;
      border-top: 1px solid #f0f0f0;
      font-size: 13px;
      color: #1a1a1a;
      line-height: 1.5;
    }

    .annotate-reply:first-child {
      border-top: none;
    }

    .annotate-reply-action {
      padding: 6px 10px;
      border-top: 1px solid #f0f0f0;
    }

    .annotate-reply-link {
      background: none;
      border: none;
      font-size: 12px;
      color: #888;
      cursor: pointer;
      padding: 0;
      text-decoration: underline;
    }

    .annotate-reply-link:hover {
      color: #1a1a1a;
    }

    .annotate-reply-composer {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      resize: none;
      outline: none;
      color: #1a1a1a;
      min-height: 52px;
      margin-bottom: 6px;
    }

    .annotate-reply-composer:focus {
      border-color: #1a1a1a;
    }

    #annotate-toggle {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 6px 0 0 6px;
      padding: 10px 6px;
      cursor: pointer;
      z-index: 10000;
      writing-mode: vertical-rl;
      letter-spacing: 0.05em;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 11px;
      font-weight: 600;
      transition: right 0.25s ease;
    }

    #annotate-toggle.sidebar-open {
      right: 320px;
    }

    #annotate-comment-btn {
      position: fixed;
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 4px;
      cursor: pointer;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    #annotate-comment-btn.hidden {
      display: none;
    }

    #annotate-comment-btn:hover {
      background: #333;
    }
  `;
  document.head.appendChild(style);

  // Attach sidebar to <html> so it's not affected by body margins/padding
  document.documentElement.style.position = 'relative';

  // --- Sidebar ---
  const sidebar = document.createElement('div');
  sidebar.id = 'annotate-sidebar';
  sidebar.innerHTML = `
    <div id="annotate-sidebar-header">
      <span>Annotations</span>
      <button id="annotate-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#666;">&times;</button>
    </div>
    <div id="annotate-sidebar-body">
      <span id="annotate-empty">No annotations yet.</span>
    </div>
  `;
  document.documentElement.appendChild(sidebar);

  const sidebarBody = document.getElementById('annotate-sidebar-body');
  const emptyMsg = document.getElementById('annotate-empty');

  // --- Toggle button ---
  const toggle = document.createElement('button');
  toggle.id = 'annotate-toggle';
  toggle.textContent = 'Annotations';
  document.documentElement.appendChild(toggle);

  // --- Open/close logic ---
  function openSidebar() {
    sidebar.classList.remove('collapsed');
    toggle.classList.add('sidebar-open');
  }

  function closeSidebar() {
    sidebar.classList.add('collapsed');
    toggle.classList.remove('sidebar-open');
  }

  toggle.addEventListener('click', function () {
    sidebar.classList.contains('collapsed') ? openSidebar() : closeSidebar();
  });

  document.getElementById('annotate-close').addEventListener('click', closeSidebar);

  // Start collapsed
  closeSidebar();

  // --- Add annotation card to sidebar ---
  function highlightRange(range) {
    try {
      const mark = document.createElement('mark');
      mark.className = 'annotate-highlight';
      range.surroundContents(mark);
      return mark;
    } catch (e) {
      console.warn('Annotate.js: could not highlight range', e);
      return null;
    }
  }

  function addAnnotationCard(selectedText, range) {
    if (emptyMsg) emptyMsg.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'annotate-card';
    card.innerHTML = `
      <div class="annotate-card-quote">${selectedText}</div>
      <div class="annotate-card-body">
        <textarea class="annotate-card-composer" placeholder="Add a note…"></textarea>
        <div class="annotate-card-actions">
          <button class="annotate-btn-cancel">Cancel</button>
          <button class="annotate-btn-save">Save</button>
        </div>
      </div>
    `;

    // Position card at the same vertical offset as the selection in the document.
    // Cards are inside #annotate-sidebar-body which starts below the sticky header,
    // so subtract the header height to keep card aligned with the highlight.
    const headerHeight = document.getElementById('annotate-sidebar-header').offsetHeight;
    let pendingTop = 8;
    if (range) {
      const rect = range.getBoundingClientRect();
      pendingTop = Math.max(0, rect.top + window.scrollY - headerHeight);
    }
    card.style.top = pendingTop + 'px';

    sidebarBody.appendChild(card);
    sidebarBody.style.minHeight = (pendingTop + 200) + 'px';

    const textarea = card.querySelector('.annotate-card-composer');
    const saveBtn = card.querySelector('.annotate-btn-save');
    const cancelBtn = card.querySelector('.annotate-btn-cancel');

    // Focus the textarea
    setTimeout(() => textarea.focus(), 50);

    saveBtn.addEventListener('click', function () {
      const note = textarea.value.trim();
      if (!note) return;

      // Highlight the annotated text and position card at the same doc offset
      const mark = range ? highlightRange(range) : null;
      if (mark) {
        const markTop = mark.getBoundingClientRect().top + window.scrollY - headerHeight;
        card.style.top = Math.max(0, markTop) + 'px';
        sidebarBody.style.minHeight = (markTop + card.offsetHeight + 16) + 'px';
      }

      // Replace composer with saved note + replies section
      const cardBody = card.querySelector('.annotate-card-body');
      cardBody.innerHTML = `<p class="annotate-note-text">${note}</p>`;

      const replies = document.createElement('div');
      replies.className = 'annotate-replies';

      const replyAction = document.createElement('div');
      replyAction.className = 'annotate-reply-action';
      replyAction.innerHTML = `<button class="annotate-reply-link">Reply</button>`;
      replies.appendChild(replyAction);

      card.appendChild(replies);

      replyAction.querySelector('.annotate-reply-link').addEventListener('click', function () {
        openReplyComposer(replies, replyAction);
      });
    });

    cancelBtn.addEventListener('click', function () {
      card.remove();
      if (!sidebarBody.querySelector('.annotate-card')) {
        emptyMsg.style.display = '';
      }
    });
  }

  function openReplyComposer(replies, replyAction) {
    // Don't open a second composer
    if (replies.querySelector('.annotate-reply-composer')) return;

    const composerWrap = document.createElement('div');
    composerWrap.className = 'annotate-reply-action';
    composerWrap.innerHTML = `
      <textarea class="annotate-reply-composer" placeholder="Reply…"></textarea>
      <div class="annotate-card-actions">
        <button class="annotate-btn-cancel">Cancel</button>
        <button class="annotate-btn-save">Reply</button>
      </div>
    `;

    replies.insertBefore(composerWrap, replyAction);

    const textarea = composerWrap.querySelector('.annotate-reply-composer');
    setTimeout(() => textarea.focus(), 50);

    composerWrap.querySelector('.annotate-btn-save').addEventListener('click', function () {
      const text = textarea.value.trim();
      if (!text) return;

      const replyEl = document.createElement('div');
      replyEl.className = 'annotate-reply';
      replyEl.textContent = text;
      replies.insertBefore(replyEl, composerWrap);

      composerWrap.remove();
    });

    composerWrap.querySelector('.annotate-btn-cancel').addEventListener('click', function () {
      composerWrap.remove();
    });
  }

  // --- Floating annotation button ---
  const commentBtn = document.createElement('button');
  commentBtn.id = 'annotate-comment-btn';
  commentBtn.classList.add('hidden');
  commentBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></svg>';
  document.documentElement.appendChild(commentBtn);

  let lastSelectedText = '';
  let lastSelectedRange = null;

  function hideCommentBtn() {
    commentBtn.classList.add('hidden');
    lastSelectedText = '';
    lastSelectedRange = null;
  }

  document.addEventListener('mouseup', function (e) {
    if (sidebar.contains(e.target) || commentBtn.contains(e.target)) return;

    // If clicking on highlighted text, open the sidebar instead
    if (e.target.closest('.annotate-highlight')) {
      openSidebar();
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    if (!selectedText) return;

    lastSelectedText = selectedText;
    lastSelectedRange = selection.getRangeAt(0).cloneRange();

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const btnSize = 28;
    let x = rect.left + (rect.width / 2) - (btnSize / 2);
    let y = rect.top - btnSize - 6;

    if (x < 8) x = 8;
    if (x + btnSize > window.innerWidth - 8) x = window.innerWidth - btnSize - 8;

    commentBtn.style.left = x + 'px';
    commentBtn.style.top = y + 'px';
    commentBtn.classList.remove('hidden');
  });

  commentBtn.addEventListener('click', function () {
    const text = lastSelectedText;
    const range = lastSelectedRange;
    hideCommentBtn();
    openSidebar();
    addAnnotationCard(text, range);
  });

  document.addEventListener('mousedown', function (e) {
    if (!commentBtn.contains(e.target)) {
      hideCommentBtn();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideCommentBtn();
  });

})();
