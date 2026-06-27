/**
 * AI assistant panel – WebSocket chat, streaming responses, layout cards.
 */

import { placeAsset, findFreePosition, removeAsset, getItemSurfaceY } from './viewer.js';
import { sceneManager } from './scene-manager.js';

const API = 'http://localhost:8000/api';
const WS_URL = 'ws://localhost:8000/ws/chat';

// ── DOM ───────────────────────────────────────────────────────────────────────

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-chat-send');
const btnClear = document.getElementById('btn-ai-clear');
const btnUpload = document.getElementById('btn-upload-image');
const fileInput = document.getElementById('file-input');
const imagePreviewArea = document.getElementById('image-preview-area');
const imagePreview = document.getElementById('image-preview');
const btnRemoveImage = document.getElementById('btn-remove-image');

// ── State ─────────────────────────────────────────────────────────────────────

let ws = null;
let pendingImageB64 = null;
let isStreaming = false;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onclose = () => setTimeout(connectWs, 3000);
    ws.onerror = () => {};
  } catch {
    setTimeout(connectWs, 3000);
  }
}

connectWs();

// ── Scene state enrichment ────────────────────────────────────────────────────

function _enrichSceneState(scene) {
  scene.assets = (scene.assets || []).map(a => ({
    ...a,
    surface_y: getItemSurfaceY(a.item_id) ?? a.position[1],
  }));
  return scene;
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendMessage(text, imageB64 = null) {
  if (!text.trim() || isStreaming) return;

  appendUserMessage(text, imageB64 ? imagePreview.src : null);
  chatInput.value = '';
  autoResizeTextarea();
  clearImage();
  setStreaming(true);

  const scene = _enrichSceneState(sceneManager.toJSON());

  // Use REST SSE if WS not connected
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    await sendViaSSE(text, imageB64, scene);
    return;
  }

  const assistantBubble = appendAssistantMessage('', true);

  ws.onmessage = e => {
    const chunk = JSON.parse(e.data);
    if (chunk.type === 'text') {
      assistantBubble.dataset.raw = (assistantBubble.dataset.raw || '') + chunk.content;
      assistantBubble.textContent = (assistantBubble.dataset.raw || '').replace(/<scene_actions>[\s\S]*?<\/scene_actions>/g, '').trim();
    } else if (chunk.type === 'actions') {
      assistantBubble.classList.remove('streaming');
      executeActions(chunk.content).then(summary => {
        appendActionSummary(summary);
        updateSceneCount();
      });
      setStreaming(false);
    } else if (chunk.type === 'done') {
      assistantBubble.classList.remove('streaming');
      setStreaming(false);
    } else if (chunk.type === 'error') {
      assistantBubble.textContent = `Error: ${chunk.content}`;
      assistantBubble.classList.remove('streaming');
      setStreaming(false);
    }
  };

  ws.send(JSON.stringify({ prompt: text, scene, image_b64: imageB64 }));
}

async function sendViaSSE(text, imageB64, scene) {
  const assistantBubble = appendAssistantMessage('', true);

  try {
    const res = await fetch(`${API}/ai/compose/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, scene, image_b64: imageB64 }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text_chunk = decoder.decode(value);
      const lines = text_chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const chunk = JSON.parse(data);
          if (chunk.type === 'text') {
            raw += chunk.content;
            assistantBubble.textContent = raw.replace(/<scene_actions>[\s\S]*?<\/scene_actions>/g, '').trim();
          } else if (chunk.type === 'actions') {
            executeActions(chunk.content).then(summary => {
              appendActionSummary(summary);
              updateSceneCount();
            });
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    assistantBubble.textContent = `Connection error: ${err.message}. Is the backend running?`;
  } finally {
    assistantBubble.classList.remove('streaming');
    setStreaming(false);
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────

function appendUserMessage(text, imgSrc = null) {
  // Hide welcome screen
  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.style.display = 'none';

  const msg = document.createElement('div');
  msg.className = 'chat-msg user';

  if (imgSrc) {
    const imgEl = document.createElement('img');
    imgEl.src = imgSrc;
    imgEl.style.cssText = 'max-width:160px;border-radius:8px;margin-bottom:4px';
    msg.appendChild(imgEl);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);

  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendAssistantMessage(text, streaming = false) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg assistant';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble' + (streaming ? ' streaming' : '');
  bubble.textContent = text;
  msg.appendChild(bubble);
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function resolvePos(aiPos) {
  const p = aiPos || [0, 0, 0];
  const isOrigin = Math.abs(p[0]) < 0.01 && Math.abs(p[2]) < 0.01;
  return isOrigin ? findFreePosition() : p;
}

async function executeActions(actions) {
  let added = 0, moved = 0, scaled = 0, removed = 0;

  for (const a of actions) {
    if (a.action === 'add') {
      await placeAsset(
        a.asset_id,
        a.display_name || 'Asset',
        resolvePos(a.position),
        a.rotation || [0, 0, 0],
        a.scale || 1,
      );
      added++;
    } else if (a.action === 'move') {
      const item = sceneManager.items.find(i => i.id === a.item_id);
      if (item) {
        sceneManager.beginMove();
        sceneManager.updateItem(item.id, {
          ...(a.position ? { position: a.position } : {}),
          ...(a.rotation ? { rotation: a.rotation } : {}),
        });
        sceneManager.commitMove();
        moved++;
      }
    } else if (a.action === 'scale') {
      const item = sceneManager.items.find(i => i.id === a.item_id);
      if (item) {
        sceneManager.beginMove();
        sceneManager.updateItem(item.id, { scale: a.scale });
        sceneManager.commitMove();
        scaled++;
      }
    } else if (a.action === 'remove') {
      const item = sceneManager.items.find(i => i.id === a.item_id);
      if (item) { removeAsset(item.id); removed++; }
    }
  }

  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (moved)   parts.push(`${moved} moved`);
  if (scaled)  parts.push(`${scaled} scaled`);
  if (removed) parts.push(`${removed} removed`);
  return parts.length ? parts.join(', ') : null;
}

function appendActionSummary(summary) {
  if (!summary) return;
  const msg = document.createElement('div');
  msg.className = 'chat-msg assistant';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble action-summary';
  bubble.textContent = `✓ ${summary}`;
  msg.appendChild(bubble);
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateSceneCount() {
  const right = document.getElementById('status-right');
  if (right) right.textContent = `${sceneManager.count} asset${sceneManager.count !== 1 ? 's' : ''} in scene`;
}

// ── Image upload ──────────────────────────────────────────────────────────────

btnUpload.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    pendingImageB64 = dataUrl.split(',')[1]; // base64 only
    imagePreview.src = dataUrl;
    imagePreviewArea.style.display = 'inline-flex';
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

btnRemoveImage.addEventListener('click', clearImage);

function clearImage() {
  pendingImageB64 = null;
  imagePreview.src = '';
  imagePreviewArea.style.display = 'none';
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function setStreaming(val) {
  isStreaming = val;
  btnSend.disabled = val;
}

function autoResizeTextarea() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
}

chatInput.addEventListener('input', autoResizeTextarea);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(chatInput.value.trim(), pendingImageB64);
  }
});

btnSend.addEventListener('click', () => {
  sendMessage(chatInput.value.trim(), pendingImageB64);
});

btnClear.addEventListener('click', () => {
  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a10 10 0 1 0 10 10"/>
          <path d="m17 7 2-2 2 2-2 2-2-2z"/>
        </svg>
      </div>
      <h3>AI Scene Composer</h3>
      <p>Describe a scene, upload a reference image, or ask for suggestions.</p>
      <div class="suggestion-pills">
        <button class="pill" data-prompt="Create a cozy living room with warm lighting">Living room</button>
        <button class="pill" data-prompt="Design a medieval castle courtyard">Castle courtyard</button>
        <button class="pill" data-prompt="Modern kitchen with island and bar stools">Modern kitchen</button>
        <button class="pill" data-prompt="Japanese zen garden with a small temple">Zen garden</button>
      </div>
    </div>`;
  initPills();
});

// ── Suggestion pills ──────────────────────────────────────────────────────────

function initPills() {
  chatMessages.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      chatInput.value = pill.dataset.prompt;
      sendMessage(pill.dataset.prompt, null);
    });
  });
}

initPills();
