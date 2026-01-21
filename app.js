// spiffler blog - GitHub-backed editor

const REPO_OWNER = 'spiffler33';
const REPO_NAME = 'spiffler-blog';
const DRAFTS_PATH = 'drafts';
const POSTS_PATH = 'posts';

let token = null;
let currentDraft = null;
let drafts = [];
let saveTimeout = null;
let lastSavedContent = '';

// DOM elements
const authScreen = document.getElementById('auth-screen');
const editorScreen = document.getElementById('editor-screen');
const tokenInput = document.getElementById('token-input');
const saveTokenBtn = document.getElementById('save-token');
const disconnectBtn = document.getElementById('disconnect');
const draftsList = document.getElementById('drafts-list');
const newDraftBtn = document.getElementById('new-draft');
const titleInput = document.getElementById('title-input');
const contentInput = document.getElementById('content-input');
const saveStatus = document.getElementById('save-status');
const wordCount = document.getElementById('word-count');
const publishBtn = document.getElementById('publish-btn');
const deleteBtn = document.getElementById('delete-btn');

// Initialize
function init() {
    token = localStorage.getItem('github_token');
    if (token) {
        showEditor();
        loadDrafts();
    } else {
        showAuth();
    }
    setupEventListeners();
}

function setupEventListeners() {
    saveTokenBtn.addEventListener('click', saveToken);
    tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveToken();
    });
    disconnectBtn.addEventListener('click', disconnect);
    newDraftBtn.addEventListener('click', createNewDraft);
    titleInput.addEventListener('input', handleInput);
    contentInput.addEventListener('input', handleInput);
    publishBtn.addEventListener('click', publishDraft);
    deleteBtn.addEventListener('click', deleteDraft);
}

function showAuth() {
    authScreen.classList.remove('hidden');
    editorScreen.classList.add('hidden');
}

function showEditor() {
    authScreen.classList.add('hidden');
    editorScreen.classList.remove('hidden');
}

async function saveToken() {
    const t = tokenInput.value.trim();
    if (!t) return;

    // Test the token
    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${t}` }
        });
        if (!res.ok) throw new Error('Invalid token');

        token = t;
        localStorage.setItem('github_token', token);
        tokenInput.value = '';
        showEditor();
        loadDrafts();
    } catch (err) {
        alert('Invalid token. Make sure it has repo scope.');
    }
}

function disconnect() {
    localStorage.removeItem('github_token');
    token = null;
    currentDraft = null;
    drafts = [];
    showAuth();
}

// GitHub API helpers
async function githubAPI(endpoint, options = {}) {
    const res = await fetch(`https://api.github.com${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        }
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'API error');
    }
    return res.json();
}

async function getFileContent(path) {
    try {
        const data = await githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`);
        return {
            content: atob(data.content),
            sha: data.sha
        };
    } catch (err) {
        return null;
    }
}

async function saveFile(path, content, sha = null, message = 'Update') {
    const body = {
        message,
        content: btoa(unescape(encodeURIComponent(content)))
    };
    if (sha) body.sha = sha;

    return githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

async function deleteFile(path, sha, message = 'Delete') {
    return githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha })
    });
}

// Drafts management
async function loadDrafts() {
    try {
        const data = await githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DRAFTS_PATH}`);
        drafts = data
            .filter(f => f.name.endsWith('.md'))
            .map(f => ({
                name: f.name,
                path: f.path,
                sha: f.sha
            }))
            .sort((a, b) => b.name.localeCompare(a.name)); // Newest first by filename

        renderDraftsList();

        // Load first draft or create new
        if (drafts.length > 0) {
            selectDraft(drafts[0]);
        } else {
            createNewDraft();
        }
    } catch (err) {
        // Drafts folder might not exist yet
        drafts = [];
        renderDraftsList();
        createNewDraft();
    }
}

function renderDraftsList() {
    draftsList.innerHTML = drafts.map(d => {
        const title = d.name.replace('.md', '').replace(/^\d{13}-/, '') || 'untitled';
        const displayTitle = title === 'untitled' ? 'untitled' : title;
        const isActive = currentDraft && currentDraft.path === d.path;
        return `
            <div class="draft-item ${isActive ? 'active' : ''}" data-path="${d.path}">
                <div class="draft-title">${escapeHtml(displayTitle)}</div>
            </div>
        `;
    }).join('');

    // Add click handlers
    draftsList.querySelectorAll('.draft-item').forEach(el => {
        el.addEventListener('click', () => {
            const path = el.dataset.path;
            const draft = drafts.find(d => d.path === path);
            if (draft) selectDraft(draft);
        });
    });
}

async function selectDraft(draft) {
    // Save current draft first
    if (currentDraft && hasChanges()) {
        await saveDraft();
    }

    currentDraft = draft;

    // Load content
    const file = await getFileContent(draft.path);
    if (file) {
        currentDraft.sha = file.sha;
        const { title, content } = parseDraft(file.content);
        titleInput.value = title;
        contentInput.value = content;
        lastSavedContent = file.content;
    }

    deleteBtn.classList.remove('hidden');
    updateWordCount();
    renderDraftsList();
}

function parseDraft(raw) {
    const lines = raw.split('\n');
    let title = 'untitled';
    let contentStart = 0;

    // Check for title in first line (# Title)
    if (lines[0] && lines[0].startsWith('# ')) {
        title = lines[0].substring(2).trim();
        contentStart = 1;
        // Skip empty line after title
        if (lines[1] === '') contentStart = 2;
    }

    return {
        title,
        content: lines.slice(contentStart).join('\n').trim()
    };
}

function composeDraft() {
    const title = titleInput.value.trim() || 'untitled';
    const content = contentInput.value.trim();
    return `# ${title}\n\n${content}`;
}

function createNewDraft() {
    // Generate filename with timestamp
    const timestamp = Date.now();
    const filename = `${timestamp}-untitled.md`;

    currentDraft = {
        name: filename,
        path: `${DRAFTS_PATH}/${filename}`,
        sha: null,
        isNew: true
    };

    titleInput.value = '';
    contentInput.value = '';
    lastSavedContent = '';
    deleteBtn.classList.add('hidden');
    updateWordCount();
    titleInput.focus();
    renderDraftsList();
}

function handleInput() {
    updateWordCount();
    scheduleSave();
}

function updateWordCount() {
    const text = contentInput.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

function hasChanges() {
    return composeDraft() !== lastSavedContent;
}

function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveStatus.textContent = 'editing...';
    saveTimeout = setTimeout(saveDraft, 1500);
}

async function saveDraft() {
    if (!currentDraft) return;
    if (!hasChanges() && !currentDraft.isNew) return;

    const content = composeDraft();
    if (content === '# untitled\n\n') return; // Don't save empty drafts

    saveStatus.textContent = 'saving...';

    try {
        // Update filename if title changed
        const title = titleInput.value.trim() || 'untitled';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
        const timestamp = currentDraft.name.match(/^(\d{13})-/)?.[1] || Date.now();
        const newFilename = `${timestamp}-${slug}.md`;
        const newPath = `${DRAFTS_PATH}/${newFilename}`;

        // If filename changed, delete old file first
        if (currentDraft.sha && newPath !== currentDraft.path) {
            await deleteFile(currentDraft.path, currentDraft.sha, 'Rename draft');
            currentDraft.sha = null;
        }

        const result = await saveFile(
            newPath,
            content,
            currentDraft.sha,
            currentDraft.isNew ? 'Create draft' : 'Update draft'
        );

        currentDraft.sha = result.content.sha;
        currentDraft.path = newPath;
        currentDraft.name = newFilename;
        currentDraft.isNew = false;
        lastSavedContent = content;

        saveStatus.textContent = 'saved';
        deleteBtn.classList.remove('hidden');

        // Update drafts list
        const existingIndex = drafts.findIndex(d => d.path === newPath || d.name.startsWith(timestamp));
        if (existingIndex >= 0) {
            drafts[existingIndex] = { ...currentDraft };
        } else {
            drafts.unshift({ ...currentDraft });
        }
        renderDraftsList();

    } catch (err) {
        console.error('Save error:', err);
        saveStatus.textContent = 'error saving';
    }
}

async function publishDraft() {
    if (!currentDraft || !currentDraft.sha) {
        alert('Save the draft first');
        return;
    }

    if (!confirm('Publish this post?')) return;

    saveStatus.textContent = 'publishing...';

    try {
        // Get current content
        const content = composeDraft();
        const title = titleInput.value.trim() || 'untitled';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
        const date = new Date().toISOString().split('T')[0];
        const postFilename = `${date}-${slug}.md`;
        const postPath = `${POSTS_PATH}/${postFilename}`;

        // Add date to frontmatter
        const postContent = `---\ntitle: ${title}\ndate: ${date}\n---\n\n${contentInput.value.trim()}`;

        // Create post
        await saveFile(postPath, postContent, null, `Publish: ${title}`);

        // Delete draft
        await deleteFile(currentDraft.path, currentDraft.sha, 'Published');

        // Remove from drafts list
        drafts = drafts.filter(d => d.path !== currentDraft.path);

        saveStatus.textContent = 'published';

        // Load next draft or create new
        if (drafts.length > 0) {
            selectDraft(drafts[0]);
        } else {
            createNewDraft();
        }

        renderDraftsList();

    } catch (err) {
        console.error('Publish error:', err);
        saveStatus.textContent = 'error publishing';
    }
}

async function deleteDraft() {
    if (!currentDraft) return;

    if (!confirm('Delete this draft?')) return;

    if (currentDraft.sha) {
        try {
            await deleteFile(currentDraft.path, currentDraft.sha, 'Delete draft');
        } catch (err) {
            console.error('Delete error:', err);
        }
    }

    drafts = drafts.filter(d => d.path !== currentDraft.path);

    if (drafts.length > 0) {
        selectDraft(drafts[0]);
    } else {
        createNewDraft();
    }

    renderDraftsList();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start
init();
