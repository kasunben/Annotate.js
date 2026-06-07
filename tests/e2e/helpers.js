// ESM module — imported directly by Playwright spec files via static import.

// Pre-sets localStorage before the IIFE runs, preventing the display-name
// prompt dialog and fixing the authorId for ownership assertions.
export async function initUser(page, name = 'E2E Tester', authorId = 'e2e-author-00000000') {
  await page.addInitScript(({ n, id }) => {
    localStorage.setItem('annotate_display_name', n);
    localStorage.setItem('annotate_author_id', id);
  }, { n: name, id: authorId });
}

// Finds the first occurrence of `text` inside `paragraphSelector`, creates a
// Range over it, and dispatches mouseup so annotate.js shows the comment button.
export async function selectText(page, paragraphSelector, text) {
  await page.evaluate(({ sel, txt }) => {
    const para = document.querySelector(sel);
    if (!para) throw new Error('Paragraph not found: ' + sel);
    const full = para.textContent;
    const idx  = full.indexOf(txt);
    if (idx === -1) throw new Error('Text not found in paragraph: ' + txt);

    let offset = 0;
    for (const node of para.childNodes) {
      if (node.nodeType !== 3) continue;
      if (offset + node.length > idx) {
        const range = document.createRange();
        range.setStart(node, idx - offset);
        range.setEnd(node, idx - offset + txt.length);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        break;
      }
      offset += node.length;
    }
    para.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { sel: paragraphSelector, txt: text });
}

// Triggers an immediate server pull by dispatching a visibilitychange event.
// annotate.js calls pullThreads() + pullActivity() on tab-focus (visibilitychange
// with document.hidden === false).
export async function triggerPull(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
