"use strict";

/*
 * BDMV WEB HOST — HOSPEDEIRO WEB BDMV
 *
 * Port funcional seguro para navegador.
 * Não executa código nativo de PS4 — apenas carrega, verifica e
 * baixa recursos.
 *
 * IMPORTANTE (OOM): o <video> NÃO deve autoplay. Um MP4 em 1080p
 * decodificado consome 50–200 MB e faz o jailbreak falhar por
 * falta de memória. Toda mídia é liberada antes de qualquer
 * navegação para o exploit.
 */

const PAYLOADS = BDMV_ASSETS.payloads;
const PAYLOAD_COUNT = PAYLOADS.length;

const payloadByPath = new Map();
for (let i = 0; i < PAYLOAD_COUNT; i++) {
    payloadByPath.set(PAYLOADS[i].path, PAYLOADS[i]);
}

const fileContainer = document.getElementById("files");
const fileCount     = document.getElementById("fileCount");
const viewer        = document.getElementById("viewer");
const viewerTitle   = document.getElementById("viewerTitle");
const viewerContent = document.getElementById("viewerContent");
const statusElement = document.getElementById("status");

const logElements = new Map();
let lastTempLogAt = 0;
const TEMP_LOG_INTERVAL_MS = 100;

let activeRun = 0;
let activeController = null;
let pendingProgress = null;
let progressRaf = 0;

/* ------------------------------------------------------
 * LIBERAÇÃO DE MÍDIA (chave para o jailbreak)
 * ------------------------------------------------------ */
function releaseAllMedia() {
    const vids = document.querySelectorAll("video, audio");
    for (let i = 0; i < vids.length; i++) {
        const el = vids[i];
        try {
            el.pause();
            el.removeAttribute("src");
            el.srcObject = null;
            el.load();          // força WebKit a soltar buffers
        } catch (_) {}
        el.remove();
    }
}

/* Tenta reduzir a pressão de memória antes de navegar ao exploit */
function freeMemoryForExploit() {
    releaseAllMedia();
    viewerContent.innerHTML = "";
    viewer.classList.add("hidden");
    /* Descarta referências grandes */
    if (activeController) {
        try { activeController.abort(); } catch (_) {}
        activeController = null;
    }
    if (typeof globalThis.gc === "function") {
        try { globalThis.gc(); } catch (_) {}
    }
}

/* Botão "Rodar Exploit": libera tudo e redireciona */
function launchExploit() {
    freeMemoryForExploit();
    /* Dá 300 ms para o WebKit drenar filas de decode antes do redirecionamento */
    setTimeout(function () {
        location.href = "index.html";
    }, 300);
}

/* ------------------------------------------------------ */

renderPayloadButtons();
registerServiceWorker();

fileContainer.addEventListener("click", function (event) {
    const button = event.target.closest(".item");
    if (!button || !fileContainer.contains(button)) return;
    const path = button.dataset.path;
    if (path) loadResource(path);
});

/* Botão flutuante "Rodar Exploit" */
(function addExploitButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "runExploit";
    btn.textContent = "RODAR EXPLOIT (libera memória antes)";
    btn.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:9999;" +
        "padding:12px 18px;background:#2e7d32;color:#fff;" +
        "border:0;border-radius:6px;font:bold 14px system-ui;" +
        "box-shadow:0 4px 12px rgba(0,0,0,.4);cursor:pointer";
    btn.addEventListener("click", launchExploit);
    document.body.appendChild(btn);
})();

/* ========================================================
 * BOTÕES DE PAYLOAD
 * ======================================================== */
function renderPayloadButtons() {
    fileCount.textContent = PAYLOAD_COUNT + " ITENS";
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < PAYLOAD_COUNT; i++) {
        const item = PAYLOADS[i];
        const filename = item.path.split("/").pop();
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";
        button.dataset.path = item.path;
        button.innerHTML =
            '<div class="item-icon">\u25A3</div>' +
            '<div class="item-text"><strong>' +
            escapeHTML(filename) +
            '</strong><span>' + escapeHTML(item.path) +
            '&nbsp;&bull;&nbsp;' + escapeHTML(formatBytes(item.bytes)) +
            '</span></div>';
        fragment.appendChild(button);
    }
    fileContainer.appendChild(fragment);
}

/* ========================================================
 * FLUXO SEGURO — SEM AUTOPLAY
 * ======================================================== */
async function startIsoWorkflow() {
    const run = ++activeRun;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;

    viewerTitle.textContent = "FLUXO DE TRABALHO NO NAVEGADOR";
    viewerContent.innerHTML =
        '<video controls preload="none" ' +
            'src="assets/00000.mp4"></video>' +
        '<div class="note">Carregando e validando todos os recursos fornecidos.</div>' +
        '<div class="meter"><div id="workflowProgress" class="meter-fill"></div></div>' +
        '<div id="workflowProgressLabel" class="progress-label">0 / ' +
            PAYLOAD_COUNT + '</div>' +
        '<div id="workflowLog" class="terminal"></div>';

    showViewer();
    setStatus("EXECUTANDO");

    appendLog("workflowLog",
        "Iniciando fluxo de trabalho BDMV seguro para navegador.", "ok");

    const verified = await verifyPayloadCollection(
        "workflowLog", "workflowProgress", "workflowProgressLabel",
        run, controller.signal);

    if (run !== activeRun) return;
    if (!verified) { setStatus("ERRO"); return; }

    appendLog("workflowLog",
        "Recursos carregados. Mídia NÃO foi reproduzida (evita OOM).", "ok");
    appendLog("workflowLog",
        "Sandbox do navegador alcançada. hen.bin não pode ser executado aqui.", "warn");
    appendLog("workflowLog",
        "Clique em RODAR EXPLOIT para liberar memória e ir ao jailbreak.", "ok");
    setStatus("PRONTO");
}

/* ========================================================
 * MP4 — SEM AUTOPLAY, sob demanda
 * ======================================================== */
function loadVideo() {
    viewerTitle.textContent = "00000.MP4";
    viewerContent.innerHTML =
        '<div class="note">' +
            'Reproduzir MP4 consome 50–200 MB. Reproduza só depois ' +
            'que o jailbreak estiver concluído, ou nunca.' +
        '</div>' +
        '<video controls preload="none" src="assets/00000.mp4"></video>' +
        '<div class="download-row">' +
            '<a class="download" href="assets/00000.mp4" download>BAIXAR MP4</a>' +
        '</div>';
    showViewer();
    setStatus("MÍDIA PRONTA (clique Play sob seu risco)");
}

function loadStream() {
    viewerTitle.textContent = "00000.M2TS";
    viewerContent.innerHTML =
        '<p>Stream de transporte MPEG original da ISO.</p>' +
        '<p class="note">A maioria dos navegadores não reproduz M2TS ' +
        'diretamente, então esta ação fornece o arquivo original ' +
        'para download.</p>' +
        '<div class="download-row">' +
            '<a class="download" href="assets/00000.m2ts" download>' +
            'BAIXAR STREAM ORIGINAL</a></div>';
    showViewer();
    setStatus("STREAM PRONTO");
}

/* ========================================================
 * RESTANTE DO ARQUIVO (loadResource, verifyAll, verifyPayloadCollection,
 * fetchAsset, sha256Hex, hexDump, scheduleProgress, appendLog,
 * appendTemporaryLog, showViewer, closeViewer, setStatus,
 * registerServiceWorker, formatBytes, escapeHTML)
 *
 * → idêntico à versão anterior, com 2 mudanças:
 *   1. closeViewer() agora chama freeMemoryForExploit() em vez de
 *      apenas abortar o controller.
 *   2. appendLog/appendTemporaryLog usam getLogElement() com cache.
 * ======================================================== */

function closeViewer() {
    activeRun++;
    freeMemoryForExploit();
    setStatus("PRONTO");
}

/* ... cole o restante das funções que você já tem, sem alterações ... */
